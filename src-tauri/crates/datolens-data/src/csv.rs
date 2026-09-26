use super::*;

#[derive(Deserialize)]
struct CsvColumn { name: String, #[serde(rename="type")] data_type: String }

/// Infer over the complete file once, then reuse its dialect, date formats and
/// schema for the precision scan and import. Never infer IDs from a small prefix.
pub(super) fn exact_csv_relation(conn: &Connection, path: &Path) -> Result<(String, bool)> {
    let file = literal(&path.to_string_lossy());
    let sniff = format!("SELECT Delimiter,Quote,Escape,NewLineDelimiter,Comment,SkipRows,DateFormat,TimestampFormat,CAST(to_json(Columns) AS VARCHAR) FROM sniff_csv({file}, header=true, sample_size=-1, auto_type_candidates=['BOOLEAN','BIGINT','DOUBLE','DATE','TIMESTAMP','VARCHAR'])");
    let (delimiter, quote, escape, newline, comment, skip, date, timestamp, columns): (String,String,String,String,String,u64,Option<String>,Option<String>,String) = conn.query_row(&sniff, [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?)))?;
    let mut columns: Vec<CsvColumn> = serde_json::from_str(&columns)?;
    let character = |value: &str| literal(if value == "(empty)" { "" } else { value });
    let mut dialect = format!("auto_detect=false,header=true,delim={},quote={},escape={},new_line={},comment={},skip={skip}", literal(&delimiter),character(&quote),character(&escape),literal(&newline),character(&comment));
    if let Some(date) = date { dialect.push_str(&format!(",dateformat={}",literal(&date))); }
    if let Some(timestamp) = timestamp { dialect.push_str(&format!(",timestampformat={}",literal(&timestamp))); }
    let relation = |columns: &[CsvColumn], raw: bool| {
        let types = columns.iter().map(|column| format!("{}:{}",literal(&column.name),literal(if raw { "VARCHAR" } else { &column.data_type }))).collect::<Vec<_>>().join(",");
        format!("read_csv({file},{dialect},columns={{{types}}})")
    };
    let candidates: Vec<_> = columns.iter().enumerate().filter(|(_,column)| column.data_type == "DOUBLE").map(|(index,column)| (index,column.name.clone())).collect();
    let mut protected = false;
    if !candidates.is_empty() {
        let expressions = candidates.iter().map(|(_,name)| {
            let c = ident(name);
            format!("count(*) FILTER (WHERE regexp_full_match(trim({c}), '[+-]?[0-9]+') AND (TRY_CAST(trim({c}) AS BIGINT) IS NULL OR TRY_CAST(trim({c}) AS BIGINT) NOT BETWEEN -9007199254740991 AND 9007199254740991))>0")
        }).collect::<Vec<_>>().join(",");
        let mut stmt = conn.prepare(&format!("SELECT {expressions} FROM {}",relation(&columns,true)))?;
        let mut cursor = stmt.query([])?;
        let row = cursor.next()?.ok_or_else(||Error::Invalid("CSV precision scan returned no aggregate".into()))?;
        for (i,(index,_)) in candidates.iter().enumerate() {
            if row.get::<_,bool>(i)? { columns[*index].data_type = "VARCHAR".into(); protected = true; }
        }
    }
    Ok((relation(&columns,false),protected))
}
