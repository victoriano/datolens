# Parquet remoto — capa de datos (2026-09-23)

> Actualización posterior: [Crossfilters progresivos](progressive-crossfilters.md) sustituye el muestreo de todas las columnas y la pausa de Auto remoto. Esta página conserva la evidencia de la entrega anterior.

Propietario: tarea de rendimiento/muestreo `01a0cd63-3b40-7643-b572-9f87ae78010c`, coordinada con Integración y Workspace. Esta entrega corresponde al motor; la integración IPC, UI y QA del paquete final se verifican por Integración.

## Contrato implementado

`DataStore::open_remote_parquet_with_progress(url: &str, storage_dir: &Path, httpfs_path: &Path, progress: &dyn Fn(&str)) -> Result<Self>`

- `source_bytes() -> u64`, `is_remote() -> bool` disponibles para almacenamiento/acciones de fuente.
- SourcePath es la URL pública original normalizada. Una revisión incorpora URL resuelta, ETag fuerte, longitud y hash del footer Parquet. Los ordinales físicos de `file_row_number` conservan IDs entre consultas/reaperturas de esa revisión.
- Base de datos y sidecar remotos quedan dentro de Application Support; `ViewSaveResult.besideSource=false`. Las firmas locales omiten el nuevo campo opcional remoto: su formato e identidad existentes se conservan.
- Se guardan vistas, casts, fórmulas y resultados usando los mecanismos existentes. El registro de trabajos sigue perteneciendo a AppService.
- `Error::RemoteDownloadRequired` es una variante sin payload. El host descarga de forma visible cuando faltan Range real o ETag fuerte, y para URLs con parámetros de credenciales. Respuestas incoherentes/cambio de versión fallan sin convertirlo en descarga silenciosa.

## Lectura parcial y límites

- Inspección: GET Range de magic/footer, exige 206 y Content-Range/longitud coherentes. Accept-Ranges por sí solo no basta. Una respuesta 200 se cierra sin consumir su cuerpo completo desde esta capa.
- Esquema y población por metadatos (`DESCRIBE` y `parquet_file_metadata`), sin perfiles iniciales de valores VARCHAR. Vista sobre `read_parquet`; sin copia completa a tabla fuente.
- HTTPFS carga por ruta explícita desde un recurso oficial fijado y firmado. Autoinstall/autoload deshabilitados, force_download=false, threshold=0, prefetch Parquet deshabilitado. No runtime INSTALL.
- Todas las lecturas DuckDB llevan If-Match para la revisión fijada. Validación previa de revisión con HEAD (GET mínimo si HEAD no está disponible). No HTTPS→HTTP, máximo cinco redirecciones iniciales; una revisión fijada no sigue redirecciones nuevas.
- Auto devuelve `Distributions.deferredReason="remote_source"` sin leer columnas ni fabricar una muestra. La UI debe mostrar el aplazamiento y permitir elegir un tamaño o Todas explícitamente.
- Un tamaño manual usa el reservoir estable existente y puede recorrer la fuente completa. Conteos filtrados exactos, ordenación, gráficos exactos, exportaciones y materializaciones/joins pueden leer muchas columnas o todas las filas tras una acción explícita. No se promete que sean parciales.
- La cantidad mínima de datos físicos depende de los row groups, páginas y caché de bloques HTTPFS. Un archivo pequeño o con un grupo/columna enorme puede requerir casi todo al consultar sus filas, aunque soporte Range. La garantía es no hacer una descarga completa anticipada por diseño, no un porcentaje universal menor que 100%.
- La extensión verificada es macOS ARM64; Intel requiere otro artefacto fijado. La fuente remota debe permanecer disponible; la caché de perfiles/páginas no convierte el dataset en una copia offline completa.

## Dependencias y recurso

- `reqwest` 0.12 blocking + rustls-tls en crate data; lockfile del crate actualizado por Cargo.
- `vendor/httpfs/osx_arm64/httpfs.duckdb_extension` debe incluirse como `httpfs/osx_arm64/httpfs.duckdb_extension` en recursos Tauri.
- DuckDB v1.5.5, plataforma osx_arm64; LOAD real comprobado con verificación de firma predeterminada. Origen, hashes y script reproducible: `vendor/httpfs/PROVENANCE.md`, `vendor/httpfs/prepare.sh`.

## Verificación

Suite completa de datos: **54 PASS, 2 pruebas manuales preexistentes ignored**. `docs/qa/remote-parquet-data-tests.txt`.

Los cinco tests HTTP nuevos cubren Range/bytes efectivamente solicitados; primera página de 100 filas con todas las columnas; página a partir de ordinal 70.000; Auto sin tráfico adicional; IDs, vistas, resultados y muestra manual persistentes; filtros exactos; falta de Range o ETag fuerte; intervalos incorrectos; cambio antes/durante consulta; URLs que no deben persistir credenciales. Servidor TCP local con If-Match y conteo de bytes, biblioteca httpfs real.

| Operación acumulada | Bytes recibidos por Range |
|---|---:|
| Tamaño del fixture Parquet (80.000 filas, 4 columnas) | 9.013.742 |
| Apertura/esquema/conteo por metadatos | 51.854 |
| Auto diferido | 51.854 (ningún byte adicional) |
| Primera página: 100 filas, todas las columnas | 1.100.430 |
| Más página de 5 filas/id desde ordinal 70.000 | 2.149.006 |

Los conteos incluyen respuestas repetidas y lecturas por bloques; no son memoria ocupada ni bytes de un archivo descargado. La prueba comprueba que no se envían cuerpos 200 completos en la ruta Range y que las lecturas posteriores están condicionadas por la revisión.

Referencias técnicas: [DuckDB HTTP partial reading](https://duckdb.org/docs/current/core_extensions/httpfs/https), [Parquet projection/filter pushdown](https://duckdb.org/docs/current/data/parquet/overview).
