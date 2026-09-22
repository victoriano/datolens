import ctypes,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
out=root/'fixtures/generated';out.mkdir(exist_ok=True,parents=True)
lib=ctypes.CDLL(str(root/'vendor/duckdb/libduckdb.dylib'));ptr=ctypes.c_void_p
lib.duckdb_open.argtypes=[ctypes.c_char_p,ctypes.POINTER(ptr)];lib.duckdb_connect.argtypes=[ptr,ctypes.POINTER(ptr)];lib.duckdb_query.argtypes=[ptr,ctypes.c_char_p,ptr];lib.duckdb_close.argtypes=[ctypes.POINTER(ptr)];lib.duckdb_disconnect.argtypes=[ctypes.POINTER(ptr)]
db=ptr();conn=ptr();assert lib.duckdb_open(None,ctypes.byref(db))==0;assert lib.duckdb_connect(db,ctypes.byref(conn))==0
for rows,kind in [(1000000,'csv'),(5000000,'parquet')]:
 target=out/f'benchmark-{rows}.{kind}'
 if target.exists():continue
 sql=f"COPY (SELECT i::BIGINT AS id, (i%100)::INTEGER AS category, (i*0.5)::DOUBLE AS amount FROM range({rows}) t(i)) TO '{str(target).replace(chr(39),chr(39)*2)}' (FORMAT {kind.upper()})"
 assert lib.duckdb_query(conn,sql.encode(),None)==0
 print(target)
lib.duckdb_disconnect(ctypes.byref(conn));lib.duckdb_close(ctypes.byref(db))
