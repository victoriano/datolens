# Explorador — recibo de implementación

## Estado

Implementado e integrado. Pruebas propias con fixture explícito en navegador y QA nativo realizado por el coordinador, documentado en [docs/QA.md](../QA.md). Código congelado para el bundle final. Gemini real no probado; esta distinción se conserva en QA.

## API pública

`src/features/explorer/index.ts` exporta:

- `ExplorerApp({ api: DesktopApi, renderEnrichmentPanel? })`.
- `EnrichmentPanelContext`: `{ dataset, selection: { cells: {rowId,columnId}[], rowIds: string[] }, filters, onDataChanged }`.
- `ExplorerSelection` y `CellId`.

El coordinador ha montado `EnrichmentPanel` mediante `renderEnrichmentPanel`. `onDataChanged` vuelve a consultar página/distribuciones y usa `api.getDataset?` para reconciliar nuevas columnas. La selección se transmite por IDs estables y no se reconstruye por índices después de ordenar.

## Implementado

- Restauración automática del último archivo mediante `getLastSource?`, tolerante a StrictMode; un open/drop explícito prevalece sobre restauraciones tardías.
- Apertura nativa mediante `selectDatasetPath?` / `openDataset`, selección de hoja XLSX, suscripción opcional a `onFileDrop` con desmontaje correcto, carga/errores/cancelación de apertura.
- Página nativa de 100 filas y proyección de columnas visibles. Filtros y sorting se envían al motor; el explorador no ordena una página como sustituto del orden global.
- Selección de celda, arrastre rectangular, Shift-clic, Cmd-clic, filas y Cmd+A de la página. Selección estable al ordenar/cambiar página. Copia TSV de valores visibles preservando strings/IDs largos, comillas, tabs, saltos y nulos. UI explicita “Copiar visibles”.
- Sorting múltiple con prioridad arrastrable, columnas reordenables mediante cabecera y menú con flechas, ocultación, anchuras ajustables con puntero y teclado.
- Aviso discreto de categorías truncadas: “Primeras N categorías por frecuencia” cuando `Distribution.truncated` es verdadero.
- Crossfilters numéricos, fechas, categorías múltiples y texto. Panel con búsqueda, orden por arrastre, fijar/ocultar, mostrar ocultas, porcentajes, frecuencia/selección/uplift/TF-IDF para el conjunto de bins recibido.
- Histograma Vega permite crear, mover y redimensionar rangos y elegir bins; las categorías adaptan el overlay total/selección y la ordenación local.
- Autoguardado serializado/coalescido durante resize, reconciliación de vista con esquema actual y restauración al abrir. Respuestas de consulta obsoletas se descartan. Nueva apertura del mismo ID fuerza consulta.
- Exportación CSV/Parquet por DesktopApi con filtros, sorting y columnas visibles.
- No proveedores ni scheduler React, no credenciales, no importación completa en JS, ni cambios en manifests, locks o módulos de compañeros.

## Verificación

- `bun test src/features/explorer/model.test.js`: **8 pass**, **20 expect**, 0 fail.
- `bun run check`: primera ejecución completó sin errores; segunda ejecución tras cambios coordinados también completó sin errores.
- Fixture de UI tipado: `src/features/explorer/fixture-api.ts`, `preview.tsx`, `preview.html`; no se importa por la aplicación real. URL local del servidor compartido: `/src/features/explorer/preview.html`.
- Comprobación visual en navegador real con fixture de 240 filas: tabla/variables renderizadas, dos filtros (`Madrid` + `Tecnología`) dieron **20 filas**, barras coherentes; histograma con arrastre redujo a **8 filas** y dibujó correctamente el brush.
- Rango 3×3: selección exacta de 9 celdas sobre `fixture-row-0`, `fixture-row-60`, `fixture-row-120`; tras invertir facturación se observaron los mismos IDs y columnas, en distinto orden visual.
- Ningún error/warning de consola observado en el recorrido de fixture hasta histogramas.
- Botón copiar resuelve sin error en fixture; serialización exacta está probada por unidad. Lectura del clipboard del navegador integrado no devolvió texto; la comprobación nativa posterior del coordinador sí confirmó el ID exacto al pegar.

## QA integrado del coordinador

Fuente: [docs/QA.md](../QA.md), leído al finalizar este recibo. Son resultados observados por integración en `Datolens.app`, separados de la prueba propia con fixture:

