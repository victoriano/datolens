# Parquet PISA de 4.911 columnas — corrección (2026-09-23)

> Actualización posterior: [Crossfilters progresivos](progressive-crossfilters.md) sustituye el muestreo de todas las columnas y la pausa de Auto remoto. Esta página conserva la evidencia de la entrega anterior.

URL reproducida: https://data.pisa.victoriano.me/pisa_espana_2000_2025_estudiantes_todas_las_columnas.parquet

## Causa y cambio

La UI enviaba todas las columnas no ocultas en cada PageRequest, incluso las miles fuera de pantalla. El motor con esa petición reproduce exactamente `failed to allocate data of size 192.0 KiB (488.1 MiB/488.2 MiB used)`. No se cambia el límite DuckDB de 512 MB ni la fuente.

- `table-window.ts`, `DataTable.tsx` y `ExplorerApp.tsx`: ventana horizontal calculada por anchos y viewport, con dos columnas de margen; consulta y DOM limitados a ese tramo. Espaciadores conservan el ancho total, selección y orden. Flechas horizontales sobre el contenedor permiten navegar sin afectar al teclado del redimensionado.
- Se descartan páginas de otra proyección/filtro/orden/offset para evitar valores obsoletos. Redimensionar la ventana o los paneles recalcula el tramo.
- Copiar filas o selecciones que abarcan columnas fuera de pantalla solicita esas columnas explícitamente en bloques de 16, combina por ID y comprueba revisión. Exportación conserva todas las columnas no ocultas.
- `distributions.ts`: al devolver `deferredReason`, termina el recorrido. Auto remoto ya no repite la misma respuesta 614 veces con 4.911 variables.

## Evidencia

- Reproducción ejecutable `src-tauri/crates/datolens-data/examples/pisa_remote.rs`: `--all` reproduce fallo (`docs/qa/pisa-before.txt`). Sin esa opción comprueba 100 filas iniciales/16 columnas, 100 filas desde ordinal 100/columnas desde 1000, y 54 filas finales/últimas 11 columnas. IDs y recuento 191.254 comprobados. Consultas de 1,6–2,2 s en esa ejecución (`docs/qa/pisa-after.txt`); no son una garantía de latencia de UI/red.
- Pruebas frontend: `docs/qa/pisa-frontend-tests.txt`. Geometría de 4.911 columnas, extremos, cambio de anchos, ocultación/reordenación y parada del análisis diferido.
- QA nativa aislada: `Datolens PISA QA.app`, identificador `com.victoriano.datolens.pisaqa`. URL exacta abierta desde el diálogo, filas 1–100 y 101–200 visibles; panel remoto en pausa sin bucle. No se modificó la sesión principal.
- Build macOS y firma: `docs/qa/pisa-native-build.txt`, `docs/qa/pisa-main-build.txt`.

## Alcance

Corrige apertura y exploración de la tabla. Una petición explícita de todas las columnas simultáneamente al motor sigue pudiendo agotar el límite. Análisis manual, ordenación, exportaciones y derivados pueden requerir leer mucho más de la fuente y no se presentan como operaciones validadas exhaustivamente sobre este archivo. No se hicieron llamadas IA.

### Cierre de QA nativa

Última compilación: restauró PISA en filas 101–200; ocho flechas derechas con foco en la tabla cambiaron la proyección a ST02Q01…ST05Q01, con valores nativos visibles. Una celda COUNTRY=724 seleccionada antes de desplazar quedó fuera del viewport; «Copy visible» recuperó su columna y al pegar en la búsqueda mostró exactamente `724` (búsqueda limpiada después). Confirmadas 37 pruebas frontend, 0 fallos; `git diff --check` en archivos modificados por esta tarea y firma estricta del bundle principal PASS. El proceso principal del usuario sigue siendo el anterior hasta que cierre/reabra la app. La QA no reinició ese proceso.

Las modificaciones concurrentes de barra/Ajustes y menús se preservaron; el build principal incluye el estado compartido al compilar. El recorrido nativo se hizo en el identificador aislado, sin atribuirlo a una reapertura de la sesión principal.
