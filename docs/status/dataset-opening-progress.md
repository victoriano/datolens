# Apertura de datasets: progreso y espacio

Implementado el 23-09-2026:

- La apertura desde el selector, una pestaña o drag & drop muestra fases nativas: inspección, importación a caché cuando procede, preparación y restauración. La barra es indeterminada porque DuckDB y los importadores XLSX/SAV no exponen un avance comparable por bytes para todas las fases. No se presenta un porcentaje inventado.
- La banda muestra el tamaño del archivo original durante la apertura. Tras abrir, cada pestaña muestra los bytes actuales de la base DuckDB local y su WAL. Es espacio en disco en ese momento, no una estimación de RAM ni un límite máximo; puede crecer al guardar resultados.
- CSV, XLSX y SAV se materializan en una caché local; Parquet se consulta desde su archivo. La UI sigue operativa mientras el trabajo nativo se ejecuta fuera del WebView.

Verificación: `bun run build`, `cargo check -q` y `bun run tauri build --debug --bundles app` correctos. En un bundle de QA aislado se abrió `/tmp/datolens-progress-qa.csv` (250.000 filas, 17,3 MB): durante la carga apareció «Importing data into local cache» con el tamaño del archivo y, al terminar, «Cache 3.3 MB» en la pestaña; la tabla mostró 250.000 filas. El mismo flujo `open` atiende selector y drag & drop. Drag & drop no se reprodujo manualmente en esta comprobación.
