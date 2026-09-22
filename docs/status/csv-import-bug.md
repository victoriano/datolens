# CSV con texto fuera de la muestra de inferencia

Fecha: 2026-09-22. Estado: **DONE**. Corrección aplicada, pruebas nativas aprobadas,
bundle reconstruido y firmado, y archivo real comprobado en la aplicación macOS.

## Archivo y síntoma

- Archivo del usuario: `/Users/victoriano/Downloads/Datos-CSV/idealista_dataset.csv`.
- Tamaño: 19.944.577 bytes; 94.815 filas de datos y 41 columnas.
- SHA-256: `e13c5d53007c98f06092026abba348af1146c54ca89cc639fb79670a505f31f7`.
- `CADASTRALQUALITYID` tiene un único texto `NA`, en la línea CSV 24.632
  (ordinal de datos 24.630). Las demás celdas de esa columna son códigos 0–9.
- La importación con muestreo por defecto reproduce el error de conversión de
  `NA` a `BIGINT` observado en la captura. La fuente se ha leído sin modificarla.

## Causa y corrección coordinada

La inferencia por muestra no incluía ese valor y elegía un tipo numérico que no
podía representar toda la columna. Datos ha aplicado `sample_size=-1` y
materializa el CSV una vez antes de perfilar columnas. Así se considera todo
el archivo para elegir los tipos y no se repite esa lectura en cada perfil.

No se descartan filas ni se interpreta arbitrariamente `NA` como nulo. La columna
mixta se conserva como `VARCHAR`; las columnas numéricas mantienen su tipo.

La versión intermedia que añadía `HUGEINT` a `auto_type_candidates` no es válida
en DuckDB 1.5.5. Tras coordinar con integración y avisar a datos, esta tarea ha
retirado únicamente ese candidato de `store.rs:61`, conservando los demás cambios.

## Evidencia independiente

Verificación mediante la API C de la propia
`vendor/duckdb/libduckdb.dylib` (v1.5.5), base temporal en disco, 512 MB de límite
y dos hilos. No se ha usado una versión distinta de DuckDB ni la base del usuario.

- Lectura independiente con `csv.DictReader`: 94.815 filas, 41 columnas y un `NA`.
- Configuración original: error reproducido en la línea 24.632.
- Inferencia de todo el archivo con candidatos admitidos por DuckDB: 94.815 filas,
  `CADASTRALQUALITYID` de tipo `VARCHAR`, un `NA` y cero nulos en esa columna.
- El `NA` conserva el ordinal 24.630.
- Las once frecuencias de esa columna coinciden exactamente entre el lector CSV
  independiente y DuckDB: 0=377, 1=629, 2=2.703, 3=12.634, 4=24.673,
  5=20.725, 6=20.491, 7=10.428, 8=1.527, 9=627, NA=1.
- Materialización nativa observada: 0,743 s en esta ejecución con caché de archivos
  caliente; no es una medida del tiempo total de apertura de la interfaz.

La [documentación oficial de DuckDB](https://duckdb.org/docs/current/data/csv/auto_detection#sample-size)
confirma la muestra de 20.480 filas por defecto y el significado de `sample_size=-1`.

## Bundle y comprobación nativa

- Bundle reconstruido por integración:
  `src-tauri/target/debug/bundle/macos/Datolens.app`.
- `codesign --verify --deep --strict` aprobado en una comprobación independiente.
- El ejecutable nuevo contiene `sample_size=-1` y no contiene el candidato CSV
  incompatible `HUGEINT`. La biblioteca incluida responde `v1.5.5` por su API C.
- SHA-256 del CSV comprobado de nuevo tras las pruebas: coincide con el original.
- Apertura mediante el selector nativo de la app: `idealista_dataset.csv`,
  **Tabla 94.815 de 94.815 filas**, **Columnas 41**, sin error de conversión.
- En el panel de variables, buscar `CADASTRALQUALITYID` y mostrar sus once valores
  permite seleccionar `NA 1`. La tabla pasa a **1 de 94.815 filas** y conserva la
  celda `NA` de la misma fila que causaba el error original.
- Captura de la app real registrada en la tarea del bug, además del árbol de
  accesibilidad con la tabla y el valor comprobados. No se usó un fixture web.
- Filtro y búsqueda de prueba limpiados al terminar. La app queda abierta con el
  archivo del usuario y sus 94.815 filas; interfaz devuelta a integración.

## Suite del motor verificada

Integración cedió temporalmente el target raíz. Ejecución observada tras retirar
el candidato incompatible:

```sh
CARGO_TARGET_DIR="$PWD/src-tauri/target" CARGO_PROFILE_DEV_DEBUG=0 \
CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0 \
DYLD_LIBRARY_PATH="$PWD/vendor/duckdb" "$HOME/.cargo/bin/cargo" test \
  --offline --locked --manifest-path src-tauri/crates/datolens-data/Cargo.toml \
  -- --test-threads=2
```

```text
test csv_late_text_outlier_is_preserved_after_default_sniff_window ... ok
test result: ok. 10 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.38s
```

La prueba omitida es el benchmark independiente de un millón de filas. Las diez
pruebas ejecutadas cubren la regresión de inferencia, CSV/XLSX/Parquet, tipos,
precisión de IDs, filtros, orden, distribuciones, listas, persistencia y exportación.
Compilación observada: 3,45 s. No se han cambiado dependencias ni lockfiles.

El target quedó libre y se devolvió a integración para reconstruir el bundle.
Esta tarea no modifica contratos ni `reference/`; la corrección de la línea del
importador se realizó con cesión expresa del coordinador.

Integración repitió además la suite nativa final con el importador corregido:
`/private/tmp/datolens-native-tests-final.log` confirma **23 pruebas aprobadas:
1 de integración, 10 de datos y 12 del scheduler; cero fallos**. La prueba omitida seguía siendo el
benchmark independiente. La comprobación de este bug no utiliza llamadas Gemini.
