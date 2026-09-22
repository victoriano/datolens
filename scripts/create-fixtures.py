#!/usr/bin/env python3
"""Small known-value fixtures. Uses only Python stdlib and the pinned native DuckDB."""
import csv, ctypes, json, pathlib, zipfile
from xml.sax.saxutils import escape
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'fixtures'/'generated';OUT.mkdir(parents=True,exist_ok=True)
headers=['id','empresa','pais','facturacion','fecha','activa']
countries=['ES','FR','ES','PT','FR','ES','ES','FR','ES','PT','FR','ES']
rows=[[str(9007199254740993+i*2),f'Empresa {i+1:02}',countries[i],None if i==3 else (i+1)*100,f'2025-{i+1:02}-15',i%2==0] for i in range(12)]
with (OUT/'empresas.csv').open('w',newline='') as f:
    w=csv.writer(f);w.writerow(headers);w.writerows(rows)
def sheet(data):
    cells=[]
    for ri,row in enumerate(data,1):
        cols=[]
        for ci,value in enumerate(row):
            if value is None:continue
            addr=f'{chr(65+ci)}{ri}'
            if isinstance(value,bool):cols.append(f'<c r="{addr}" t="b"><v>{int(value)}</v></c>')
            elif isinstance(value,(int,float)):cols.append(f'<c r="{addr}"><v>{value}</v></c>')
            else:cols.append(f'<c r="{addr}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>')
        cells.append(f'<row r="{ri}">{"".join(cols)}</row>')
    return f'<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{"".join(cells)}</sheetData></worksheet>'
with zipfile.ZipFile(OUT/'empresas.xlsx','w',zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml','''<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>''')
    z.writestr('_rels/.rels','''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>''')
    z.writestr('xl/workbook.xml','''<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Empresas" sheetId="1" r:id="rId1"/><sheet name="Notas" sheetId="2" r:id="rId2"/></sheets></workbook>''')
    z.writestr('xl/_rels/workbook.xml.rels','''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>''')
    z.writestr('xl/worksheets/sheet1.xml',sheet([headers,*rows]));z.writestr('xl/worksheets/sheet2.xml',sheet([['nota'],['Fixture de QA local']]))
lib=ctypes.CDLL(str(ROOT/'vendor/duckdb/libduckdb.dylib'))
ptr=ctypes.c_void_p
lib.duckdb_open.argtypes=[ctypes.c_char_p,ctypes.POINTER(ptr)];lib.duckdb_connect.argtypes=[ptr,ctypes.POINTER(ptr)]
lib.duckdb_query.argtypes=[ptr,ctypes.c_char_p,ptr];lib.duckdb_disconnect.argtypes=[ctypes.POINTER(ptr)];lib.duckdb_close.argtypes=[ctypes.POINTER(ptr)]
db=ptr();conn=ptr();assert lib.duckdb_open(None,ctypes.byref(db))==0;assert lib.duckdb_connect(db,ctypes.byref(conn))==0
csvpath=str(OUT/'empresas.csv').replace("'","''");parquet=str(OUT/'empresas.parquet').replace("'","''")
assert lib.duckdb_query(conn,f"COPY (SELECT * FROM read_csv_auto('{csvpath}',header=true)) TO '{parquet}' (FORMAT PARQUET)".encode(),None)==0
lib.duckdb_disconnect(ctypes.byref(conn));lib.duckdb_close(ctypes.byref(db))
(OUT/'expected.json').write_text(json.dumps({'rows':12,'countryCounts':{'ES':6,'FR':4,'PT':2},'ES_and_revenue_min500':4,'firstLongID':'9007199254740993','xlsxSheets':['Empresas','Notas'],'records':rows},ensure_ascii=False,indent=2))
print(OUT)
