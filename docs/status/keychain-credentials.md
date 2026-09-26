# Credenciales locales estables — 24 de septiembre de 2026

## Regresión al actualizar con la app abierta — corregida el 24 de septiembre

El error «El almacén de credenciales no reconoce esta firma de Datolens»
no indicaba claves perdidas. El empaquetado anterior reemplazaba el bundle
principal aunque siguiera ejecutándose. El proceso conservaba el código viejo,
pero la ruta ya tenía otra firma; el helper rechazaba correctamente la identidad.
Se observó un proceso iniciado a las 17:59:10 y el bundle sustituido a las 18:01:23.
Una reapertura recuperó ambos proveedores. La prueba nativa ahora reproduce
exactamente el rechazo al sustituir un padre firmado vivo y su recuperación
tras abrir el proceso nuevo, usando únicamente claves sintéticas.

- `scripts/macos-bundle.py`: compilación sin empaquetar sobre el target compartido;
  empaquetado y firma en un target temporal independiente. Conserva literalmente
  el helper autorizado. Un bloqueo excluye otros builds/instalaciones del script.
- Si la app principal está abierta, el build solo deja una actualización pendiente.
  Tras salir, `scripts/build-macos.sh --install-pending` verifica la firma y el
  helper, instala por movimiento de directorios y conserva la app anterior.
  Nunca copia archivos encima del bundle abierto.
- El hook `beforeBundleCommand` impide saltarse esta protección con una llamada
  directa a Tauri sobre el target principal. La instalación también rechaza una
  app abierta. Ambas protecciones se comprobaron contra la instancia real.
- El cliente distingue rechazo de identidad, terminación del helper y respuesta
  inválida. Ajustes termina en «No disponible» si falla la consulta. El filtro IA
  distingue un error de consulta de la ausencia de clave y no pide otra API key.
- El binario autorizado del helper no ha cambiado: sigue siendo
  `51ff7572f85386aa26c090e0473d77f877109202`.

Verificación: 42 tests Rust; cuatro tests de actualización con un proceso real
descartable; regresión nativa de identidad, migración y acceso; TypeScript y
build nativo firmado. Durante el build real, el PID, los bytes y los inodos de
la app abierta y de su helper permanecieron intactos. Recibos:
`docs/qa/credential-helper-update-regression.txt`,
`docs/qa/macos-bundle-regression-tests.txt`,
`docs/qa/credential-update-live-preservation.json`,
`docs/qa/credential-update-live-guards.json` y
`docs/qa/credential-update-installed.json`.

**Activado y comprobado tras dos actualizaciones y reinicios.** Ambas claves se
recuperan sin contraseña y el filtro con Gemini 2.5 Flash devuelve `tenure ≥ 12`.
La prueba también corrigió el contrato JSON explícito del prompt del filtro.
Persisten errores HTTP independientes con algunos modelos de Gemini, descritos
en `docs/status/gemini-http-400.md`. Recibo final y límites precisos:
`docs/qa/credential-update-native.md`.

## Causa comprobada

La corrección del 23 de septiembre en `keychain-signing.md` era insuficiente.
El certificado local estabilizaba el requisito designado, pero no la partición
del Llavero: macOS clasifica una firma local que no es de Apple por `cdhash`.
La ACL real de Gemini contenía una lista de hashes de compilaciones anteriores;
la de Jev también. Se inspeccionaron únicamente referencias y ACL, nunca los
valores de las claves. La implementación de Apple confirma este comportamiento:
https://github.com/apple-oss-distributions/Security/blob/main/securityd/src/clientid.cpp

Además, cada petición de modelo leía nuevamente el secreto. Un lote podía abrir
varios permisos, incluidos reintentos después de denegar el primero.

## Implementación

- `native/credential-helper/main.c`: ejecutable pequeño e independiente de la
  aplicación. Su binario y su firma permanecen idénticos entre builds normales.
  Solo responde por pipes a un padre cuyo código en ejecución tenga el ID de
  Datolens y el mismo certificado local, o el equipo Apple de distribución
  establecido (`CW546NZ5HC`). Exige Hardened Runtime y rechaza padres depurables
  o que permitan inyección mediante variables DYLD. No hay socket, argumentos
  con secretos, ficheros de claves, logs ni API para otros programas.
