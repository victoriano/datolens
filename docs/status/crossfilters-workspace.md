# Exploración ampliada, arrastre y autoguardado junto al origen

Fecha: 22 de septiembre de 2026. Petición: explorar todas las variables con
crossfilters, poder reordenarlas por arrastre y recuperar la vista al reabrir.

## Entrega

- **Explorar** ocupa el área de trabajo con una cuadrícula adaptable de variables.
  Comparte filtros, recuentos y distribuciones con **Tabla**. Escape vuelve a la
  tabla. Compatible con el botón verde de pantalla completa de macOS.
- Se conservan el buscador, las variables fijadas/ocultas, los porcentajes y la
  ordenación de categorías. Los histogramas ajustan su ancho al espacio disponible.
- Variables, columnas y prioridades de sorting usan captura de puntero, con destino
  resaltado, cancelación, autoscroll y flechas del teclado. No se desactiva el
  handler nativo de archivos de Tauri. Al cruzar el límite de fijadas, la variable
  adopta el grupo de destino para que el cambio de posición sea visible.
- Peticiones de distribuciones en lotes de hasta 64 columnas; un archivo más ancho
  sigue pudiendo explorar todas sus variables. Reordenar no recalcula distribuciones.
- El estado se escribe automáticamente en `<archivo.csv>.datolens.json` o
  `<archivo.parquet>.datolens.json`, en el mismo directorio. XLSX usa
  `<archivo.xlsx>.sheet-<sha256 del nombre de hoja>.datolens.json`; cada hoja tiene
  su propia vista y ningún nombre de hoja se interpreta como una ruta.
- El JSON conserva filtros, columnas (orden/ocultación/anchos), prioridades de
  sorting, variables (orden/fijadas/ocultas/porcentajes/categorías/búsqueda/expansión),
  modo de vista, visibilidad de paneles y página. También conserva las definiciones
  de enriquecimiento existentes. Formato de vista 1 con preferencias opcionales.
- Migración desde el JSON anterior en Application Support al primer autoguardado,
  sin borrar el anterior ni perder definiciones/resultados. Un sidecar existente
  se valida antes de considerar copias locales y no se sobrescribe si es
  incompatible o está mal formado.
- Escritura temporal, sincronización de archivo y rename atómico. En macOS no se
  abre el directorio para sincronizarlo después del rename: la prueba con el CSV
  real en Descargas detectó una espera bloqueante en esa apertura, con el primer
  JSON ya escrito y los siguientes cambios pendientes. La muestra del proceso
  localizó `save_view -> write_project -> atomic_json -> File::open(parent) -> open`.
  El bundle corregido confirmó varios guardados y reaperturas sin esa espera.
- Si no se puede escribir junto al origen, el proyecto se guarda automáticamente
  en Application Support como `<datasetId>.pending.datolens.json`. La UI muestra
  «Guardado en este Mac», la ruta completa y «Guardar junto al original» para
  reintentar. La marca `savedAtNs` permite restaurar la copia más reciente, incluso
  si ya existía un sidecar más antiguo. El próximo guardado con permisos de
  escritura devuelve los ajustes al origen. La copia anterior se conserva.
- Si fallan ambas ubicaciones, el error y su reintento son visibles y se conserva
  la versión anterior; no se anuncia un guardado exitoso.
  DuckDB, resultados, jobs/historial SQLite y claves continúan en su almacenamiento
  previo. Este JSON no es un paquete portable de resultados de enriquecimiento.

## Verificación automática

- `bun run check`: PASS.
- `bun test src/features/explorer/model.test.js`: 11 PASS, 42 aserciones.
- `scripts/test-native.sh`: integración 2, datos 18 y enriquecimientos 12 PASS.
  El benchmark existente de un millón de filas está ignorado por defecto y no se
  ha repetido en esta tarea. Log: `docs/qa/crossfilters-native-tests.txt`.
- Casos nuevos: reapertura usando una caché nueva, conservación del archivo fuente,
  migración de vista/definiciones/resultados, sidecar ajeno protegido, dos hojas
  XLSX independientes, recuperación local con carpeta de solo lectura, retorno al
  origen, fallo de ambas ubicaciones, preferencias antiguas, movimiento entre
  grupos fijados y consulta/cancelación con 130 columnas.
- `scripts/build-macos.sh`: build del bundle real y firma ad hoc deep/strict PASS.
  Log: `docs/qa/crossfilters-build.txt`.

## Verificación en Datolens.app real

1. Reproducido antes del cambio: arrastrar PERIOD sobre ASSETID no alteraba el orden.
2. Archivo real de Idealista, 94.815 filas y 41 columnas: cuadrícula, arrastre de
   PERIOD delante de ASSETID, confirmación de guardado y lectura del JSON junto al
   CSV. Sus cinco variables ocultas anteriores se conservaron en la migración.
3. Cierre con Cmd+Q y nueva apertura: modo Explorar y orden recuperados. La alternativa
   con flecha del teclado devolvió el orden original; se deja este archivo abierto
   en Explorar al finalizar.
4. CSV nativo de prueba con 240 filas: Madrid deja 60; Madrid + Tech deja 20;
   añadiendo revenue entre 1200 y 9600 deja 8. Tabla y distribuciones coinciden.
5. Drag real de revenue dentro de la cuadrícula conserva los tres filtros. Drag
   real de su columna la mueve al principio de la tabla. Drag real de sorting
   cambia la prioridad de revenue/city a city/revenue.
6. Fijado de revenue, ocultación de id, porcentajes y vuelta a Explorar. Cmd+Q y
   reapertura recuperan las ocho filas, filtros, órdenes y presentación. El JSON
   tras reiniciar coincide exactamente con el snapshot anterior al cierre:
   `docs/qa/crossfilters-restored-view.json` (fixture, sin datos del usuario).
7. Pantalla completa nativa con el botón verde: cuadrícula adapta el número de
   columnas y los histogramas. Regreso a ventana y tabla conserva filtros.
8. Consola del WebView sin errores tras reapertura y redimensionado. Corregido el
   aviso de ResizeObserver del primer bundle usando requestAnimationFrame.
9. Mismo fixture con su carpeta temporal en modo 0555: cambiar porcentajes muestra
   «Guardado en este Mac», ruta real y reintento. El sidecar anterior permanece
   idéntico. Cmd+Q y reapertura recuperan exactamente la vista de la copia local.
   Restaurar 0755 y pulsar «Guardar junto al original» elimina el aviso y escribe
   la misma vista junto al CSV con una marca más reciente. Permisos del fixture
   restaurados y archivo Idealista abierto de nuevo al terminar.

El arrastre externo desde Finder continúa sin recorrido manual en esta tarea;
se conserva su suscripción Tauri. La selección de archivo por diálogo sí se probó.
No se han realizado llamadas a Gemini ni cambios en credenciales, commits, pushes
ni publicaciones. Se preservaron los cambios de apariencia nativa que ya existían.
