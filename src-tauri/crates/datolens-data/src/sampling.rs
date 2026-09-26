use super::*;
use std::collections::{HashMap, VecDeque};

#[derive(Default)]
pub(super) struct AnalysisCache {
    rows: Option<u64>,
    projected: HashSet<String>,
    background_order: VecDeque<String>,
    selected_counts: VecDeque<(String, u64)>,
    bounds: HashMap<String, (f64, f64)>,
    background: HashMap<String, Distribution>,
    pub(super) exact_counts: VecDeque<(String, u64)>,
}

impl DataStore {
    /// Width-aware native budget, independent of browser/deviceMemory support.
    pub fn automatic_analysis_rows(&self) -> u64 {
        let width = self.dataset.columns.len().max(1) as u64;
        ((64 * 1024 * 1024 / (width * 48)).clamp(1_000, 100_000) / 1_000) * 1_000
    }

    fn analysis_relation(&self, sampling: &AnalysisSampling, needed: &[String]) -> Result<(&'static str, u64)> {
        let total = self.dataset.row_count.unwrap_or(0);
        let cap = match sampling {
            AnalysisSampling::Auto => self.automatic_analysis_rows(),
            AnalysisSampling::Full => total,
            AnalysisSampling::Rows { rows } => {
                if *rows == 0 || *rows > 5_000_000 { return Err(Error::Invalid("Sample size must be between 1 and 5,000,000 rows".into())); }
                *rows
            }
        }.min(total);
        if self.analysis_cache.borrow().rows != Some(cap) {
            self.analysis_cache.replace(AnalysisCache::default());
            if cap < total {
                // Version 2 samples row ordinals without scanning source values.
                // Populate columns lazily below; never SELECT * over a wide source.
                let key = hash(&serde_json::to_vec(&(2u8, cap, &self.dataset.revision, &self.dataset.columns, &self.dataset.type_overrides, &self.derived_columns))?);
                let previous: Option<String> = self.conn.query_row("SELECT value FROM dl_meta WHERE key='analysis_sample'", [], |r| r.get(0)).ok();
                let reusable = previous.as_deref() == Some(&key) && self.conn.query_row("SELECT count(*) FROM dl_analysis_sample", [], |r| r.get::<_,u64>(0)).ok() == Some(cap);
                if !reusable {
                    self.conn.execute_batch("BEGIN TRANSACTION")?;
                    let result = (|| -> Result<()> {
                        self.conn.execute_batch(&format!("CREATE OR REPLACE TABLE dl_analysis_sample ({} BIGINT)",ident(&self.rid)))?;
                        {
                            let mut appender = self.conn.appender("dl_analysis_sample")?;
                            for ordinal in sample_ordinals(total, cap) { appender.append_row([ordinal])?; }
                            appender.flush()?;
                        }
                        self.conn.execute("INSERT OR REPLACE INTO dl_meta VALUES ('analysis_sample', ?)", params![key])?;
                        Ok(())
                    })();
                    match result { Ok(()) => self.conn.execute_batch("COMMIT")?, Err(error) => { let _ = self.conn.execute_batch("ROLLBACK"); return Err(error); } }
                }
                let mut statement = self.conn.prepare("DESCRIBE dl_analysis_sample")?;
                let projected = statement.query_map([], |r| r.get::<_,String>(0))?.collect::<std::result::Result<HashSet<_>,_>>()?;
                self.analysis_cache.borrow_mut().projected = projected;
            }
            self.analysis_cache.borrow_mut().rows = Some(cap);
        }
        if cap >= total { return Ok(("dl_data", cap)); }
        let mut seen = HashSet::new();
        let missing: Vec<_> = needed.iter().filter(|id| !self.analysis_cache.borrow().projected.contains(*id) && seen.insert((*id).clone())).cloned().collect();
        // Small independent projections also bound wide explicit API requests.
        for ids in missing.chunks(8) {
            self.conn.execute_batch("BEGIN TRANSACTION")?;
            let result = (|| -> Result<()> {
                let fields = ids.iter().map(|id| ident(id)).collect::<Vec<_>>().join(",");
                let rid = ident(&self.rid);
                // CTAS infers even nested/cast/formula types without interpolating
                // type text. The semi join projects only these columns and ordinals.
                self.conn.execute_batch(&format!("CREATE OR REPLACE TEMP TABLE dl_analysis_projection AS SELECT d.{rid},{fields} FROM dl_data d WHERE d.{rid} IN (SELECT {rid} FROM dl_analysis_sample)"))?;
                let columns = {
                    let mut statement = self.conn.prepare("DESCRIBE dl_analysis_projection")?;
                    let rows = statement.query_map([], |r| Ok((r.get::<_,String>(0)?, r.get::<_,String>(1)?)))?.collect::<std::result::Result<Vec<_>,_>>()?;
                    rows
                };
                for (id, data_type) in columns.iter().filter(|(id,_)| id != &self.rid) {
                    self.conn.execute_batch(&format!("ALTER TABLE dl_analysis_sample ADD COLUMN {} {data_type}",ident(id)))?;
                }
                let assignments = ids.iter().map(|id| format!("{} = p.{}",ident(id),ident(id))).collect::<Vec<_>>().join(",");
                self.conn.execute_batch(&format!("UPDATE dl_analysis_sample s SET {assignments} FROM dl_analysis_projection p WHERE s.{rid}=p.{rid}; DROP TABLE dl_analysis_projection"))?;
                self.check_source()?;
                Ok(())
            })();
            match result { Ok(()) => self.conn.execute_batch("COMMIT")?, Err(error) => { let _ = self.conn.execute_batch("ROLLBACK"); return Err(error); } }
            self.analysis_cache.borrow_mut().projected.extend(ids.iter().cloned());
        }
        Ok(("dl_analysis_sample", cap))
    }

