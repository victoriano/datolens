//! Bounded native chart queries. Dimensions and measures are structured, never SQL.
//! Exact dimensions and aggregate values travel as strings to retain integer/decimal precision.
use crate::{Column, Dataset, Error, Filter, Result, VariableKind};
use duckdb::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all="camelCase")]
pub enum PlotMode { Aggregate, Points }
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all="camelCase")]
pub enum Binning { Exact, Width, Quantile, Date }
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all="lowercase")]
pub enum Interval { Hour, Day, Week, Month, Quarter, Year }
impl Interval { fn sql(&self)->&'static str {match self{Self::Hour=>"hour",Self::Day=>"day",Self::Week=>"week",Self::Month=>"month",Self::Quarter=>"quarter",Self::Year=>"year"}} }
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all="lowercase")]
pub enum DateComponent { Year, Quarter, Month, Dayofweek, Hour }
impl DateComponent {fn sql(&self)->&'static str {match self{Self::Year=>"year",Self::Quarter=>"quarter",Self::Month=>"month",Self::Dayofweek=>"dayofweek",Self::Hour=>"hour"}}}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all="camelCase")]
pub struct Dimension { pub column:String, pub binning:Binning, pub bins:Option<u32>, pub interval:Option<Interval>, pub component:Option<DateComponent> }
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all="camelCase")]
pub enum Statistic { Count, Valid, Distinct, Sum, Mean, Median, Min, Max, Stddev, Q1, Q3, Percentile, CountWhere, PercentWhere }
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all="camelCase")]
pub struct Measure { pub column:Option<String>, pub stat:Statistic, /// Unit interval [0, 1], using DuckDB quantile_cont.
    pub percentile:Option<f64>, pub value:Option<String> }
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all="lowercase")]
pub enum PlotSort { #[default] Natural, Value, Count }
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all="camelCase")]
pub struct PlotQuery {
    pub dataset_id:String, pub filters:Vec<Filter>, pub mode:PlotMode,
    pub dimensions:Vec<Dimension>, pub measures:Vec<Measure>,
    #[serde(default)] pub point_columns:Vec<String>, pub limit:u32,
    #[serde(default)] pub include_missing:bool,
    #[serde(default)] pub sort:PlotSort, #[serde(default)] pub descending:bool,
    #[serde(default)] pub group_dimensions:Option<Vec<usize>>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct PlotResult {
    pub rows:Vec<BTreeMap<String,Value>>, pub matched_rows:u64, pub total_rows:u64,
    pub plotted_rows:u64, pub truncated:bool, pub dataset_revision:String,
    pub selection_method:String,
    #[serde(skip_serializing_if="Option::is_none")] pub statistics:Option<Value>,
}
fn ident(s:&str)->String {format!("\"{}\"",s.replace('"',"\"\""))}
fn literal(s:&str)->String {format!("'{}'",s.replace('\'',"''"))}
fn invalid(s:&str)->Error {Error::Invalid(s.into())}
fn column<'a>(ds:&'a Dataset,id:&str)->Result<&'a Column> {ds.columns.iter().find(|c|c.id==id).ok_or_else(||Error::Invalid(format!("Unknown plot column: {id}")))}
fn finite(expr:&str)->String {format!("CASE WHEN isfinite(TRY_CAST({expr} AS DOUBLE)) THEN TRY_CAST({expr} AS DOUBLE) END")}
fn read_rows(conn:&Connection,sql:&str)->Result<Vec<BTreeMap<String,Value>>> {
    let mut stmt=conn.prepare(&format!("SELECT CAST(to_json(p) AS VARCHAR) FROM ({sql}) p"))?;
    let encoded=stmt.query_map([],|r|r.get::<_,String>(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
    encoded.into_iter().map(|s|Ok(serde_json::from_str(&s)?)).collect()
}
fn measure_sql(ds:&Dataset,m:&Measure)->Result<String> {
    if m.stat==Statistic::Count {return Ok("count(*)".into());}
    let id=m.column.as_ref().ok_or_else(||invalid("A measure column is required"))?;
    let col=column(ds,id)?;let c=ident(id);
    if matches!(m.stat,Statistic::Valid) {return Ok(format!("count({c})"));}
    if matches!(m.stat,Statistic::Distinct) {return Ok(format!("count(DISTINCT {c})"));}
    if matches!(m.stat,Statistic::CountWhere|Statistic::PercentWhere) {
        let value=m.value.as_deref().ok_or_else(||invalid("A value is required for conditional statistics"))?;
        if value.len()>16384 {return Err(invalid("Statistic value is too long"));}
        let count=format!("count(*) FILTER (WHERE CAST({c} AS VARCHAR)={})",literal(value));
        return Ok(if m.stat==Statistic::PercentWhere {format!("100.0 * {count} / NULLIF(count(*),0)")}else{count});
    }
    if col.kind!=VariableKind::Numeric {return Err(invalid("The selected statistic requires a numeric column"));}
    // Keep native numeric type for sums and quantiles. Only test finiteness in DOUBLE.
    let c=format!("CASE WHEN isfinite(TRY_CAST({c} AS DOUBLE)) THEN {c} END");
    Ok(match m.stat {
        Statistic::Sum=>format!("sum({c})"),Statistic::Mean=>format!("avg({c})"),Statistic::Median=>format!("median({c})"),Statistic::Min=>format!("min({c})"),Statistic::Max=>format!("max({c})"),Statistic::Stddev=>format!("stddev_pop({c})"),Statistic::Q1=>format!("quantile_cont({c},0.25)"),Statistic::Q3=>format!("quantile_cont({c},0.75)"),
        Statistic::Percentile=>{let p=m.percentile.ok_or_else(||invalid("Percentile is required"))?;if !p.is_finite() || !(0.0..=1.0).contains(&p){return Err(invalid("Percentile must be between zero and one"));}format!("quantile_cont({c},{p})")},
        _=>unreachable!(),
    })
}
/// Caller supplies a filter predicate built by DataStore::where_sql, never user text.
/// A session's DataStore mutex covers this entire query and its source checks.
pub fn query(conn:&Connection,ds:&Dataset,predicate:&str,rid:&str,q:PlotQuery)->Result<PlotResult> {
    if q.dataset_id!=ds.id {return Err(invalid("Dataset identity mismatch"));}
    if q.limit==0 || q.limit>10000 {return Err(invalid("Plot limit must be between 1 and 10000"));}
    if q.dimensions.len()>6 || q.measures.len()>12 || q.point_columns.len()>12 || q.filters.len()>256 {return Err(invalid("Too many plot fields"));}
    let grouped=q.group_dimensions.clone().unwrap_or_else(||(0..q.dimensions.len()).collect());
    if grouped.len()>q.dimensions.len() || grouped.iter().any(|i|*i>=q.dimensions.len()) || grouped.iter().collect::<std::collections::HashSet<_>>().len()!=grouped.len() {return Err(invalid("Invalid plot grouping indices"));}
    for d in &q.dimensions {column(ds,&d.column)?; if d.bins.is_some_and(|n| !(1..=100).contains(&n)){return Err(invalid("Plot bins must be between 1 and 100"));}}
    let matched_rows:u64=conn.query_row(&format!("SELECT count(*) FROM dl_data WHERE {predicate}"),[],|r|r.get(0))?;
    let mut result=PlotResult {rows:vec![],matched_rows,total_rows:ds.row_count.unwrap_or(0),plotted_rows:0,truncated:false,dataset_revision:ds.revision.clone(),selection_method:String::new(),statistics:None};
    if q.mode==PlotMode::Points {
        if q.point_columns.len()<2 {return Err(invalid("Points require X and Y columns"));}
        for (i,id) in q.point_columns.iter().enumerate() {if id.is_empty() && i>=2 {continue;}let c=column(ds,id)?;if i<2 && c.kind!=VariableKind::Numeric{return Err(invalid("Point axes must be numeric"));}}
        let x=finite(&ident(&q.point_columns[0]));let y=finite(&ident(&q.point_columns[1]));
        let source=format!("FROM dl_data WHERE ({predicate}) AND ({x}) IS NOT NULL AND ({y}) IS NOT NULL");
        let statistics=[("correlation",format!("corr({x},{y})")),("slope",format!("regr_slope({y},{x})")),("intercept",format!("regr_intercept({y},{x})")),("rSquared",format!("regr_r2({y},{x})"))].iter().map(|(name,expr)|format!("CASE WHEN isfinite({expr}) THEN {expr} END AS {name}")).collect::<Vec<_>>().join(",");
        let stats=read_rows(conn,&format!("SELECT count(*) AS n,{statistics} {source}"))?;
        let mut stats=stats.into_iter().next().unwrap_or_default();
        result.plotted_rows=stats.remove("n").and_then(|n|n.as_u64()).unwrap_or(0);
        // Undefined coefficients (constant/empty data) are null, never NaN/Infinity JSON.
        for v in stats.values_mut(){if v.as_f64().is_some_and(|n|!n.is_finite()) || v.is_string(){*v=Value::Null;}}
        result.statistics=Some(json!(stats));
        let mut fields=vec![format!("CAST({} AS VARCHAR) AS id",ident(rid))];
        for (i,id) in q.point_columns.iter().enumerate() {
            let value=if id.is_empty(){"NULL".into()}else{format!("CAST({} AS VARCHAR)",ident(id))};
            fields.push(format!("{value} AS d{i}"));
        }
        result.rows=read_rows(conn,&format!("SELECT {} {source} ORDER BY {} LIMIT {}",fields.join(","),ident(rid),q.limit+1))?;
        result.truncated=result.rows.len()>q.limit as usize;result.rows.truncate(q.limit as usize);
        result.selection_method=if result.truncated{"firstRows"}else{"allPoints"}.into();
        return Ok(result);
    }
    if q.measures.is_empty(){return Err(invalid("At least one measure is required"));}
    let measures=q.measures.iter().map(|m|measure_sql(ds,m)).collect::<Result<Vec<_>>>()?;
    let mut raw_dimensions=vec![];let mut projected=vec![];let mut groups=vec![];let mut eligibility=vec![];let mut ordered_dimensions=vec![];
    let mut prefix="__dl_plot_".to_string();
    while ds.columns.iter().any(|c|c.id.starts_with(&prefix)){prefix.push('_');}
    // Domains are computed after the shared filters, with no JS data materialization.
    for (i,d) in q.dimensions.iter().enumerate() {
        let col=column(ds,&d.column)?;let c=ident(&d.column);let alias=format!("{prefix}d{i}");
        let mut end="NULL".to_string();let mut inclusive=false;let mut exclusive=false;let mut quantile_exclusive=None;
        let expression=match d.binning {
            Binning::Exact=>format!("CAST({c} AS VARCHAR)"),
            Binning::Date=>{
                if col.kind!=VariableKind::Date{return Err(invalid("Date bins require a date column"));}
                if let Some(component)=&d.component {format!("date_part('{}',TRY_CAST({c} AS TIMESTAMP))",component.sql())}
                else {let period=d.interval.as_ref().unwrap_or(&Interval::Month).sql();let start=format!("date_trunc('{period}',TRY_CAST({c} AS TIMESTAMP))");end=format!("{start}+INTERVAL 1 {period}");start}
            },
            Binning::Width|Binning::Quantile=>{
                if col.kind!=VariableKind::Numeric{return Err(invalid("Numeric bins require a numeric column"));}
                let n=d.bins.unwrap_or(24);let num=finite(&c);
                let edges=if d.binning==Binning::Quantile {(0..=n).map(|j|format!("quantile_cont({num},{}) AS e{j}",j as f64/n as f64)).collect::<Vec<_>>()}else{vec![format!("min({num}) AS lo"),format!("max({num}) AS hi")]};
                let bounds=read_rows(conn,&format!("SELECT {} FROM dl_data WHERE {predicate}",edges.join(",")))?.pop().unwrap_or_default();
                let lo=bounds.get(if d.binning==Binning::Width{"lo"}else{"e0"}).and_then(Value::as_f64);
                let hi=bounds.get(if d.binning==Binning::Width{"hi"}else{"unused"}).and_then(Value::as_f64);
                if d.binning==Binning::Width {
                    match (lo,hi) {
                        (Some(lo),Some(hi)) if hi>lo && (hi-lo).is_finite()=>{
                            let step=(hi-lo)/n as f64;
                            if step==0.0{return Err(invalid("Numeric range is too small to bin; use exact values"));}
                            let bucket=format!("least({},greatest(0,floor((({num})-({lo}))/({step}))))",n-1);
                            end=format!("CASE WHEN ({num}) IS NULL THEN NULL ELSE ({lo})+(({bucket})+1)*({step}) END");
                            // Native metadata records the last inclusive bin below.
                            format!("CASE WHEN ({num}) IS NULL THEN NULL ELSE ({lo})+({bucket})*({step}) END")
                        },
                        (Some(lo),_)=>{end=format!("CASE WHEN ({num}) IS NULL THEN NULL ELSE {lo} END");inclusive=true;end.clone()},
                        _=>"NULL::DOUBLE".into(),
                    }
                } else {
                    inclusive=true;exclusive=true;
                    let vals=(0..=n).filter_map(|j|bounds.get(&format!("e{j}")).and_then(Value::as_f64)).collect::<Vec<_>>();
                    if vals.len()!=n as usize+1 {"NULL::DOUBLE".into()} else {
                        quantile_exclusive=Some(format!("({num}) > ({})",vals[1]));
                        // Quantile-cont boundaries, ties stay together; some bins can be empty.
                        let mut starts=String::from("CASE");let mut ends=String::from("CASE");
                        for j in 1..=n as usize {starts.push_str(&format!(" WHEN ({num}) <= ({}) THEN ({})",vals[j],vals[j-1]));ends.push_str(&format!(" WHEN ({num}) <= ({}) THEN ({})",vals[j],vals[j]));}
                        starts.push_str(" ELSE NULL END");ends.push_str(" ELSE NULL END");end=ends;starts
                    }
                }
            }
        };
        raw_dimensions.push(format!("{expression} AS {alias}"));raw_dimensions.push(format!("{end} AS {alias}End"));
        let end_inclusive=if d.binning==Binning::Width && !inclusive {format!("({end}) >= (SELECT max({}) FROM src)",finite(&c))}else{inclusive.to_string()};
        let start_exclusive=quantile_exclusive.unwrap_or_else(||if exclusive{format!("({expression}) > (SELECT min({}) FROM src)",finite(&c))}else{"false".into()});
        raw_dimensions.push(format!("{end_inclusive} AS {alias}EndInclusive"));raw_dimensions.push(format!("{start_exclusive} AS {alias}StartExclusive"));
        if grouped.contains(&i) {
            for suffix in ["","End","EndInclusive","StartExclusive"] {let a=format!("{alias}{suffix}");groups.push(a.clone());projected.push(format!("{a} AS d{i}{suffix}"));}
            ordered_dimensions.push(if col.kind==VariableKind::Numeric && d.binning==Binning::Exact {format!("TRY_CAST({alias} AS DOUBLE)")}else{alias.clone()});
        }
        if !q.include_missing {eligibility.push(format!("{alias} IS NOT NULL"));}
    }
    let eligible=if eligibility.is_empty(){"TRUE".into()}else{eligibility.join(" AND ")};
    let dimensions=if raw_dimensions.is_empty(){String::new()}else{format!(",{}",raw_dimensions.join(","))};
    let cte=format!("WITH src AS (SELECT * FROM dl_data WHERE {predicate}), mapped AS (SELECT *{dimensions} FROM src), eligible AS (SELECT * FROM mapped WHERE {eligible})");
    result.plotted_rows=conn.query_row(&format!("{cte} SELECT count(*) FROM eligible"),[],|r|r.get(0))?;
    for (i,m) in measures.iter().enumerate(){projected.push(format!("CAST({m} AS VARCHAR) AS m{i}"));}
    let group=if groups.is_empty(){String::new()}else{format!("GROUP BY {}",groups.join(","))};
    let direction=if q.descending{"DESC"}else{"ASC"};
    let mut order=match q.sort {PlotSort::Value=>vec![format!("({}) {direction} NULLS LAST",measures[0])],PlotSort::Count=>vec![format!("count(*) {direction}")],PlotSort::Natural=>vec![]};
    order.extend(ordered_dimensions.iter().map(|name|format!("{name} {direction} NULLS LAST")));
    let order=if order.is_empty(){String::new()}else{format!("ORDER BY {}",order.join(","))};
    result.rows=read_rows(conn,&format!("{cte} SELECT {} FROM eligible {group} {order} LIMIT {}",projected.join(","),q.limit+1))?;
    result.truncated=result.rows.len()>q.limit as usize;result.rows.truncate(q.limit as usize);
    result.selection_method=if result.truncated{"orderedGroups"}else{"allGroups"}.into();
    Ok(result)
}
