# Transiciones de crossfilters — 2026-09-23

Solicitud: evitar que al filtrar desaparezcan los gráficos y estadísticas del panel de variables y se comprima temporalmente el layout.

## Implementado

- `useDistributions` conserva el último conjunto visible durante un cambio de filtros. Los lotes de la nueva selección se publican juntos cuando está listo el viewport solicitado, evitando mezclar recuentos de poblaciones distintas. La carga inicial y el scroll a columnas nuevas siguen siendo progresivos.
- La retención solo se permite para el mismo API/dataset/revisión/muestra. Las tarjetas fuera del viewport de la selección anterior no se incorporan a los resultados nuevos. Las peticiones canceladas no publican; si hay un error se conservan los gráficos, termina Updating y se indica que son resultados anteriores.
- El indicador empieza en el cambio de filtro, incluido el debounce. No se muestra Updating indefinidamente cuando no se demanda ninguna variable.
- Las estadísticas mantienen su DOM y sus valores durante el recálculo. Los accesos por cuantiles esperan a tener resultados disponibles. El alcance de las cifras mostradas corresponde al conjunto retenido hasta publicar el nuevo.
- Los histogramas mantienen el canvas y los tuples de Vega. Solo se modifican los recuentos que cambian; el brush, la escala relativa y la selección se sincronizan por separado. Un cambio de intervalo no vuelve a insertar todas las barras.
- Las barras categóricas interpolan su anchura durante 150 ms, respetando `prefers-reduced-motion`.

## Verificación automatizada

- `bun test src/features src/platform src/ui`: **76 PASS, 0 fallos, 2.015 aserciones**. Log: `docs/qa/filter-transition-tests.txt`.
- Tests de publicación atómica, invalidación de fuentes, selección vacía, retención de estadísticas, identidad de tuples Vega numéricos/fechas y cambios consecutivos antes de completar el render.
- TypeScript y build macOS PASS; firma `codesign --verify --deep --strict` PASS.
- Fixture DOM con hook, Variables y Vega reales: `docs/qa/filter-transition-regression.html`, ejecutada en IAB Chromium con 246 columnas generadas y 220 ms de latencia por lote. **304 frames observados; 0 placeholders, 0 canvas reemplazados, 0 pérdidas de altura y 0 desmontajes de estadísticas** durante filtros categóricos, numéricos, fechas y texto. Selección vacía, cambios rápidos, error deliberado y cambio de revisión PASS. Concurrencia máxima de consultas: 1.
- Regresión del scroll Explore con 4.911 columnas: 0 consultas en revisitas, 0 placeholders, 0 renders en reposo, sin columnas consultadas por duplicado y última variable accesible. Máximo 15 tarjetas montadas.
- Resultados completos: `docs/qa/filter-transition-browser-results.json`. Son pruebas de frontend con API simulada, no mediciones de FPS nativos.

## App nativa y archivo real

Bundle aislado `src-tauri/target/debug/bundle/macos/Datolens Scroll QA.app`, perfil `com.victoriano.datolens.scrollqa`, SHA-256 ejecutable `23b024cee272caacaf1ac91cbc51277f92b98f256a0f737b467d30f49b92f8f3`.

Fuente: https://data.pisa.victoriano.me/pisa_espana_2000_2025_cocinado.parquet, 246 variables, 191.254 filas y muestra Auto de 5.000.

- Explore: abrir estadísticas de `math_exploracion`; `sexo = Varón` produce 95.981 filas exactas y mantiene las estadísticas (2.445 válidos de muestra).
- Combinar con P25–P75 de matemáticas: 45.295 filas exactas, 1.176 válidos de muestra. Gráficos, cifras y brush visibles.
- Arrastrar el histograma de matemáticas cambia el intervalo a aproximadamente 363,597–562,717 y produce 66.423 filas, 1.720 válidos de muestra. Confirma que las marcas y su interacción siguen funcionando tras las actualizaciones incrementales.
- Limpiar filtros recupera 191.254 filas y 4.924 valores válidos de matemáticas.
- Tabla: filtrar `CNTSCHID = 72400016.0` produce 114 filas exactas y 9 válidos de muestra; los histogramas y estadísticas del lateral permanecen visibles. Limpiar recupera el estado completo.
- Sin Updating ni Loading chart al finalizar las consultas. La app QA se cerró con los filtros limpios. No se hicieron llamadas IA.

La prueba frame a frame procede del fixture DOM; la comprobación nativa verifica datos, interacción y aspecto en el bundle recién compilado, sin atribuirle los timings del navegador.

## Entrega

Build principal mediante `scripts/build-macos.sh`: `src-tauri/target/debug/bundle/macos/Datolens.app`.

SHA-256: `b8a7c2f4756337d0b5c43772b592acf73c1fc6a4a5d7deb9e034d9d56b9fc21c`.

Logs: `docs/qa/filter-transition-native-build.txt` y `docs/qa/filter-transition-main-build.txt`. Incluye los cambios concurrentes de cabecera y proveedor sin sobrescribirlos. Se coordinó el reinicio con la tarea de diagnóstico; no había acceso al Llavero en curso. Se cerró la instancia principal anterior (PID 71362) por Cmd+Q y se lanzó la ruta exacta del bundle nuevo, conservando la sesión que estaba activa.

Verificación final: nueva instancia principal PID 73117, Idealista restaurado con 94.815 filas, filtro de variables por rol Target y panel de enriquecimiento tal como estaban antes del reinicio. El proceso independiente en `artifacts/distribution` se dejó intacto.
