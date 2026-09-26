# Fuentes remotas — integración y QA (2026-09-23)

## Verificación automatizada

- Datos: 54 PASS, 2 pruebas manuales anteriores ignoradas. Cinco nuevas pruebas
  HTTP con httpfs real, incluidos bytes leídos, revisión/If-Match, persistencia,
  fallback y perfiles Auto diferidos. `remote-parquet-data-tests.txt`.
- Integración: 14 PASS. Cinco nuevas pruebas cubren descarga CSV nativa y
  reapertura con enteros > 2^53, fallback Parquet sin Range, límites de streaming,
  limpieza de archivos parciales, nombres seguros y errores HTTP sin parámetros
  de URL. `remote-root-tests.txt`.
- El primer intento dentro del sandbox no podía abrir un puerto localhost. La
  repetición autorizada fuera del sandbox permitió ejecutar las pruebas HTTP.
  Se corrigió una aserción de ruta temporal para comparar su ruta canónica macOS.

## Preparación nativa

Instancia aislada `com.victoriano.datolens.remoteqa` / Datolens Remote QA.
Servidor de fixtures sintéticos en localhost:18764. CSV de clientes, Excel de
dos hojas, Parquet de cinco millones de filas y Parquet pequeño sin Range.
Las instancias principales y su sesión Jev se preservan.

Build principal firmado: `remote-main-build.txt`. Bundle aislado firmado y
verificado con `codesign --verify --deep --strict`: `remote-qa-build.txt`.

Recorrido nativo PASS en `Datolens Remote QA.app`:

- Con cero pestañas, «+» ofrece archivo del Mac y URL. La URL CSV abrió
  `customers.csv` automáticamente con 3 filas y una copia local bajo la carpeta
  de la app de QA.
- La URL `ventas.xlsx` abrió `Clientes` y registró también `Pedidos` como otra
  pestaña. Con esas dos hojas y el CSV, «Derivar de los datasets abiertos» abrió
  el diálogo de lenguaje natural con las tres fuentes marcadas. No se creó
  ningún resultado en esta prueba.
- `large.parquet` (5 millones de filas, 39.033.081 bytes) abrió con `sourcePath`
  HTTP y tabla paginada. El análisis automático indicó que estaba en pausa;
  después del ajuste final no mostró «muestra de 0» ni «sin coincidencias».
  Cerrar y reabrir la app de QA recuperó la pestaña y el recuento. El test HTTP
  del motor confirmó que metadatos y páginas usan rangos y que incluso una
  página lejana transfirió menos de la mitad del archivo.
- `/download/tiny.parquet` sin Range abrió una copia local de 12 filas. Una
  URL `tiny.parquet?token=private-sentinel` también se descargó a copia local:
  la ruta de la pestaña no contiene el parámetro. Test nativo dirigido PASS:
  `remote-signed-url-test.txt`.
- «Abrir archivo del Mac…» abrió el selector de macOS; tras navegar por hojas
  descargadas, el selector partió de Documents, no de la carpeta interna de
  caché. Cancelar conservó las pestañas.

La app de QA se ejecutó separada de las instancias principales. No se usaron
credenciales reales ni se hicieron llamadas a Gemini.

Revisión final de Integración (13:20 CEST): frontend 49 pruebas PASS en este
corte. Tras la QA se ajustó el callback de activación para propagar el fallo si
`open` devuelve false, evitando cerrar el diálogo como si hubiera tenido éxito.
El principal se recompiló con TypeScript y firma estricta PASS; el recorrido
nativo anterior no se atribuye como una repetición contra este último ajuste.
Las instancias principales no se reiniciaron. La llamada CUA pendiente reabrió
Remote QA después del cierre de Workspace; al detectar una interacción nueva
en esa ventana, Integración la preservó sin cerrarla ni modificar el diálogo.

## Límites de esta entrega

Las descargas completas admiten hasta 8 GiB. Range requiere soporte real del
servidor y ETag fuerte; en caso contrario se descarga una copia local. Las URLs
con cualquier query se descargan localmente para no persistir posibles tokens.
El tamaño
de los bloques y grupos Parquet determina los bytes de cada consulta. Auto
remoto aplaza perfiles; una muestra manual, filtros, gráficos, exportaciones y
datasets derivados pueden recorrer muchas columnas o toda la fuente. El origen
Range debe seguir disponible. La extensión empaquetada está verificada para
macOS ARM64. No se necesitan ni se hacen llamadas a Gemini en este recorrido.
