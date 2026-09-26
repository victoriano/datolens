# Pase nativo final — 23 de septiembre de 2026

App principal: `src-tauri/target/debug/bundle/macos/Datolens.app`.
Fixture: `fixtures/generated/integration-september-23.csv`, cuatro filas.

- Editar price a «Precio de prueba» y añadir descripción conserva función analítica
  Unclassified; tabla y tarjeta actualizadas. Sidecar con name/description sin role.
- P25 aplica [100,175] y deja 1/4; central aplica [175,325] y deja 2/4;
  P75 aplica [325,400] y deja 1/4, usando cuartiles globales pese al filtro anterior.
- Pulsar el máximo sobre el histograma, escribir 300.25 y Enter conserva exactamente
  [175,300.25], con 2/4 filas. No hay campos permanentes de rango bajo el gráfico.
- Fecha mínima global 2024-01-01 00:00:00 muestra Jan 01, 24. P75 temporal aplica
  2024-01-03T06:00:00.000Z a 2024-01-04T00:00:00.000Z; combinado con precio P75
  deja la fila Barcelona/400/2024-01-04, ID exacto 9007199254740999.
- Menú Columns: búsqueda «precio» muestra solo el alias marcado. Al borrar la
  búsqueda vuelven las cuatro columnas en su orden, todas marcadas. Captura revisada.
- La media temporal mostró una inconsistencia: DuckDB devuelve +01 y JavaScript
  no acepta ese offset abreviado. Se normalizó +HH a +HH:00 con regresiones de
  localización y cambio de día UTC. Recompilación y firma PASS. Tras Cmd+Q,
  inventario de app cerrada y apertura por ruta exacta: media global Jan 02, 24
  y media filtrada Jan 04, 24, coherentes con los demás estadísticos. Captura revisada.

Workspace y dos fórmulas con reapertura: PASS en el bundle Integration QA conjunto;
recibos en `workspace-native.md` y `../status/enrichment.md`. No se hicieron
llamadas IA/API en este pase. La tarea de Integration QA se cerró al terminar.

- Reinicio final conserva filtros, modo Explorar, alias, descripción y rol sin
  clasificar. 45 pruebas frontend / 1640 aserciones PASS; 119 pruebas totales
  sumando datos, enriquecimientos y root. Dos pruebas de datos ignoradas.
- Cerrado el fixture; restaurado el archivo previamente abierto
  `matt_berman_openclaw_repliers.csv`, 338/338 filas y 10 columnas, en Tabla.
  Se conserva su pestaña y vista. No se abrió Idealista porque ya no era el archivo
  del usuario al iniciar este pase final.
- Menú Columns con diez variables: altura acotada y desplazamiento interno hasta
  reply_likes visibles en captura; cerrado al terminar, sin cambiar selección/orden.
- Integration QA cerrada; Datolens principal final queda abierta.
