# Scroll de variables: flickering y Updating continuo — 2026-09-23

Fuente real: https://data.pisa.victoriano.me/pisa_espana_2000_2025_cocinado.parquet (191.254 filas, 246 columnas).

## Causas verificadas

- La regla de sidebar `.dl-variables:not(.dl-variables-expanded) .dl-variable-list` ganaba por especificidad a la regla virtual. El contenedor seguía siendo flex y comprimía a cero los espaciadores. En la primera prueba DOM aparecían alturas declaradas de 223 y 57.571 px pero alturas reales de 0; el scroll solo alcanzaba unas pocas tarjetas. La nueva prueba exige suficiente altura virtual y llegar a columnas lejanas y a la última variable.
- `SampleControl` retiraba la nota de la muestra al marcar busy. Cambiaba la altura del viewport, que cambiaba la demanda de variables y reiniciaba el efecto, incluso con caché.
- Las respuestas parciales sustituían todas las distribuciones por las del último tramo. Volver a una tarjeta podía montar un placeholder antes de recuperar la caché. La cola tampoco revisaba la caché al comenzar una petición que había esperado a otra todavía en curso.
- Cada píxel disparaba estado React, y las recargas del panel renderizaban también la tabla y las 246 opciones del menú de columnas cerrado. Los rangos numéricos con el mismo valor pero distinto objeto provocaban nuevas actualizaciones Vega.

## Cambios

- Especificidad correcta del contenedor virtual y espaciadores que no se comprimen.
- Scroll agrupado por animation frame; solo se actualiza React cuando cambia el tramo visible o su geometría. Búsqueda binaria de la fila inicial, dependencias estables y anclaje de fila/offset al medirse alturas nuevas.
- Lectura de caché antes de pintar, demanda independiente del orden de prioridad viewport/overscan, resultados acumulados dentro del mismo contexto y límite de 256 variables. Cambios de dataset/revisión/muestra invalidan lo mostrado. La mejora posterior de [transiciones de filtros](filter-transitions.md) conserva el último conjunto durante un cambio de filtros y lo sustituye al completar el viewport nuevo, sin mezclar poblaciones.
- La cola vuelve a comprobar la caché justo antes de IPC. Una petición cancelada puede completar su caché sin publicar resultados obsoletos ni duplicar columnas en la siguiente petición.
- Busy corresponde al trabajo nativo pendiente; la muestra mantiene su texto/altura. Los gráficos existentes no se borran cuando llegan otros.
- Tabla memoizada con callbacks estables; menú de columnas montado solo al abrirlo; Vega se actualiza por valores de rango, no por identidad del array.

## Verificación

- `bun test src/features src/platform src/ui`: 69 PASS, 0 fallos, 1.978 aserciones. Log: `docs/qa/scroll-frontend-tests.txt`. Incluye 13 pruebas de distribuciones/geometría/estabilidad de SampleControl.
- TypeScript y build macOS PASS. Firma `codesign --verify --deep --strict` PASS. Logs `docs/qa/scroll-native-build.txt` y `docs/qa/scroll-main-build.txt`.
- Prueba DOM reproducible: ejecutar `bun run dev` y abrir `/docs/qa/scroll-regression.html`; para rejilla ancha, `?mode=explore&columns=4911`. Importa los componentes reales y usa datos generados con latencia artificial. No entra en el bundle de producto. La prueba verifica caché, ausencia de placeholders en revisitas, altura de muestra, reposo sin renders/consultas, concurrencia 1, consultas sin columnas repetidas y acceso al final.
- Resultados: `docs/qa/scroll-browser-results.json`. Table de 246 columnas mantiene como máximo 6 tarjetas; Explore de 4.911 mantiene 15. Ambas registran 0 consultas nuevas durante las revisitas, 0 frames con placeholders de gráficos cargados y 0 renders en reposo. Son pruebas de navegador con fixture; no se atribuyen sus timings al motor nativo.

## QA nativa con el archivo real

En `Datolens Scroll QA.app`, perfil aislado `com.victoriano.datolens.scrollqa`, compilación con la corrección de CSS/caché/tabla:

- Auto abre el parquet remoto, muestra 5.000 filas de análisis y 191.254 filas en tabla.
- Scroll desde las primeras variables a origen/region/sector/GRADE/repeticion, y salto largo hasta BSMJ/SISCO/PERSEV/CURIO/ENPROBS/COGABIL. Regreso y repetición del salto: las tarjetas vuelven cargadas sin Updating ni Loading chart.
- Buscar sexo y seleccionar Varón: 95.981 filas exactas; categoría con 2.478 seleccionadas de muestra. Limpiar: 191.254 filas.
- Explore y desplazamiento hasta ICTFEED/ICTOUT/ICTWKDY/ICTWKEND/ICTREG/ICTINFO/ICTDISTR/ICTRES/ICTAVSCH/ST255Q01JA/ST296Q04JA/ST322Q02JA/SKIPPING/TARDYSD/EXERPRAC. Snapshot completo final: `loading=false`, `updating=false`, muestra 5.000.

El primer acceso a columnas remotas nuevas sigue dependiendo de la red y del cálculo; su carga es progresiva. No se promete latencia cero ni FPS nativos a partir de las mediciones de navegador. No se modificó el motor de datos ni se hicieron llamadas IA.

## Entrega

Bundle principal combinado (incluye los cambios concurrentes de cabecera y detalle HTTP400 del proveedor), construido con `scripts/build-macos.sh`: `src-tauri/target/debug/bundle/macos/Datolens.app`.

SHA-256 del ejecutable: `3df8b46f26327a22ff2bda5fdd5681a3d47b30fa67fcfbf33cd34924dedb2485`.

Se cerró por Cmd+Q la instancia anterior y se abrió la ruta exacta del bundle final. Ambas pestañas del usuario permanecen disponibles. Verificado en el principal que el menú Columns se monta al abrirlo y se cierra; no se modificaron datasets ni filtros. La tarea de cabecera recibe CUA para su última captura. La instancia aislada Scroll QA quedó cerrada.

Compilación posterior de cabecera: `b8fde0f635908807f78e9a7a0e6f177973d2b3b1eb2707145b92f8aea8343dba`.
Incluye un ajuste de Escape en el menú «+», preserva los cambios de scroll y
pasó TypeScript/build/firma. El hash anterior se conserva como evidencia de la
QA de scroll. Esta compilación posterior está en disco; no se reinició el
proceso porque esperaba una autorización del Llavero iniciada por la tarea de
diagnóstico. Detalles en `compact-header.md`.

La entrega posterior de crossfilters, incluyendo QA nativa y hash actualizado,
se documenta en [filter-transitions.md](filter-transitions.md).
