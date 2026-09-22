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
