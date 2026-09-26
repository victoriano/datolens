# Gráficos locales

Implementación propia en `src/features/plots/`, `src/styles/plots.css` y
`src-tauri/crates/datolens-data/src/plots.rs`. No necesita paquetes nuevos.

## Funciones

- Galería con siete familias y 20 variantes: barras, apiladas, agrupadas,
  segmentadas y 100 %; líneas, segmentadas, múltiples y descomposición temporal;
  área, apiladas, segmentadas y 100 %; mapa de calor; caja; dispersión simple o
  con color; burbujas simples o con color; tabla dinámica.
- Selección previa de variables y recomendaciones por tipo; asignación X/Y,
  color, tamaño, medida de celda y varios ejes/medidas en la tabla.
- Recuento, valores válidos y distintos, suma, media, mediana, mínimo, máximo,
  desviación poblacional, cuartiles, percentiles y recuento/porcentaje de un valor.
- Intervalos iguales, cuantiles, valores exactos, periodos y componentes de fecha;
  orden por variable, medida o recuento; controles independientes del segundo eje
  del mapa de calor y del color.
- Orientación, paletas, colores individuales, leyenda, fondo/tema propio del
  gráfico, opacidad, títulos/subtítulo/descripción/pie, formatos, etiquetas,
  cuadrícula, ejes logarítmicos, límites/marcas/rotación, líneas, puntos, barras,
  información adicional y variantes estadísticas de caja.
- Referencias verticales/horizontales, bandas y texto colocado en coordenadas
  relativas; tamaño por controles o arrastre con alternativa de teclado.
- Clic en las marcas y selección rectangular con Mayúsculas en dispersión
  comparten los filtros de la tabla. Los intervalos distinguen extremos abiertos
  y cerrados para conservar máximos y empates.
- Guardar/actualizar/copiar, miniatura real, abrir/renombrar/duplicar/eliminar con
  deshacer. `ViewState.plots` guarda la configuración y gráficos en el sidecar
  existente, sin resultados de consulta ni credenciales.
- CSV con valores nativos exactos; SVG y PNG mediante el diálogo de macOS.
  Los gráficos guardados conservan su tema; los nuevos parten del tema de interfaz.

## Contrato y cálculo

`PlotsPanel` recibe `api`, `dataset`, `filters`, `value`, `onChange`, `onFilter`
y `revision`. Integración conecta `queryPlot`/`exportPlot`, navegación y sidecar.

Las consultas se construyen en Rust sobre `dl_data`, después de validar identidad,
columnas, tipos, enums y límites. El wrapper usa los filtros del almacén y comprueba
el origen antes/después. El trabajo corre mediante `spawn_blocking` y mutex de la
sesión. Nunca se envía SQL desde el componente ni se materializa el dataset en JS.

- Máximo 6 dimensiones, 12 medidas, 12 campos de puntos, 100 bins y 10.000 filas
  devueltas por consulta. La UI pide hasta 5.000 grupos o 10.000 puntos.
- Los agregados usan todas las filas elegibles filtradas. Cuando hay demasiados
  grupos se devuelve el principio del orden solicitado y se avisa.
- La dispersión usa los primeros pares válidos en el orden original; conserva
  `id` como texto. Correlación y regresión se calculan sobre **todos** los pares
  válidos filtrados, independientemente del límite de puntos.
- Dimensiones exactas y agregaciones viajan como strings para no redondear
  enteros/decimales nativos en el transporte. Las coordenadas visuales usan double.
- Cuantiles con `quantile_cont`, percentil en [0,1], empates juntos. Fechas por
  intervalos de calendario UTC. NaN/Infinity no se usan como coordenadas numéricas.
- `groupDimensions` recalcula los totales de tabla sobre las mismas filas elegibles
  que las celdas, sin sumar medianas ni incluir inadvertidamente grupos omitidos.
- Respuestas tardías o de otra revisión no sustituyen el gráfico actual.

## Verificación

- Ajuste posterior: el gráfico fija al montarse el ancho disponible (o el ancho explícito guardado), permanece centrado al plegar paneles y solo cambia de tamaño mediante los controles de zoom, tamaño o arrastre. Se eliminó el redibujado automático por `ResizeObserver`. `bun run check`, `bun run build` y las 10 pruebas de `model.test.js` pasan. Este ajuste visual aún no se ha recorrido en la app macOS recompilada.

- `bun run check`: PASS.
- `TZ=Europe/Madrid bun test src/features/plots/model.test.js`: 9 PASS / 75 aserciones, incluyendo
  construcción/ejecución Vega de las variantes gráficas, extremos de filtros,
  contrato, calendario/descomposición, CSV con enteros exactos/multilínea y
  exportación que conserva el viewport completo de ejes. La regresión temporal
  conserva 12 huecos reales y solo 28 marcadores para una serie de 40 meses con
  ciclo de 12; el tooltip usa el valor del componente calculado. Los extremos de
  fecha sin zona se interpretan como UTC, sin perder una o dos horas en Madrid;
  la regresión cubre invierno, verano y offsets explícitos.
