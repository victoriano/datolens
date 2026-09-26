//! Stream SPSS system files into the same local DuckDB path used by CSV/XLSX.
//! Codes remain raw data; SPSS labels and user-missing declarations are metadata.
use crate::{sql::ident, Column, Error, Result, SpssColumn, VariableKind};
use ambers::{Measure, MissingSpec, SpssMetadata};
use arrow::{array::{Array, Date32Array, DurationMicrosecondArray, Float64Array, StringViewArray, TimestampMicrosecondArray}, datatypes::DataType, record_batch::RecordBatch};
use chrono::{Duration, NaiveDate};
use duckdb::{types::Value as DbValue, Connection};
use std::{collections::BTreeMap, fs::File, io::BufReader, path::Path};

const METADATA_KEY: &str = "spss_columns";
const BATCH_ROWS: usize = 2_048;

pub(crate) fn import_sav(conn: &Connection, path: &Path) -> Result<()> {
    let reader = BufReader::with_capacity(1024 * 1024, File::open(path)?);
    let mut scanner = ambers::scan_sav_from_reader(reader, BATCH_ROWS)
        .map_err(|e| Error::Spss(e.to_string()))?;
    let metadata = scanner.metadata().clone();
    let schema = scanner.schema();
    if schema.fields().is_empty() { return Err(Error::Invalid("SPSS file has no variables".into())); }
    let mut used = std::collections::HashSet::new();
    for field in schema.fields() {
        if !used.insert(field.name().to_ascii_lowercase()) {
            return Err(Error::Invalid(format!("Duplicate SPSS variable: {}", field.name())));
        }
    }
    let codes_as_text = schema.fields().iter().map(|field| {
        field.data_type() == &DataType::Float64 && is_categorical(&metadata, field.name())
    }).collect::<Vec<_>>();
    let fields = schema.fields().iter().zip(&codes_as_text).map(|(field, codes)| {
        let ty = match field.data_type() {
            DataType::Float64 if *codes => "VARCHAR",
            DataType::Float64 => "DOUBLE",
            DataType::Utf8View | DataType::Utf8 => "VARCHAR",
            DataType::Date32 => "DATE",
            DataType::Timestamp(_, _) => "TIMESTAMP",
            DataType::Duration(_) => "BIGINT",
            other => return Err(Error::Spss(format!("Unsupported type for {}: {other}", field.name()))),
        };
        Ok(format!("{} {ty}", ident(field.name())))
    }).collect::<Result<Vec<_>>>()?.join(",");
    conn.execute_batch(&format!("CREATE TABLE dl_sav ({fields})"))?;
    let mut appender = conn.appender("dl_sav")?;
    while let Some(batch) = scanner.next_batch().map_err(|e| Error::Spss(e.to_string()))? {
        append_batch(&mut appender, &batch, &codes_as_text)?;
    }
    appender.flush()?;
    let columns = metadata_columns(&metadata);
    conn.execute("INSERT OR REPLACE INTO dl_meta VALUES (?, ?)",
        duckdb::params![METADATA_KEY, serde_json::to_string(&columns)?])?;
    Ok(())
}

fn append_batch(appender: &mut duckdb::Appender<'_>, batch: &RecordBatch, codes_as_text: &[bool]) -> Result<()> {
    for row in 0..batch.num_rows() {
        let values = batch.columns().iter().zip(codes_as_text).map(|(column, codes)| arrow_value(column.as_ref(), row, *codes)).collect::<Result<Vec<_>>>()?;
        appender.append_row(duckdb::appender_params_from_iter(values.iter()))?;
    }
    Ok(())
}

fn arrow_value(column: &dyn Array, row: usize, codes_as_text: bool) -> Result<DbValue> {
    if column.is_null(row) { return Ok(DbValue::Null); }
    if let Some(a) = column.as_any().downcast_ref::<Float64Array>() {
        let v = a.value(row);
        return Ok(if !v.is_finite() { DbValue::Null } else if codes_as_text { DbValue::Text(v.to_string()) } else { DbValue::Double(v) });
    }
    if let Some(a) = column.as_any().downcast_ref::<StringViewArray>() { return Ok(DbValue::Text(a.value(row).to_owned())); }
    if let Some(a) = column.as_any().downcast_ref::<arrow::array::StringArray>() { return Ok(DbValue::Text(a.value(row).to_owned())); }
    if let Some(a) = column.as_any().downcast_ref::<Date32Array>() {
        let epoch = NaiveDate::from_ymd_opt(1970, 1, 1).unwrap();
        let date = epoch.checked_add_signed(Duration::days(i64::from(a.value(row))))
            .ok_or_else(|| Error::Spss("Date outside supported range".into()))?;
        return Ok(DbValue::Text(date.to_string()));
    }
    if let Some(a) = column.as_any().downcast_ref::<TimestampMicrosecondArray>() {
        let timestamp = chrono::DateTime::from_timestamp_micros(a.value(row))
            .ok_or_else(|| Error::Spss("Timestamp outside supported range".into()))?;
        return Ok(DbValue::Text(timestamp.format("%Y-%m-%d %H:%M:%S%.6f").to_string()));
    }
    if let Some(a) = column.as_any().downcast_ref::<DurationMicrosecondArray>() {
        return Ok(DbValue::BigInt(a.value(row)));
    }
    Err(Error::Spss(format!("Unsupported Arrow column: {}", column.data_type())))
}

fn metadata_columns(meta: &SpssMetadata) -> BTreeMap<String, SpssColumn> {
    meta.variable_names.iter().map(|name| {
        let value_labels = meta.value_labels(name).map(|labels| labels.iter()
            .map(|(code, label)| (match code { ambers::Value::Numeric(v) => v.to_string(), ambers::Value::String(s) => s.clone() }, label.clone())).collect()).unwrap_or_default();
        let missing_values = meta.variable_missing_values.get(name).map(|specs| specs.iter().map(|spec| match spec {
            MissingSpec::Value(v) => v.to_string(),
            MissingSpec::StringValue(s) => s.clone(),
            MissingSpec::Range { lo, hi } => format!("{lo}..{hi}"),
        }).collect()).unwrap_or_default();
        (name.clone(), SpssColumn { label: meta.label(name).filter(|s| !s.trim().is_empty()).map(str::to_owned), value_labels, missing_values, categorical: is_categorical(meta, name) })
    }).collect()
}

fn is_categorical(meta: &SpssMetadata, name: &str) -> bool {
    meta.value_labels(name).is_some_and(|labels| !labels.is_empty()) ||
        matches!(meta.measure(name), Some(Measure::Nominal | Measure::Ordinal))
}

pub(crate) fn decorate_columns(conn: &Connection, columns: &mut [Column]) -> Result<()> {
    let json: String = conn.query_row("SELECT value FROM dl_meta WHERE key=?", [METADATA_KEY], |r| r.get(0))?;
    let metadata: BTreeMap<String, SpssColumn> = serde_json::from_str(&json)?;
    for column in columns {
        if let Some(spss) = metadata.get(&column.id) {
            if let Some(label) = &spss.label { column.name = format!("{} · {}", column.id, label); }
            if spss.categorical { column.kind = VariableKind::Categorical; }
            column.spss = Some(spss.clone());
        }
    }
    Ok(())
}