- `scripts/build-credential-helper.py` conserva el binario mientras no cambien
  su fuente o identidad. `scripts/build-macos.sh` lo copia literalmente después
  del empaquetado Tauri y firma la app con Hardened Runtime. La excepción de
  validación de bibliotecas permite el DuckDB local sin Team ID; no permite
  variables DYLD ni `get-task-allow`. `bun run app:build` usa este script.
- `src-tauri/src/credentials.rs`: una caché nativa por proveedor, compartida por
  modelos, datasets y funciones IA. Serializa la primera lectura y conserva los
  rechazos hasta el reintento explícito en Ajustes. Guardar actualiza la caché;
  eliminar la vacía. Los secretos de la caché y los buffers IPC usan `Zeroizing`.
- Las claves nuevas se crean cifradas en el Llavero, servicio
  `com.victoriano.datolens.providers.local-v2`, con la ACL normal que permite
  acceder al componente que las creó. Nunca se habilita acceso a todas las apps.
- Primera lectura de una clave antigua: autorización macOS, copia dentro del
  Llavero y lectura de comprobación sin interacción. Basta «Permitir»: la copia
  nueva pertenece al componente estable. La entrada original se conserva como
  respaldo; «Eliminar» borra ambas para evitar que reaparezca una clave antigua.
- Leer una entrada ya migrada no muestra diálogos. Si se bloquea manualmente el
  Llavero, Ajustes permite autorizar de nuevo de forma explícita. Una denegación
  no se convierte en veinte solicitudes de contraseña de un lote.

El permiso inicial de las entradas antiguas sigue perteneciendo a macOS; el
usuario debe completarlo. Esta solución evita que un build ordinario o una nueva
llamada al modelo lo vuelva a pedir. Cambiar deliberadamente el helper, su
certificado o el canal de distribución puede requerir una autorización nueva:
no se pretende anular los controles de identidad del sistema.

## Verificación

- Caché: seis pruebas de lectura concurrente (32 llamadas), denegación/reintento,
  guardar/reemplazar, fallo al guardar, eliminación y separación por proveedor.
- `scripts/test-credential-helper.py`: usa exclusivamente credenciales
  sintéticas en servicios de prueba con UUID y los elimina al terminar.
  Dos padres firmados con hashes distintos leen la misma clave entre procesos
  sin diálogo. Comprueba migración, borrado, separación de proveedores y el
  rechazo de otros IDs, firma ad hoc, padre sin Hardened Runtime, padre
  depurable y ejecución directa desde Python.
- Reconstrucción limpia con la misma fuente y toolchain: mismo `cdhash` del helper
  (`docs/qa/credential-helper-reproducibility.txt`).
- Recibo nativo: `docs/qa/credential-helper-native-tests.txt`.
- Pruebas Rust de integración: `docs/qa/credential-cache-tests.txt`.

**Activado y probado en la app principal.** Se migraron las claves reales de
Gemini y Jev después de sus autorizaciones iniciales. Ambas se recuperaron sin
otro diálogo después de salir y abrir la app. Una llamada real Gemini 2.5 Flash
de colores de Churn devolvió dos propuestas sin contraseña. El catálogo remoto
también se actualizó correctamente. Jev se verificó en acceso local, no HTTP.
Recibo detallado: `docs/qa/credential-helper-native.md`. No se usaron claves
reales en las pruebas automatizadas ni se guardaron sus valores en los recibos.

## Distribución y desarrollo

El binario de desarrollo sin firmar de `tauri dev` no puede pedir secretos al
helper. Para probar IA real se abre el bundle firmado de `scripts/build-macos.sh`.
La notarización firma también el helper antes de la app. Un cambio de canal
local → Developer ID requiere comprobar sus permisos. El flujo App Store
sandbox requiere su propia comprobación nativa; estas pruebas no lo validan.

## Ubicación estable — 25 de septiembre de 2026

La app del usuario se instala ahora en `/Applications/Datolens.app`, fuera del
`target` regenerable de Cargo. README y AGENTS fijan esa ruta para las siguientes
actualizaciones. Se reutilizó el bundle recién compilado por la tarea de densidad
de Explore, verificando firma y helper antes y después del movimiento con la app
cerrada. La instancia PID 16592 arrancó desde Aplicaciones, restauró los datasets,
mostró ambos proveedores configurados y permitió `Authorize access` de Gemini y
Jev sin contraseña ni error de firma. Pasan los cuatro tests del instalador.

Se intentó anclar mediante Finder > File > Add to Dock, pero no aparece una
entrada persistente de Datolens en las preferencias del Dock; anclaje no verificado.