- `cargo test ... --test plots`: 6 PASS en target aislado, ejecutados por la tarea
  de análisis. Recibo `docs/qa/features-plot-totals-tests.txt`. Cubre cuartiles,
  filtros, nulos/constantes/empates, fechas, alias/identidad exacta, límites,
  coeficientes globales, vacíos y totales de mediana con igual elegibilidad.
- Recorrido real en `Datolens Integration QA.app` (QA3), con fixture CSV local de
  240 filas: cuatro ciudades de 60 filas; clic y tooltip en Madrid, filtro de
  60/240 y tabla con las 60 filas correctas. Los IDs de más de 2^53 siguen exactos.
- Exportación mediante diálogos nativos: SVG 1171×470 con ejes completos,
  PNG 2342×940 y CSV con cuatro grupos de 60. Integración conserva los artefactos
  en `docs/qa/datolens-qa-ciudades.{svg,png,csv}`.
- Tabla dinámica ciudad/sector: 12 celdas de 20, totales por fila 60, columna 80 y
  global 240. Mediana de ingresos por ciudad 5500/5000/6500/6000 y global 5750,
  recalculada desde las filas originales.
- Dispersión empleados/ingresos: 240 pares válidos, Pearson 1, R² 1 y recta
  visible. Tras CmdQ y reapertura del mismo CSV se restauran las cuatro vistas
  guardadas, ejes y regresión, y se recalcula el gráfico correctamente.
- Revalidación en QA4: los 40 meses dejan vacíos los extremos de tendencia y
  residuo, sin marcadores ficticios. El tooltip de diciembre de 2022 muestra
  tendencia 6000, distinta de la mediana observada 5250, y conserva el periodo y
  recuento correctos. Etiquetas de tooltip y CSV en inglés comprobadas; archivo
  `/private/tmp/datolens-qa4-ciudades-en.csv`. Los ejes sin asignar muestran
  «Select a variable…», sin aparentar una selección inexistente.
- Después de QA4 se tradujeron el nombre de componente en tooltip y el título de
  panel exportado. Solo cambia la presentación; IDs y cálculo permanecen iguales.
  TS y las 9 pruebas siguen pasando. Esta traducción final no tuvo otro recorrido
  nativo. No se afirma haber recorrido todas las combinaciones de controles de
  presentación en macOS.

## Semántica y límites visibles

La descomposición es aditiva mediante media móvil centrada y promedios de fase,
requiere dos ciclos y periodos consecutivos. Los huecos se conservan o se llenan
con cero solo a petición del usuario; no se interpola una medida desconocida.
No se afirma que sea un método STL. Las facetas se paginan de 12 en 12 y la imagen
exporta las visibles. La tabla pagina filas y grupos de columnas. El CSV exporta
los grupos/puntos calculados que se han recibido, y conserva la limitación indicada.
Los componentes de fecha (p. ej. mes del año) no generan un filtro continuo al hacer
clic: la interfaz pide usar fecha completa. Los grupos nulos no crean un filtro
vacío accidental.

No se han realizado llamadas de IA ni cambios en repositorios externos.

## Edición del número de intervalos (2026-09-23)

El campo numérico conserva temporalmente el texto vacío al borrar, de modo que se puede sustituir el valor con el teclado. Los intervalos numéricos admiten 1–100 en la interfaz y en la validación nativa. La prueba de Rust confirma que un único intervalo agrupa las cinco filas no nulas tanto con anchura igual como con cuantiles, y que cero sigue rechazándose. Pasaron `bun run check`, `bun run build` y `scripts/build-macos.sh`, incluida la firma del bundle. La comprobación manual del gesto en la app nativa queda pendiente: la copia aislada de QA se detuvo al restaurar un archivo abierto en la sesión principal, que se dejó intacta.

## Controles visibles de X e Y (2026-09-23)

Charts muestra ahora las variables X/Y encima del gráfico, con acceso inmediato a agrupación e intervalos de X, cálculo de Y, intercambio de variables compatibles y orientación de barras/cajas. Los controles comparten el mismo `PlotConfig` que el panel lateral; el intercambio conserva los ajustes de agrupación de cada variable y se desactiva si el gráfico resultante incumple la validación. El modelo pasó 11 pruebas (98 aserciones), incluidas nuevas comprobaciones del intercambio y de la consulta resultante. `bun run check`, `bun run build` y `scripts/build-macos.sh` pasaron con el código final, incluida la firma del bundle.

En una copia de QA de la app nativa se abrió un CSV independiente de 12 filas. Se comprobó visualmente la franja X/Y, la elección de `facturacion` e `id`, el cambio automático de recuento a media, el intercambio con redibujo de 7 grupos y la edición de 16 a 10 intervalos en el menú de X. La copia QA se cerró sin interrumpir la instancia principal. El ajuste posterior de traducciones y el botón de orientación están compilados, pero no se recorrieron en esa copia.

## Recuento relativo y acumulado (2026-09-23)