- CSV nativo de 12 filas; ID `9007199254740993` exacto y tipos/nulos visibles.
- `pais=ES` + `facturacion>=500`: 4/12 filas con barras y tabla coherentes; sorting `pais ASC`, `facturacion DESC` produce 1200, 900, 700, 600.
- Ocultar, reordenar y redimensionar: JSON y reapertura conservan columnas y ancho de empresa 259,6875 px. Reinicio completo con ⌘Q confirma último archivo, filtros, sorting y vista.
- Portapapeles nativo conserva `9007199254741015` al pegar en buscador.
- Exportación filtrada Parquet y reapertura conserva 4 filas, 5 columnas, IDs, fechas y orden. XLSX ofrece selección de hojas y abre Empresas con 12 filas.
- Crear enriquecimiento añade definición/columna al explorador; sin clave la ejecución queda bloqueada y no hubo llamadas facturables.
- CSV real Idealista: 94.815 filas/41 columnas; filtro `CADASTRALQUALITYID=NA` devuelve 1 fila. Bundle final muestra aviso de primeras 256 categorías y restaura archivo tras reinicio.
- TypeScript/build Vite, bundle y pruebas de datos/integración PASS; benchmark nativo de 1M/5M documentado con condiciones y límites en QA.

## Dependencias y límites pendientes

- Solo React/ReactDOM y `vega ^6.2.0`, instalados por integración. CSS propio en `src/styles/explorer.css`.
- Selección rectangular dentro de una página; se pueden acumular filas por IDs entre páginas. Copiar exporta solo celdas/filas seleccionadas que estén en la página y columnas visibles, como indica el botón.
- Uplift/TF-IDF reordenan los bins disponibles, no descubren valores fuera del top-N del motor. Nulos se muestran pero el contrato actual no permite filtrarlos.
- Sin grupos de variables ni overrides de tipos en esta primera entrega.
- Drag-and-drop conectado al evento nativo Tauri, pero el recorrido macOS documentado usó el selector. No se afirma prueba con arrastre Finder real.
- La evidencia nativa y benchmarks completos están centralizados en QA; no se atribuyen al fixture de navegador. Gemini real/Keychain con clave y stores quedan fuera de lo validado.

## Revisión posterior al «continua» — cerrada

- Hallazgo reproducido por integración antes del parche: con el último archivo ausente, el arranque fallaba; reponer el archivo y pulsar **Reintentar** solo borraba el error. La tabla seguía sin abrirse.
- Parche preparado en `/tmp/datolens-explorer-retry.patch` y aplicado por integración durante el relevo coordinado. Únicos archivos de producto modificados: `ExplorerApp.tsx` y `DataTable.tsx`.
- Cada error conserva su acción de reintento. La apertura recuerda la ruta realmente elegida y la hoja en la llamada `openSource(retryPath, sheet)`, también sin dataset previo; no vuelve a depender del refresco de una tabla inexistente. Consultas, guardado, copia y exportación conservan sus respectivas acciones de recuperación.
- Cmd+A, Cmd+C y Enter/Espacio sobre celdas comprueban `busy`; la copia del explorador también descarta una página todavía en carga. La selección por IDs no se altera por consultas intermedias.
- Verificación de integración: TypeScript PASS, modelo 8 PASS, build del bundle conjunto PASS y firma ad hoc PASS. **QA nativo después del parche:** retirar temporalmente `retry-open.csv`, arrancar con error, reponerlo y pulsar Reintentar abrió **5/5 filas y 2 columnas**, con IDs exactos y sin banner. Evidencia y prueba antes/después en [QA.md](../QA.md).
- Los bloqueos de teclado durante `busy` están revisados en código; no se afirma prueba manual nativa durante una consulta pendiente, ni prueba nativa independiente de reintento de hoja XLSX.
- No se obtuvo nueva evidencia de arrastre Finder: una llamada CUA `getApp` tardó 641 s y devolvió solo ventana/menús. Se devolvió el control al coordinador sin clicks, sin modificar datos, claves ni preferencias. El arrastre real continúa pendiente.
- El bundle final incluye estos cambios y la corrección de precisión CSV del módulo de datos. No hay builds ni cambios del explorador pendientes; no se reaplica el parche ni se amplía el alcance.

## Ampliación posterior: Explorar y sidecars

La nueva vista en cuadrícula, reordenación con puntero y autoguardado junto al
archivo están documentados y probados en [crossfilters-workspace.md](crossfilters-workspace.md).
El recibo anterior describe la entrega inicial; la ampliación conserva su contrato
con preferencias opcionales y sus correcciones de carga/reintento.

La previsualización posterior del arrastre (tarjeta flotante, hueco y animación)
tiene su verificación y límites en [drag-preview.md](drag-preview.md).

## Edición precisa de rangos en el histograma

