# Selección inicial de todas las tablas — QA nativa

2026-09-23. `bun run check`: PASS. Bundle principal `Datolens.app` recompilado y firma verificada (`docs/qa/workspace-default-all-build.txt`). Bundle aislado `Datolens All Tables QA.app`, identifier `com.victoriano.datolens.alltablesqa`, compilado desde la misma fuente mediante override Tauri y firmado (`docs/qa/workspace-default-all-qa-build.txt`).

- Se abrieron `clientes.csv` y `pedidos.csv` desde la app de QA. Ambas aparecieron como pestañas.
- Al abrir «Create dataset», ambas casillas tenían valor marcado y el pie indicaba `2 tables selected`.
- Se desmarcó `clientes.csv`: su casilla pasó a desmarcada y el pie indicó `1 tables selected`.
- Se cerró y volvió a abrir el diálogo: ambas casillas aparecieron de nuevo marcadas, con `2 tables selected`.
- No se preparó ni ejecutó una consulta. La instancia aislada se cerró y los CSV temporales y sus sidecars se retiraron.