Cuando Y es «Número de filas», el menú visible ofrece solo «Recuento», «Recuento relativo (total)» y «Suma acumulada». Elegir una variable Y restaura los estadísticos de medida. El recuento relativo divide cada grupo por todas las filas elegibles del gráfico (`plottedRows`); la suma acumulada agrega los recuentos en el orden visible del eje X. El motor sigue consultando recuentos exactos: las dos vistas se calculan sobre el resultado agrupado y no envían un dataset entero a JavaScript. Las etiquetas, el eje, los tooltips y el CSV reflejan el valor transformado; el CSV conserva también el recuento original.

`bun run check`, `bun run build`, 12 pruebas de gráficos (111 aserciones) y `scripts/build-macos.sh` pasaron con el código final; se verificó también la firma del bundle principal. En un bundle QA con identificador y almacén independientes se abrió un CSV de cuatro filas (A=3, B=1): el menú contenía exactamente las tres opciones, la vista relativa mostró barras de 75 % y 25 %, y la acumulada mostró 3 y 4. La copia QA se cerró. El ajuste de las variantes al 100 % pasó las pruebas de frontend, pero no se recorrió en la app nativa. Si el resultado supera el límite de 5.000 grupos, los porcentajes visibles pueden sumar menos de 100 % porque el denominador incluye también los grupos no devueltos; la UI ya avisa cuando alcanza ese límite.

### Selector directo de Y

El valor de cálculo junto a Y abre ahora directamente las opciones de estadístico, sin un selector anidado. Para los gráficos cuyo cálculo ya está ahí, se quitó el selector duplicado de Ajustes; los gráficos que necesitan la medida de celdas, medidas múltiples o tabla conservan el control en Ajustes. En la app nativa aislada se comprobó que aparecen Count, Relative Count (All) y Cumulative Sum como opciones directas, que seleccionar Relative Count cierra el menú y actualiza las barras a 75 % y 25 %, y que Ajustes ya no repite Statistic. Pasaron `bun run check`, las 12 pruebas de gráficos (111 aserciones) y `scripts/build-macos.sh`. La copia QA se cerró sin tocar la instancia principal.

## Etiquetas de límites de intervalos (2026-09-23)

Para un eje X numérico agrupado de barras, cajas o mapa de calor, Diseño > Eje X > Etiquetas de intervalos permite elegir rango completo, inicio o final. El rango completo conserva la etiqueta centrada existente; inicio y final muestran un único límite y colocan la etiqueta y la marca en el borde respectivo de la barra. El ajuste afecta solo a la presentación: la consulta, los límites nativos de los grupos, el tooltip y el filtro por clic siguen usando el intervalo completo. Los gráficos guardados sin este campo mantienen por defecto el rango completo. Las 13 pruebas de gráficos (128 aserciones) y `bun run check` pasaron.

En un bundle macOS de QA con identificador propio y cuatro filas, se eligió X numérica con dos intervalos. Se comprobó en pantalla que «Inicio» muestra 10 y 25 en el borde izquierdo de cada barra y «Final» muestra 25 y 40 en el derecho. El cambio se conservó al reabrir la copia QA. La sesión principal permaneció abierta sin cambios.

## Valores visuales por defecto (2026-09-23)

Los gráficos de barras nuevos parten de opacidad 1; los demás tipos conservan su opacidad anterior. La cuadrícula de Vega tiene ahora un color explícito y tenue para los temas claro y oscuro. Las etiquetas de intervalos numéricos parten de «Final del intervalo», también al abrir una configuración anterior sin ese campo. Una elección guardada explícitamente de opacidad o rango completo se respeta.

Verificación: 13 pruebas de gráficos (134 aserciones), `bun run check`, `bun run build` y `scripts/build-macos.sh` pasaron. La prueba de Vega comprueba la opacidad, el color de ambas cuadrículas y la posición de la etiqueta final. No se recorrió la nueva compilación en una ventana macOS aislada.

## Valores exactos densos (2026-09-23)

Si un gráfico de barras con X numérica en «Valores exactos» contiene más categorías que un tercio de los píxeles disponibles, las barras contiguas se dibujan sin separación, con opacidad máxima de 0,75, y se omiten las líneas y marcas verticales por valor. El eje Y conserva la cuadrícula tenue. Esto también mejora el borrador ya abierto con opacidad 1, sin modificar su configuración guardada; los gráficos menos densos mantienen su opacidad y separación configuradas.

Verificación: 14 pruebas de gráficos (145 aserciones), `bun run check` y `scripts/build-macos.sh` pasaron. Se inspeccionó un SVG de Vega con 2.761 valores exactos en el tema oscuro. También se compiló y firmó `Datolens Dense QA.app` con identificador propio, se abrió `/tmp/datolens-dense-qa.csv` (2.761 filas) y se comprobó en la app real el gráfico de barras `PRICE` / media de `CONSTRUCTEDAREA` con «Exact values»: la silueta azul se distingue sobre el fondo oscuro sin la superficie gris de líneas verticales. La copia QA se cerró y la sesión principal permaneció abierta. La muestra es sintética; no se abrió el archivo `idealista_dataset.csv` de la captura.