- Los campos de mínimo y máximo bajo cada histograma se han retirado. Los valores sobre el intervalo son botones accesibles: al pulsarlos se muestra el valor completo para editarlo y Enter lo aplica; Escape cancela.
- Se admiten decimales precisos y filtros con un solo límite. Un valor inválido o que invierte el intervalo no se aplica.
- `bun run check` pasó. En el fixture del navegador, se creó un filtro por arrastre y se editó el mínimo a `250000.375`; el filtro conservó exactamente ese valor y el recuento cambió. Verificación nativa de este ajuste pendiente.

## Variables significativas (2026-09-23)

- Recuperado el ranking de Datoflow: distancia de variación total entre la distribución de las filas filtradas y la distribución completa, ordenada de mayor a menor y con umbral `> 0,005`. Es una medida descriptiva de diferencia, no una prueba de significación estadística.
- Aparece solo si el filtro deja una selección propia. El panel muestra diez variables y permite ampliar hasta treinta. Las barras se escalan respecto a la mayor puntuación visible; al pulsar una variable, se revela su tarjeta y se resalta temporalmente.
- «Mostrar» filtra el ranking por función y grupo temático de forma independiente del filtro del panel principal. Se pueden elegir varios grupos a la vez.
- El cálculo usa las distribuciones nativas ya solicitadas para los crossfilters, sin cargar filas adicionales en JavaScript. Los nulos numéricos se incluyen; las categorías omitidas por el límite de 256 se agrupan como resto. Las listas de varios valores se normalizan por incidencias y se excluyen si vienen truncadas porque el resto no se conoce.
- Verificación: `bun test src/features/explorer/significant-variables.test.ts src/features/explorer/model.test.js` (**16 pass**), `bun run build` (**PASS**) y `bun tauri build --debug --bundles app` (**PASS**, bundle en `src-tauri/target/debug/bundle/macos/Datolens.app`). En el fixture de navegador, filtrar Ciudad=Madrid produjo 60/240 filas y mostró Ciudad, Empresa y otras variables en orden descendente; el menú de funciones ocultó solo el ranking y pulsar Facturación desplazó su tarjeta al área visible.
- QA nativa del bundle debug: CSV temporal de 6 filas con `city`, `price`, `area`; al filtrar `city=Madrid`, la tabla mostró **3/6** y el ranking **city 50 %**, **price 50 %**, sin `area` (distribución idéntica). Pulsar `price` desplazó y resaltó su tarjeta. Se reabrió el archivo anterior Idealista, recuperando su vista Gráficos y **94.815/94.815** filas; después se cerró la instancia de prueba y se borraron el CSV temporal y su sidecar.

## Atajos de filtros estadísticos (2026-09-23)

- Los encabezados P25, Mediana y P75 son botones de filtro: aplican respectivamente [Mín, P25], [P25, P75] y [P75, Máx], con los límites de todas las filas como referencia fija, igual que en Datoflow. Se admiten variables numéricas y fechas; la media y los extremos siguen siendo valores informativos.
- El filtro se integra con los crossfilters existentes, aparece en la barra de filtros, actualiza tabla e histogramas y marca el atajo activo. Cuando hay selección, se muestran las estadísticas generales en gris y las de la selección debajo. Si falta un límite o un entero excede la precisión segura de JavaScript, el botón no genera un rango redondeado.
- `bun test src/features/explorer/statistic-filters.test.ts`: **3 pass**. `bun run check` y `bun run build`: **PASS**. En el fixture del navegador, P25 de Facturación dejó 60/240 filas, Mediana cambió el mismo filtro a 120/240, y P75 de Fundación combinado con el filtro numérico dejó 32/240; la barra mostró ambos rangos. Verificación nativa de este ajuste pendiente mientras integración recompila la app.

## Menú de variables significativas (2026-09-23)

- Corregido el ancho del menú «Mostrar»: nombres de grupos largos ya no lo ensanchan fuera del borde izquierdo del panel. Las etiquetas se abrevian visualmente, conservan el nombre completo en el tooltip y dejan las casillas y los recuentos visibles.
- `bun run check` y `bun run build`: **PASS**. En el fixture de navegador con filtro Ciudad=Madrid, el menú midió 280 px, quedó entre x=23 y x=303 en una ventana de 1280 px y no tuvo desbordamiento horizontal; seleccionar «Feature» actualizó el filtro. Pendiente comprobar esta corrección en un bundle nativo reconstruido.

## Plegado del ranking de variables (2026-09-23)

- «Variables significativas» tiene ahora un botón accesible para plegar y desplegar el ranking. El buscador principal queda separado 10 px del bloque en ambos estados.
- Verificación con fixture de navegador: tras filtrar Ciudad=Madrid, el botón pasó de expandido a plegado, ocultó los resultados y mantuvo visible el buscador con una separación medida de 10 px. `bun run check`, las 3 pruebas de ranking y `bun run build` pasaron.
- Pendiente comprobar la disposición en un bundle nativo reconstruido.

