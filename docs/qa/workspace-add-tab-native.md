# Añadir otra hoja o dataset — QA nativa

2026-09-23. Bundle macOS de QA aislado `Datolens Sampling QA.app`, identificador `com.victoriano.datolens.samplingqa`. Build conjunto firmado: `docs/qa/sampling-final-build.txt`; comprobación TypeScript: PASS.

- Estado inicial: pestaña `NYC 311 Calls - 1.2M.csv`, 1.123.454 filas, muestra automática de 23.000, sin filtros. El botón accesible `Add another sheet or dataset` apareció a continuación de la pestaña.
- Al pulsar «+», el selector nativo mostró `Where: datolens-performance`, carpeta del archivo abierto. Cancelar devolvió la misma pestaña y recuento.
- Con «+» se abrió `/tmp/datolens-plus-qa.kpcxAU/otra_hoja.csv` (fixture de dos filas). Apareció una segunda pestaña activa junto a NYC y la tabla mostró `2 of 2 rows`.
- Al volver a pulsar «+», el selector mostró `Where: datolens-plus-qa.kpcxAU`, carpeta del archivo recién abierto. Cancelar dejó intactas ambas pestañas.
- Cerrada la pestaña temporal, volvió NYC con 1.123.454 filas y muestra automática de 23.000. El siguiente «+» volvió a iniciar en `datolens-performance`. Selector cancelado y app de QA dejada en el estado inicial.

La prueba comprobó CSV y cambio de carpeta en la sesión nativa. No se repitió aquí la prueba de hojas XLSX ni la persistencia tras reinicio; esas rutas usan el registro y la memoria de pestañas ya verificados en `docs/qa/workspace-native.md`.
