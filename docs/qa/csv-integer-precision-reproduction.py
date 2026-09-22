#!/usr/bin/env python3
"""Reproduce the original CSV importer precision loss with the bundled DuckDB.

This intentionally pins the OLD importer SQL to retain pre-fix evidence; it is
not an assertion about the current DataStore implementation.
"""
import csv
import ctypes
import pathlib
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
lib = ctypes.CDLL(str(ROOT / 'vendor/duckdb/libduckdb.dylib'))
ptr = ctypes.c_void_p
lib.duckdb_open.argtypes = [ctypes.c_char_p, ctypes.POINTER(ptr)]
lib.duckdb_connect.argtypes = [ptr, ctypes.POINTER(ptr)]
lib.duckdb_query.argtypes = [ptr, ctypes.c_char_p, ptr]
lib.duckdb_disconnect.argtypes = [ctypes.POINTER(ptr)]
lib.duckdb_close.argtypes = [ctypes.POINTER(ptr)]
db, conn = ptr(), ptr()
assert lib.duckdb_open(None, ctypes.byref(db)) == 0
assert lib.duckdb_connect(db, ctypes.byref(conn)) == 0
try:
    with tempfile.TemporaryDirectory(prefix='datolens-precision-') as tmp:
        folder = pathlib.Path(tmp)
        values = ['9223372036854775808', '9223372036854775809',
                  '18446744073709551615', '123456789012345678901234567890']
        source = folder / 'integers.csv'
        source.write_text('id\n' + '\n'.join(values) + '\n')
        out = folder / 'observed.csv'
        relation = (f"read_csv_auto('{source}', header=true, sample_size=-1, "
                    "auto_type_candidates=['BOOLEAN','BIGINT','DOUBLE','DATE','TIMESTAMP','VARCHAR'])")
        query = (f"COPY (SELECT typeof(id) AS inferred_type, CAST(id AS VARCHAR) AS observed "
                 f"FROM {relation}) TO '{out}' (FORMAT CSV, HEADER TRUE)")
        assert lib.duckdb_query(conn, query.encode(), None) == 0
        with out.open() as stream:
            for expected, row in zip(values, csv.DictReader(stream)):
                print({'input': expected, **row, 'exact': expected == row['observed']})
finally:
    lib.duckdb_disconnect(ctypes.byref(conn))
    lib.duckdb_close(ctypes.byref(db))
