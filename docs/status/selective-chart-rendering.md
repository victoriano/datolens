# Render selectivo de gráficos — 2026-09-24

Solicitud: evitar que aplicar un crossfilter provoque un render de todos los gráficos.

## Implementado

- Las distribuciones recibidas por IPC se reconcilian por columna e identidad de bin. Datos, arrays de bins, estadísticas y barras iguales conservan sus referencias. Los cambios de población se siguen publicando de forma atómica; nunca se incorporan variables fuera del viewport de otra población ni datos de otro API/fuente/revisión/muestra.
- `VariableChart` y `Histogram` tienen límites de memoización. Los gráficos reciben solo sus datos, filtro propio y opciones visuales, sin depender del estado global de carga, estadísticas ni del objeto de vista completo. Los callbacks son estables y despachan al manejador y filtro actuales.
- Las categorías memorizan ordenación/escala y cada barra por separado. Cambiar un recuento no obliga a renderizar todas las demás barras; un cambio real de escala o de porcentajes sí actualiza las barras que lo necesitan.
- Charts conserva el resultado durante la consulta del mismo gráfico con nuevos filtros. La carga aparece como un indicador superpuesto; las marcas anteriores no se pueden usar para generar filtros ni exportar hasta resolver la consulta. Un error conserva el resultado identificado como anterior.
- Los segmentos sin cambios conservan sus arrays y configuración. Sus canvas quedan fuera del render. Vega modifica los valores de las marcas dentro de la vista existente cuando se mantiene la estructura del gráfico; una configuración/estructura de ejes realmente diferente puede requerir reconstruir esa vista.
- Se mantiene la página de segmentos al filtrar y se limita al nuevo número de páginas si desaparecen segmentos. La exportación usa las vistas vigentes.
- Los dominios categóricos de Vega siguen explícitamente el orden actual de las filas: filtrar y restaurar categorías ya no cambia su orden por la identidad interna de tuples retenidos.
- Variables y Charts usan claves React distintas. Ocultar y mostrar Variables no duplica el panel. El gráfico con ancho automático sigue el ancho disponible; los anchos fijados manualmente se respetan.

## Verificación

- TypeScript PASS; **93 pruebas, 0 fallos, 2.097 aserciones** (`docs/qa/chart-render-tests.txt`). Incluyen sharing de distribuciones, metadatos/revisiones, cambios relativos, identidad de tuples Vega, orden de dominios categóricos tras restaurar grupos y actualizaciones consecutivas antes de completar el render.
- Fixture con React, hook, tarjetas virtualizadas y Vega reales: `docs/qa/chart-render-regression.html` / `.tsx`. IPC simulado con 246 variables y latencia. Instrumenta commits de componentes en React de desarrollo, repintados canvas y referencias a vistas Vega; no usa contadores dentro del código de producto.
- Cambiar un histograma: **1 render de ese histograma y 0 del resto**. Cambiar una categoría: **1 render de esa barra y 0 de las restantes**. Cambiar únicamente estadísticas o devolver datos iguales: **0 renders de gráficos**.
- Charts con dos segmentos: **1 render del segmento modificado, 0 renders y 0 repintados del otro**. 19 frames observados durante carga: ningún canvas desmontado; las dos vistas Vega conservan identidad y los datos nuevos se verifican.
- Multiselección categórica, ordenar/expandir categorías, callbacks actuales, editar límite numérico sin perder el opuesto, exportar SVG, retener un error y recuperarse: PASS.
- Redimensionado automático al estrechar el contenedor: PASS. Ejecución limpia sin errores de consola.
- Regresión previa de continuidad: 304 frames, 0 placeholders, reemplazos de canvas, encogimientos de gráficos o retiradas de estadísticas; filtros categóricos/numéricos/fechas/texto, vacíos, rápidos, error y revisión: PASS.
- Resultados: `docs/qa/chart-render-browser-results.json`. Estas cifras corresponden al fixture Chromium, no a FPS nativos.

## Compilación y QA nativa

- Compilaciones QA y principal PASS en target aislado `/tmp/datolens-chart-qa-target`; ambas firmadas con la identidad local habitual y verificadas con `codesign --verify --deep --strict`. Logs en `docs/qa/chart-render-{native,main}-build.txt`.
- App QA final ejecutada: `/tmp/datolens-chart-qa-target/debug/bundle/macos/Datolens Scroll QA.app`, PID **94453**, SHA-256 del ejecutable **95047b9752c1cc43dadb4db811771b7b9ab43d4a876080d23b005c1c933f2342**.
- PISA remoto: **191.254 filas, 246 variables**, análisis Auto con muestra de 5.000. Charts/sexo muestra 191.118 filas no vacías en 2 grupos. Filtrar Varón devuelve **95.981 filas, 1 grupo**; limpiar restaura 2 grupos en orden No varón / Varón, sin dejar Updating permanente.
- Comprobados en nativo: filtro desde Variables, eliminación del filtro, gráficos presentes, orden restaurado y ajuste de tamaño sin panel duplicado al ocultar/mostrar Variables. El clic en la marca retenida tras actualizar datos también aplica el filtro; en la automatización nativa se necesita movimiento real del puntero para activar el hit testing de Vega.
- La validación nativa es funcional/visual, no una medición de FPS ni de commits React nativos. Las cifras de render selectivo corresponden al fixture instrumentado.
- Compilación principal final preparada en `src-tauri/target/chart-update/Datolens.app`, SHA-256 **03e090479953abb85e7b772bffb88b4f74a60a9689ba04d559ecbaef940a84c4**.
- **Pendiente activar en la app principal:** el bundle habitual sigue abierto (PID 85541) con un aviso protegido de acceso al Llavero de la tarea de Gemini. Se ha coordinado no reiniciarlo ni sustituirlo hasta que quede libre. La compilación preparada aún no es la app principal en ejecución. No se han accionado permisos ni llamadas IA en esta tarea.
