# Carga, crossfilters y muestreo — 2026-09-23

> Actualización posterior: [Crossfilters progresivos](progressive-crossfilters.md) sustituye el muestreo de todas las columnas y la pausa de Auto remoto. Esta página conserva la evidencia de la entrega anterior.

Propietario: tarea `01a0cd63-3b40-7643-b572-9f87ae78010c`. Cambios coordinados con integración y con las tareas de progreso de carga y workspace. Sin cambios en Datoflow, commits, pushes ni publicación.

## Implementado

- Muestreo nativo aleatorio reservoir, semilla 42 y una sola hebra al construirlo; la misma muestra se comparte entre todas las variables/filtros y entre reaperturas. Inspirado en `src/lib/analysis/engine.ts` y `src/lib/duckdb/memory-budget.ts` de Datoflow, consultados en modo lectura.
- Auto: presupuesto orientativo de 64 MiB a 48 bytes/celda, ajustado por anchura, entre 1.000 y 100.000 filas. NYC (59 columnas) usa 23.000. Es un presupuesto orientativo, no un límite de memoria física por fila; DuckDB mantiene su límite de ejecución/spilling existente.
- Control en panel Variables: automático, tamaños predefinidos, número personalizado (1–5.000.000) y todas las filas. Persistencia por dataset en `ViewState.analysisSampling`. Vista antigua o valor inválido vuelve a Auto.
- Solo distribuciones y estadísticas del panel usan la muestra. Conteos de barras/selección y denominadores relativos/significatividad corresponden a las filas analizadas; aviso visible en panel y tabla. Tabla, conteo total filtrado, IDs, exportaciones, gráficos del espacio Charts, joins y alcance IA conservan la población completa.
- Muestra persistida en caché DuckDB (no fuente ni sidecar), con clave de revisión/esquema/casts/fórmulas/tamaño. Cambios de resultados invalidan la clave dentro de la misma transacción que los valores. No se reconstruye al filtrar, paginar o guardar una vista. Reapertura valida tamaño y clave. Una sola muestra persistente por dataset.
- Estadísticas costosas (distintos, cuartiles, etc.) solo para variables donde se abren; cache de distribuciones sin filtro y límites de histogramas. Cache acotada de conteos exactos para paginación.
- Cola de solicitudes que descarta las obsoletas antes de IPC, debounce 100 ms y lotes de 8 variables con publicación progresiva. El panel oculto no consulta distribuciones. El motor sigue en `spawn_blocking` y los datos permanecen nativos.
- CSV: inferencia completa una sola vez (`sniff_csv`), replay explícito de tipos, delimitador, comillas, saltos de línea y formatos fecha; protección de enteros grandes antes de conversiones DOUBLE. No se redujo inferencia a un prefijo. Compatibilidad de cache v3 preservada.
- Página sin filtro/orden: poda por ordinal antes de ordenar las filas visibles, conservando identidad/orden estable y conteo exacto.

## Verificaciones

- `datolens-data`: 49 PASS, 2 pruebas manuales preexistentes ignored. Incluye 4 tests de muestreo y 2 de replay CSV. `docs/qa/sampling-native-tests.txt`.
- Muestreo persistente después de su última modificación: 4 PASS; estabilidad, reapertura, cambio de tamaño, actualización de resultados/casts, exportación completa, listas, vacíos e IDs grandes. `docs/qa/sampling-cache-tests.txt`.
- Raíz Rust: 9 PASS, `docs/qa/sampling-root-tests.txt`.
- Frontend: 49 PASS, `docs/qa/sampling-frontend-tests.txt`; TypeScript PASS. Incluye cancelación de trabajo obsoleto, lotes y restauración del tamaño.
- UI de fixture en IAB: panel, selector y popover visibles y legibles en tema oscuro. No equivale a prueba del motor real.

## Medición reproducible

Archivo real `/Users/victoriano/Downloads/Datos-CSV/NYC 311 Calls - 1.2M.csv`, 1.123.454 filas, 59 columnas, ~785 MiB. Ejemplo Rust `src-tauri/examples/crossfilter_benchmark.rs`; misma máquina, biblioteca DuckDB vendida por proyecto, 2 hebras de consulta, perfil debug. Cachés de proyecto separadas en `/tmp/datolens-performance`; caché del SO sin purgar. Tiempos nativos: no incluyen IPC, debounce ni render. La comparación es trabajo exacto anterior contra análisis muestreado nuevo, no una aceleración manteniendo exactitud de las distribuciones.

| Medición | Antes, sin cache de proyecto | Después, sin cache de proyecto | Después, reapertura con muestra guardada |
|---|---:|---:|---:|
| Apertura/importación | 35.344 ms | 36.420 ms | 129 ms |
| Primera página (100 filas, 59 columnas) | 306 ms | 31 ms | 63 ms |
| 59 distribuciones iniciales | 5.795 ms | 1.547 ms | 176 ms |
| Crossfilter NYPD | 4.368 ms | 176 ms | 168 ms |
| Población analizada | 1.123.454 | 23.000 | 23.000 |
| NYPD en tabla, exacto | 317.766 | 317.766 | 317.766 |
| NYPD en gráficos | 317.766 | 6.539 | 6.539 |

La primera iteración de CSV optimizado dio 22.296 ms; la repetición final dio 36.420 ms. No se atribuye una mejora estable al tiempo de primera importación: fluctúa con E/S, caché y carga de la máquina. Sí elimina detecciones redundantes y mantiene los tests de precisión. El beneficio confirmado es en interacciones y reapertura: 168 ms frente a 4.368 ms (~26x), ~192 ms hasta primera página con cache. Evidencia cruda: `crossfilter-performance-before.txt`, `crossfilter-performance-after-cold.txt`, `crossfilter-performance-final-cold.txt`, `crossfilter-performance-final-warm.txt`.

## QA nativa final

PASS en `Datolens Sampling QA.app`, compilada secuencialmente de la fuente final con identifier Tauri independiente y firmada. CSV real de NYC clonado mediante APFS para aislar el sidecar; ruta de almacenamiento QA comprobada con `lsof`. Se verificaron Auto 23.000, NYPD 6.539 de muestra frente a 317.766 exactas en tabla, preset 50.000, personalizado 25.000, cierre normal/reapertura con el mismo tamaño y selección, modo completo exacto 1.123.454/NYPD 317.766 y retorno a Auto sin filtros. Evidencia y hashes: `docs/qa/sampling-final-native.md`.

Bundle principal final generado, firmado y verificado en `src-tauri/target/debug/bundle/macos/Datolens.app`, a las 11:01:52 +0200. No se reinició la sesión principal del usuario, que mantiene un diálogo Jev, ni se alteraron sus vistas. La selección ambigua entre dos procesos de ese bundle es un hecho observado; no se atribuye una causa definitiva a la ventana blanca anterior. La instancia QA aislada arrancó y funcionó correctamente. Smoke `+`/cancelar/carpeta inicial PASS por Workspace sobre el mismo paquete QA, sin otro build (`docs/qa/workspace-add-tab-native.md`). Instancia QA cerrada normalmente tras dejar Auto sin filtros; servidores propios y cachés temporales de benchmark liberados.
