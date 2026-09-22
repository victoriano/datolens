# Integración — MVP local ejecutable y verificado

Fecha: 22 de septiembre de 2026. Bundle real macOS Apple Silicon en
`src-tauri/target/debug/bundle/macos/Datolens.app`.

- Tauri/React integrados con los motores nativos de datos y enriquecimientos por
  IPC; paginación y proyección, sin dataset completo en JavaScript.
- Selector macOS, selección de hoja XLSX, eventos drop, persistencia local,
  resultados/cola SQLite, adaptador Keychain y proveedor Gemini conectados.
- DuckDB 1.5.5 oficial incluido en el bundle, checksum fijado; firma ad hoc local
  verificada. Build final mediante `scripts/build-macos.sh`.
- Verificación: TypeScript/build PASS, modelo explorador 8 PASS, integración
  Rust 2 PASS, datos 12 PASS y scheduler 12 PASS. Benchmark explícito adicional.
- Recorrido real: CSV/XLSX/Parquet, filtros cruzados, sorting múltiple, columnas,
  portapapeles con ID largo exacto, exportación/reapertura y vista tras ⌘Q/reinicio.
- CSV Idealista real 94.815×41 verificado, incluida la fila `NA` tardía y su filtro.
- Corrección posterior: enteros CSV fuera de BIGINT preservados como texto antes
  de cualquier conversión DOUBLE. Dos regresiones prueban exportación/reapertura,
  reparación transaccional de cachés y conservación de vistas/resultados.
- El paquete conjunto incluye el parche del explorador para reintentar la
  operación que falló y bloquear selección/copia por teclado durante una consulta.
  Reintento de apertura probado en macOS antes/después: reponer un fixture ausente
  y pulsar Reintentar ahora abre sus cinco filas; antes solo quitaba el error.
- Rendimiento medido con 1M CSV y 1M/5M Parquet; condiciones y cifras en QA.
- Enriquecimiento: definición/columna/plan visibles en app; cadena A→B→C,
  invalidación, fallos parciales y persistencia probados con proveedor determinista.
  **Gemini real y escritura de clave real en Keychain no probados**: no se
  introdujeron credenciales ni se hicieron llamadas facturables.

Evidencia, comandos y límites: [QA.md](../QA.md). Drag-and-drop está conectado,
pero no se registró un arrastre real desde Finder. La app es una entrega local,
sin notarización ni publicación; no se han creado commits ni repos remotos.
