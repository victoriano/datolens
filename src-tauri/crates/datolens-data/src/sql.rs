//! Native SQL builders for structured column filters.
use crate::{Error, Filter, Result, TextMode};
pub(crate) fn ident(s: &str) -> String { format!("\"{}\"", s.replace('"', "\"\"")) }
pub(crate) fn literal(s: &str) -> String { format!("'{}'", s.replace('\'', "''")) }
pub(crate) fn predicate(filter: &Filter) -> Result<Option<String>> {
    let col = ident(filter.column());
    let result = match filter {
        Filter::Numeric { min, max, .. } => {
            if min.iter().chain(max.iter()).any(|v| !v.is_finite()) { return Err(Error::Invalid("Non-finite filter bound".into())); }
            let expr = format!("TRY_CAST({col} AS DOUBLE)");
            match (min,max) { (Some(a),Some(b)) => Some(format!("{expr} BETWEEN {a} AND {b}")), (Some(a),None) => Some(format!("{expr} >= {a}")), (None,Some(b))=>Some(format!("{expr} <= {b}")), _=>None }
        }
        Filter::Date { start, end, .. } => {
            let bounds = [(start,">="),(end,"<=")].into_iter().filter_map(|(v,op)| v.as_ref().filter(|s| !s.is_empty()).map(|s| format!("TRY_CAST({col} AS TIMESTAMP) {op} CAST({} AS TIMESTAMP)",literal(&s.replace('T'," "))))).collect::<Vec<_>>();
            if bounds.is_empty() { None } else { Some(bounds.join(" AND ")) }
        }
        Filter::Categorical { selected,.. } => if selected.is_empty() { None } else { Some(format!("CAST({col} AS VARCHAR) IN ({})",selected.iter().map(|v|literal(v)).collect::<Vec<_>>().join(","))) },
        Filter::Multivalued { selected,list_encoded,.. } => if selected.is_empty() { None } else {
            let expr = if *list_encoded { format!("list_transform(TRY_CAST(CAST({col} AS VARCHAR) AS VARCHAR[]), x -> TRIM(x))") } else { format!("CAST({col} AS VARCHAR[])") };
            Some(format!("list_has_any({expr}, [{}])",selected.iter().map(|v|literal(v)).collect::<Vec<_>>().join(",")))
        },
        Filter::Text { terms, mode, case_sensitive,.. } => {
            let expr = if *case_sensitive { format!("CAST({col} AS VARCHAR)") } else { format!("lower(CAST({col} AS VARCHAR))") };
            let clauses = terms.iter().map(|s|s.trim()).filter(|s|!s.is_empty()).map(|s|format!("contains({expr}, {})",literal(&if *case_sensitive{s.to_string()}else{s.to_lowercase()}))).collect::<Vec<_>>();
            if clauses.is_empty() { None } else { Some(format!("({})",clauses.join(match mode {TextMode::All=>" AND ",TextMode::Any=>" OR "}))) }
        }
    }; Ok(result)
}
