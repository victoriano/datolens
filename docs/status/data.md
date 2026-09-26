# Datos — recibo de verificación integrada

## Importación SPSS SAV (23 de septiembre de 2026)

- `.sav` se acepta en el selector y se importa por lotes de 2.048 filas en Rust a DuckDB local, dentro de una transacción. El archivo original se lee sin modificarlo.
- Se conservan códigos, valores numéricos continuos, fechas, nulos, nombres y etiquetas de variables/respuestas. Las columnas codificadas se filtran por código; la tabla y las distribuciones muestran `código · etiqueta`. Los valores perdidos definidos por el usuario en SPSS se conservan como códigos y metadatos visibles; los agregados actuales los cuentan como categorías, mientras que los perdidos del sistema son nulos.
- Prueba sintética: importación, acentos, ponderación, fecha, código perdido, filtro, exportación CSV, restauración de etiquetas/vista y bytes de fuente sin cambios. Suite de datos: 29 pruebas aprobadas; el benchmark y la prueba que requiere una ruta `.sav` externa quedan ignorados en la ejecución por defecto.
- Prueba con un `.sav` real de microdatos CIS (`66091222.sav`): 15.242 filas, 155 variables, 148 con etiquetas de valores; apertura en 2,4 s con caché del sistema sin vaciar. Página, distribución y filtro por código aprobados; bytes originales idénticos antes y después.
- Bundle de QA `Datolens SAV QA.app`: selector nativo, apertura y tabla confirmados; 15.242 de 15.242 filas, 155 columnas y respuestas etiquetadas visibles. El bundle principal `Datolens.app` se reconstruyó y firmó después.

Limitación observada: algunas etiquetas del propio archivo contienen los bytes `E2 3F AC` donde se esperaría `€`, de modo que se muestran como `â?¬`. Esos bytes ya están en el `.sav` original; los valores numéricos y códigos no se ven afectados.

Recibo completado por integración el 22 de septiembre de 2026 a partir de las
pruebas observadas. Motor en `src-tauri/crates/datolens-data/`.

- CSV con inferencia completa y materialización inicial; XLSX por hoja mediante
  Calamine; Parquet consultado en nativo mediante DuckDB 1.5.5.
- Páginas/proyección, sorting global, filtros cruzados, distribuciones,
  identidad estable de filas, IDs largos exactos y resultados persistidos.
- Persistencia versionada de vistas y detección de cambio de fuente;
  exportación CSV/Parquet con columnas, filtros y orden solicitados.
- Suite observada: **12 PASS**, cero fallos; un benchmark ignorado por defecto,
  ejecutado explícitamente. Evidencia: [native-tests.txt](../qa/native-tests.txt).
- Regresión CSV con texto posterior a la muestra inicial cubierta. Archivo
  Idealista real: 94.815 filas y 41 columnas, `NA` conservado y filtro de una fila
  verificados en la app. [Detalle del bug](csv-import-bug.md).
- Rendimiento: CSV 1M primera página incluida apertura 2.727 ms; Parquet 1M
  57 ms; Parquet 5M 65 ms. Caché del sistema no vaciada, proceso nativo de
  benchmark; no equivalen al tiempo de arranque completo del shell/WebKit.

El recorrido real con los tres formatos, exportación/reapertura y restauración
tras cerrar el proceso está documentado en [QA.md](../QA.md). XLSX carga una hoja
en memoria; categorías limitadas a las 256 más frecuentes con aviso en la UI;
nulos visibles sin filtro específico. No se modificaron las fuentes originales.

## Corrección de precisión CSV

La inferencia antigua convertía enteros fuera de BIGINT a DOUBLE y podía colapsar
valores distintos. Integración corrigió la conversión antes de materializar datos:
las columnas inferidas DOUBLE se comprueban contra los tokens originales de todas
las filas; si contienen enteros fuera del rango seguro ±(2^53−1), se conservan como
VARCHAR, incluidos los valores decimales vecinos. Las columnas BIGINT mantienen
su tipo y los enteros grandes viajan por IPC como cadenas exactas.

La versión 3 del importador repara cachés antiguas transaccionalmente, manteniendo
IDs/filas, resultados, definiciones y vistas. La migración JSON se puede reintentar
tras un cierre entre commit y escritura del fichero. Se cambia la revisión de
entradas reparadas para invalidar planes congelados sin borrar resultados.

Dos regresiones adicionales pasan: valores fuera de BIGINT y mixtos mayores de
2^53, exportación/reapertura CSV y Parquet, reparación de caché e interrupción de
migración. Evidencia en [csv-precision-tests.txt](../qa/csv-precision-tests.txt)
y [QA.md](../QA.md). El candidato HUGEINT no se ha reintroducido en el detector.

## API pública para integración

`DataStore` es `Send`, síncrono y no `Sync`: envolver en `Arc<Mutex<_>>` y ejecutar
operaciones en `spawn_blocking`. No llamar al motor desde el hilo de UI.

- `DataStore::open(&Path, Option<&str>, &Path)` abre fuente/hoja y directorio local
  escribible; `list_sheets(&Path)` lista hojas sin descargar extensiones.
- `dataset()` devuelve el catálogo y revisión; `query_page(PageRequest)` devuelve
  una proyección acotada a 10.000 filas, conteo y orden global con desempate por ID.
- `distributions(&[String], &[Filter])` agrega el dataset completo en nativo;
  máximo 64 columnas por petición y `truncated` para categorías top 256.
- `row_ids(filters, offset, limit)` congela selecciones por IDs; `row_values(id,
  columns)` lee exclusivamente valores solicitados.
- `ensure_result_column(Column)` requiere `&mut self`; `apply_results(&[CellUpdate])`
  realiza upserts idempotentes en una transacción y valida revisión de dataset.
  El scheduler debe validar además las revisiones de prompt y entradas en vuelo.
- `save_view(Value)` / `load_view()` y `save_enrichments(Value)` /
  `load_enrichments()` preservan mutuamente vista y definiciones en JSON versionado
  escrito de forma atómica. Trabajos e historial pertenecen al scheduler.
- `export(ExportRequest)` exporta CSV/Parquet filtrado y ordenado, incluidos los
  resultados; rechaza sobrescribir rutas existentes.
- `database_path()` / `project_path()` exponen almacenamiento para integración.

La identidad usa ruta canónica, hoja, tamaño, modificación y tres muestras de
64 KiB; no se calcula una huella completa de archivos enormes. No detecta una
modificación deliberada fuera de esas muestras que conserve tamaño y mtime.
CSV no ofrece páginas antes de terminar inferencia/importación inicial; XLSX
materializa una hoja en memoria nativa. El perfil semántico de texto/listas usa
hasta 10.000 filas, pero los filtros y conteos se aplican al dataset entero.

## Ampliación posterior: estado junto al archivo original

El JSON de proyecto se guarda ahora junto a la fuente, con migración desde el
almacén previo y separación segura por hoja XLSX. Bases de datos y resultados
conservan sus rutas. Una carpeta de origen sin escritura utiliza una copia local
de recuperación con aviso visible. Detalles y 18 pruebas de datos PASS en
[crossfilters-workspace.md](crossfilters-workspace.md).
