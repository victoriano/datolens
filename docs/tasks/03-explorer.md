# Explorador: tabla, crossfilters y vista

Implementa `src/features/explorer/` y `src/styles/explorer.css`, exportando
`ExplorerApp({ api }: { api: DesktopApi })`. Importa el contrato compartido de
src/contracts/desktop-api.ts. No estás solo: respeta cambios y propiedad de los
otros threads. Integración posee App.tsx, manifiestos, estilos globales y contratos.

Parte de los componentes propios existentes. Preserva el comportamiento familiar:
filtros coordinados, histogramas/categorías,
orden de variables, fijar/ocultar, sorting multicolumna con prioridades arrastrables,
orden/ocultación/anchos de columnas. Recorta acoplamiento a feeds, servicios cloud
y exports sociales. No rediseñar desde cero ni imponer otra UX.

Implementa selector/apertura y estados vacíos/carga/error, tabla paginada o
virtualizada sin cargar el dataset entero, selección de celdas y rango rectangular,
conteos y restauración de vista mediante DesktopApi. Fijar IDs de filas/columnas
al formar el alcance de enriquecimiento, aunque el usuario ordene después.

Coordina con el thread de enriquecimientos la inserción de su EnrichmentPanel y
menús de ejecución; el panel pertenece a ese thread. No implementar otro scheduler
ni llamadas a proveedores desde React. Usa fixtures tipados durante integración,
pero el camino final debe trabajar con datos reales mediante api.

Pide al coordinador paquetes/primitivas de UI necesarias. No ejecutar installs
sobre el lockfile compartido ni modificar configuration raíz. Documenta exports,
props y verificaciones en docs/status/explorer.md. No commits/pushes/publicación.