## Panel de variables al cerrar datasets (2026-09-23)

- El contenedor del área de trabajo se identifica con `dataset.id`. Al activar otro dataset, React desmonta el área anterior completa antes de montar su panel de variables y su tabla o gráfico.
- `bun run check` y `bun run build`: **PASS**.
- QA en la app macOS reconstruida: se abrió `victorianoi_followings.csv` junto a `matt_berman_openclaw_repliers.csv`, se mostró su panel de 14 variables, se cambió a Gráficos y se cerró la pestaña activa. Quedó una sola pestaña y un solo panel, con 11 variables del dataset restante. Se repitió con `idealista_dataset.csv` en Gráficos (41 variables); al cerrarlo quedó solo el panel de 11 variables. Al cerrar la última pestaña apareció el estado vacío sin panel de variables. Se reabrió Idealista: un solo panel de 41 variables y su gráfico guardado, con 94.815 filas.
- El estado corrupto anterior de la captura no se reprodujo antes del cambio, por lo que esta validación cubre la secuencia de cierre y el resultado visible, no una reproducción determinista del fallo previo.

## Crossfiltros categóricos compactos (2026-09-24)

- Ajustes incluye `Pulso · compacto` por defecto y `Detalle` para la disposición anterior. Pulso incrusta la categoría en la barra, comparte un eje inferior y usa filas más densas. La elección se guarda como preferencia local de interfaz.
- La lista abre 8→16→32… categorías y se contrae por los mismos niveles. La búsqueda sigue mostrando todas las coincidencias.
- `bun run check`, `bun run build` y pruebas de preferencias/representación: **PASS**. En el fixture de navegador se verificaron 8→16→30 (límite del fixture) →16→8, el cambio de modo con persistencia tras recarga, y el filtro `Norte Studio` con resultado 40/240.
- `./scripts/build-macos.sh`: **PASS**; bundle debug firmado en `src-tauri/target/debug/bundle/macos/Datolens.app`. La sesión nativa ya abierta sigue ejecutando su proceso anterior; queda pendiente comprobar el diseño en el nuevo proceso sin interrumpir esa sesión.

## Selector de tipo de dato compacto (2026-09-24)

- El selector de las tarjetas muestra un icono simple por tipo y un menú de filas con icono, nombre y marca de selección. «Auto (detectado)» aparece cuando hay una conversión y permite recuperar el tipo original. Se conservan los seis tipos soportados por Datolens.
- `bun run check`, `bun run build` y `./scripts/build-macos.sh`: **PASS**; bundle debug reconstruido y firmado. Inspección visual en el fixture aislado `docs/qa/scroll-regression.html?mode=explore`: menú de seis filas, tipo efectivo marcado y sin recorte. El proceso nativo abierto comenzó antes de la reconstrucción y sigue mostrando el menú anterior; queda pendiente abrir el bundle nuevo tras cerrar esa sesión, sin interrumpirla ni alterar sus datasets.

## Modo relativo al aplicar filtros (2026-09-24)

- Aplicar o modificar un filtro desde el explorador o los gráficos activa `%` en el panel de variables. Quitar filtros conserva el estado actual del control; el modo sigue siendo editable manualmente.
- `bun run check`, `bun run build` y `bun run app:build`: **PASS**; bundle debug firmado. El proceso nativo abierto comenzó antes de esta compilación y conserva la versión anterior. Queda pendiente comprobar el gesto en un proceso iniciado con el nuevo bundle.

## Densidad de tarjetas en Explore (2026-09-25)

- La cuadrícula virtual de Explore usa tarjetas de al menos 310 px, contando el relleno y la separación al decidir cuántas columnas caben. En el tamaño de referencia de 1440 px muestra cuatro tarjetas de unos 341 px por fila en vez de tres tarjetas anchas.
- `bun run check` y `bun test src/features/explorer/variable-window.test.ts`: **PASS** (4 pruebas). En el fixture de navegador se observaron cuatro columnas, encabezados y controles visibles sin recorte. `./scripts/build-macos.sh`: **PASS**; bundle debug firmado y verificado en `src-tauri/target/debug/bundle/macos/Datolens.app`.
- QA nativa posterior: `/Applications/Datolens.app` recién instalada y abierta con `NYC 311 Calls - 1.2M.csv` (1.123.454 filas, 59 variables). En Explore se observaron cuatro tarjetas por fila para `agency`, `complaint_type`, `descriptor` y `agency_name`, con gráficos, controles y porcentajes visibles. La captura original mostraba tres tarjetas en ese tamaño.
