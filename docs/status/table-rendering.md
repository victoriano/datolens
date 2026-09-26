# Tabla: filtros y scroll horizontal — 2026-09-24

Solicitud: evitar reconstruir la tabla al filtrar y eliminar el parpadeo al desplazarse horizontalmente.

## Implementado

- La página anterior permanece visible hasta tener el resultado nuevo completo. El indicador de carga flota fuera del scroll: no añade altura ni vacía filas. Mientras son datos anteriores no se permite seleccionar/copiar; los errores mantienen la página anterior identificada como tal.
- Las filas se reconcilian por identidad estable, conservando objetos y celdas cuyo valor no cambia, incluidos valores estructurados. Filas y celdas tienen límites de memoización independientes. Los eventos de selección se delegan al cuerpo de la tabla.
- Las columnas de una misma página se incorporan por proyecciones: solo se consultan las que faltan. Se mantienen como máximo tres páginas de 100 filas y 64 columnas por página (o las necesarias para cubrir un viewport mayor). Las columnas visibles están protegidas de la expulsión de caché.
- La caché se separa por API, fuente/revisión, filtros, orden y página; los resultados cancelados no sustituyen los actuales. Una revisión nativa diferente obliga a volver a consultar la proyección completa antes de combinarla.
- El scroll se agrupa por animation frame y solo actualiza React al cruzar un límite de la ventana de columnas. Los cambios rápidos se agrupan antes de consultar y las peticiones pendientes vuelven a comprobar la caché al comenzar.
- Se preservan el drag de cabeceras del trabajo concurrente, selección rectangular/Command/filas, copia, ancho de columnas, ordenación y paginación.

## Verificación automatizada

- TypeScript PASS. `bun test src/features src/platform src/ui`: **84 PASS, 0 fallos, 2.050 aserciones**. Log: `docs/qa/table-render-tests.txt`.
- Fixture con ExplorerApp, DataTable y componentes reales, 246 columnas, 400 filas y API con 190 ms de latencia (600 ms en cancelación).
- **58 frames durante filtros: 0 filas desmontadas y 0 pérdidas de altura.** Un filtro que devuelve los mismos datos provoca **0 reformateos de celdas**. Las filas supervivientes cambian de posición manteniendo nodos de fila/celda y valores sin renderizar de nuevo.
- **322 frames de scroll horizontal de ida y vuelta: 0 frames vacíos, 0 placeholders en columnas cargadas, 0 sustituciones de filas/celdas solapadas y 0 consultas adicionales** sobre el rango en caché.
- Última columna accesible; recorrido más allá de 64 columnas y vuelta con expulsión de caché; valores de todas las celdas contrastados con su fila/columna; paginación y ordenación PASS.
- Selección Shift, Command, checkbox, copia, protección durante consulta, cancelación, error y resultado vacío PASS. Concurrencia máxima de consultas de página: 1.
- Fuente reproducible: `docs/qa/table-render-regression.html` y `.tsx`. Resultado: `docs/qa/table-render-browser-results.json`. Son verificaciones DOM con API simulada en Chromium, no mediciones de FPS de la app nativa.
- Regresión de gráficos repetida después de los cambios de tabla: `filter-transition-regression.html` PASS, **303 frames, 0 placeholders, 0 canvas reemplazados, 0 reducciones de altura y 0 desmontajes de estadísticas**; cuatro tipos de filtro, resultado vacío, cambios rápidos, error y cambio de revisión PASS.

## Verificación nativa

Bundle aislado `src-tauri/target/debug/bundle/macos/Datolens Scroll QA.app`, perfil `com.victoriano.datolens.scrollqa`, proceso **85006**, SHA-256 del ejecutable **eb4c4d14b0e607d2a7cd23ee278f25601302a5dec0b552f071c5c0c7147b7e65**. Build y firma profunda/estricta PASS.

Fuente real: https://data.pisa.victoriano.me/pisa_espana_2000_2025_cocinado.parquet, **191.254 filas y 246 variables**, muestra Auto de 5.000.

- `CNTSCHID = 72400016.0` devuelve 114 filas; tabla, histogramas y estadísticas visibles.
- Navegación horizontal nativa con flechas desde `fila_origen` pasando por `ST438Q01DA` hasta la última columna `cen_padres_inmigrantes_pct`, con el filtro activo. Las nuevas proyecciones muestran valores y terminan de cargar.
- Quitar el filtro desde las últimas columnas recupera 191.254 filas y actualiza los valores sin restablecer la posición horizontal. Vuelta al principio correcta después de recorrer las 246 columnas y superar el límite de caché.
- Reaplicar el filtro y paginar muestra **101–114**, con Siguiente deshabilitado. Limpiar restaura **1–100 de 191.254**.
- Sin Updating ni carga de filas pendientes al acabar. Se cerró QA con filtros y selección limpios.

La comprobación nativa verifica datos, navegación, finalización y aspecto en WebKit. La evidencia frame a frame y de identidad DOM procede del fixture Chromium; no se atribuyen sus tiempos/FPS a macOS. No se hicieron llamadas IA ni se accedió a la clave Gemini.

## Entrega

Tras la limpieza autorizada de targets se reconstruyó el principal mediante `scripts/build-macos.sh`. Bundle: `src-tauri/target/debug/bundle/macos/Datolens.app`; SHA-256 **4ee9598b797bce34e3dc2a730b89b21613fb08896476ce3b262866a0eed03186**. Verificación de firma profunda/estricta PASS. Logs: `docs/qa/table-render-native-build.txt` y `docs/qa/table-render-main-build.txt`.

Se preservaron los cambios concurrentes de cabecera y proveedor. La tarea de diagnóstico confirmó que no había acceso al Llavero ni QA en curso. Se abrió la ruta exacta del bundle principal después de cerrar QA: proceso **85541**, sesión `churn_dataset.csv` restaurada con **7.043 filas y 21 variables**, conservando su vista de gráficos.