    pub fn distributions_with_options(&self,columns:&[String],filters:&[Filter],options:&DistributionOptions)->Result<Distributions> {
        if columns.len()>MAX_DISTRIBUTION_COLUMNS{return Err(Error::Invalid("Request at most 64 distributions at once".into()));}
        let cols=self.projection(columns)?;let predicate=self.where_sql(filters)?;
        if let Some(ids) = &options.statistics { self.projection(ids)?; }
        let total=self.dataset.row_count.unwrap_or(0);
        self.check_source()?;
        let needed: Vec<_> = columns.iter().cloned().chain(filters.iter().map(|filter| filter.column().to_owned())).collect();
        let (relation, analyzed) = self.analysis_relation(&options.sampling, &needed)?;
        let cached_selected = self.analysis_cache.borrow().selected_counts.iter().find(|(key,_)|key==&predicate).map(|(_,count)|*count);
        let selected = if predicate == "TRUE" { analyzed } else if let Some(count)=cached_selected { count } else {
            let count = self.conn.query_row(&format!("SELECT COUNT(*) FROM {relation} WHERE {predicate}"), [], |r| r.get(0))?;
            let mut cache = self.analysis_cache.borrow_mut();
            if cache.selected_counts.len() >= 16 { cache.selected_counts.pop_front(); }
            cache.selected_counts.push_back((predicate.clone(),count));
            count
        };
        let mut variables=Vec::new();
        for col in cols {
            let include_stats = options.statistics.as_ref().is_none_or(|ids| ids.contains(&col.id));
            let cached = self.analysis_cache.borrow().background.get(&col.id).cloned();
            if predicate == "TRUE" {
                if let Some(mut cached) = cached {
                    if !include_stats || cached.statistics.is_some() {
                        if !include_stats { cached.statistics = None; }
                        variables.push(cached);
                        continue;
                    }
                }
            }
            let field=ident(&col.id);let mut bins=Vec::new();let mut truncated=false;
            match col.kind {
                VariableKind::Numeric|VariableKind::Date => {
                    let expr=if col.kind==VariableKind::Date {format!("epoch_ms(TRY_CAST({field} AS TIMESTAMP))::DOUBLE")}else{format!("TRY_CAST({field} AS DOUBLE)")};
                    let cached = self.analysis_cache.borrow().bounds.get(&col.id).copied();
                    let (min, max) = if let Some(bounds) = cached { bounds } else {
                        let (min,max):(Option<f64>,Option<f64>)=self.conn.query_row(&format!("SELECT min({expr}),max({expr}) FROM {relation} WHERE isfinite({expr})"),[],|r|Ok((r.get(0)?,r.get(1)?)))?;
                        let bounds = match (min,max){(Some(a),Some(b))=>(a,b),_=>(0.,0.)};
                        self.analysis_cache.borrow_mut().bounds.insert(col.id.clone(), bounds);
                        bounds
                    };
                    let count=if max>min{32}else{1};let width=if max>min{(max-min)/(count as f64)}else{1.};
                    let bucket=format!("CASE WHEN {expr} IS NULL OR NOT isfinite({expr}) THEN -1 ELSE LEAST(GREATEST(FLOOR(({expr}-({min}))/{width}),0),{})::INTEGER END",count-1);
                    let sql=format!("SELECT {bucket} AS bucket, COUNT(*), COUNT(*) FILTER (WHERE {predicate}) FROM {relation} GROUP BY 1 ORDER BY 1");
                    let mut stmt=self.conn.prepare(&sql)?;let mut rows=stmt.query([])?;
                    let mut counts=BTreeMap::new();
                    while let Some(r)=rows.next()? {counts.insert(r.get::<_,i32>(0)?,(r.get::<_,u64>(1)?,r.get::<_,u64>(2)?));}
                    for i in 0..count {let (bg,fg)=counts.get(&i).copied().unwrap_or((0,0));bins.push(bin(None,Some(min+i as f64*width),Some(if i==count-1 && max>min{max}else{min+(i+1) as f64*width}),bg,fg,analyzed,selected));}
                    if let Some((bg,fg))=counts.get(&-1){bins.push(bin(Some(Value::Null),None,None,*bg,*fg,analyzed,selected));}
                },
                _ => {
                    let relation=if col.kind==VariableKind::Multivalued {
                        // DISTINCT per row ensures [a,a] contributes only once.
                        {let list=if col.data_type=="VARCHAR" {format!("list_transform(TRY_CAST({field} AS VARCHAR[]), x -> TRIM(x))")}else{field.clone()};
                        format!("(SELECT DISTINCT {} AS rid, CAST(unnest({list}) AS VARCHAR) AS value, ({predicate}) AS picked FROM {relation})",ident(&self.rid))}
                    } else {format!("(SELECT CAST({field} AS VARCHAR) AS value, ({predicate}) AS picked FROM {relation})")};
                    let sql=format!("SELECT value, COUNT(*) AS bg, COUNT(*) FILTER (WHERE picked) FROM {relation} GROUP BY 1 ORDER BY bg DESC, value ASC NULLS LAST LIMIT 257");
                    let mut stmt=self.conn.prepare(&sql)?;let mut rows=stmt.query([])?;
                    while let Some(r)=rows.next()? {let val:Option<String>=r.get(0)?;bins.push(bin(Some(val.map(Value::String).unwrap_or(Value::Null)),None,None,r.get(1)?,r.get(2)?,analyzed,selected));}
                }
            }
            if bins.len()>256 {bins.truncate(256);truncated=true;}
            let statistics=if include_stats { Some(self.statistics_from(&col,&predicate,relation)?) } else { None };
            let distribution = Distribution{column:col.id.clone(),kind:col.kind,bins,truncated,statistics};
            if predicate == "TRUE" {
                let mut cache = self.analysis_cache.borrow_mut();
                cache.background_order.retain(|id| id != &col.id);
                if cache.background.len() >= 256 { if let Some(old)=cache.background_order.pop_front() { cache.background.remove(&old); } }
                cache.background_order.push_back(col.id.clone());
                cache.background.insert(col.id, distribution.clone());
            }
            variables.push(distribution);
        }
        Ok(Distributions{variables,selected_count:selected,total_rows:total,analyzed_rows:analyzed,sampled:analyzed<total,automatic_rows:self.automatic_analysis_rows(),deferred_reason:None})
    }
}

/// Floyd sampling: uniform without replacement in O(sample size), independent of
/// source row order, requested columns, threads and filters. Fixed seed on reopen.
fn sample_ordinals(total: u64, cap: u64) -> Vec<u64> {
    let mut selected = HashSet::with_capacity(cap as usize);
    let mut seed = 42u64;
    for j in total - cap..total {
        let upper = j + 1;
        let threshold = upper.wrapping_neg() % upper;
        let picked = loop {
            seed = seed.wrapping_add(0x9e3779b97f4a7c15);
            let mut z = seed;
            z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
            z ^= z >> 31;
            if z >= threshold { break z % upper; }
        };
        if !selected.insert(picked) { selected.insert(j); }
    }
    let mut rows: Vec<_> = selected.into_iter().collect();
    rows.sort_unstable();
    rows
}
