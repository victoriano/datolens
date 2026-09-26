# Permisos persistentes de archivos en App Sandbox

Corrección acotada de Integración para la tarea de distribución
`01a0cf52-94d6-7440-a55a-930675109553`, 23 de septiembre de 2026.

## Problema y cambio

La tarea de distribución reprodujo que el selector abría un CSV externo de
1.200 filas, pero reabrir el mismo paquete después de cerrar la app fallaba con
`Operation not permitted`. Se guardaba la ruta, sin conservar la autorización
temporal de Powerbox.

- `src-tauri/src/file_access.rs` detecta el entitlement App Sandbox mediante
  `SecTaskCopyValueForEntitlement`. Sin sandbox no cambia la apertura habitual.
- El adaptador llama a `remember_source_access` inmediatamente después de que
  el selector devuelva un archivo, mientras su permiso temporal está disponible.
- Los bookmarks con security scope se guardan únicamente en
  `AppData/projects/source-bookmarks.json`. Escritura atómica mediante un
  temporal privado (0600). Sus bytes no pasan al WebView ni a logs/sidecars.
- Antes de metadata, canonicalize, apertura y listado de hojas XLSX, se resuelve
  el bookmark sin mostrar UI ni montar volúmenes, y se inicia el acceso usando
  exactamente el CFURL resuelto. Canonicalizar después de adquirir acceso
  registra también el alias `/private/tmp` que persiste DataStore.
- Un bookmark stale se renueva mientras el acceso está activo. Se conserva la
  ruta anterior como alias de permisos si macOS resuelve un archivo movido.
  Esto no cambia las reglas de identidad de datasets ni migra todas las pestañas
  de la UI que puedan referirse al nombre anterior.
- Un selector nuevo reemplaza el permiso anterior de esa ruta. Un permiso que
  no puede recuperarse devuelve un mensaje para volver a seleccionar el archivo.
  Las rutas guardadas antes de esta corrección necesitan seleccionarse una vez.
- Las fuentes generadas/descargadas bajo el almacén interno no crean bookmarks.
  Las fuentes HTTP siguen su flujo existente. No cambia el fallback de sidecar
  dentro del contenedor ni se solicitan permisos de una carpeta más amplia.

## Vida del acceso

Un guard RAII conserva el CFURL, y llama a stop exactamente una vez por start
exitoso. Las sesiones nativas del mismo archivo/hojas comparten el guard por Arc;
el registro de permisos solo mantiene Weak. Errores de apertura, conversión de
ruta o persistencia sueltan automáticamente la referencia correspondiente.

El guard de una fuente abierta vive mientras la sesión nativa necesita su
DataStore (incluidos trabajos de enriquecimiento). Actualmente AppService
mantiene esas sesiones en caché hasta su cierre: cerrar una pestaña no destruye
la sesión nativa ni corta el acceso a un trabajo que aún la usa. Esta corrección
no añade una API de desalojo/cierre de sesiones. El listado de hojas sin una
sesión activa libera el acceso al terminar la operación.

Se sigue el equilibrio start/stop documentado por
[Apple](https://developer.apple.com/documentation/foundation/url/startaccessingsecurityscopedresource()).
Las declaraciones/opciones se comprobaron contra CFURL.h y SecTask.h del SDK
local. La única dependencia directa añadida es core-foundation 0.10 para macOS,
ya presente transitivamente en Cargo.lock; no se descarga un nuevo framework.

## Verificación y entrega

- Suite raíz: **19 PASS**, `docs/qa/sandbox-bookmark-tests.txt`.
- Cinco pruebas nuevas con backend simulado verifican persistencia entre
  instancias, renovación stale, alias de archivo movido, scopes compartidos y
  liberación de la última referencia, liberación al fallar la escritura,
  permisos 0600 y ausencia de bookmarks para fuentes internas.
- Las catorce pruebas anteriores de importación, consultas y persistencia
  siguen pasando. Los fixtures HTTP se ejecutaron con permiso de localhost.
- TypeScript PASS, `docs/qa/sandbox-bookmark-typecheck.txt`; diff-check PASS.
- **Pendiente de distribución**: recompilar su paquete firmado con sandbox y
  probar selector → CSV/XLSX → cierre normal → relanzamiento del mismo paquete
  → restauración/consulta/persistencia de vista. No se atribuye a los mocks una
  comprobación real de la autorización de macOS.

No se modificaron website/, distribution/, vendor/ ni el loader de httpfs.
No se reinició la app principal ni se publicó nada. Cargo habitual libre.

## Confirmación nativa posterior

Distribución recompiló y firmó Store QA con sandbox. Seleccionar una vez el CSV
externo de 1.200 filas, filtrar Madrid (300 filas), cerrar con ⌘Q y relanzar el
mismo bundle restauró el archivo y filtro sin selector. El almacén tiene modo
0600. Evidencia recibida: `artifacts/distribution/sandbox-bookmarks-before-restart.txt`
y `sandbox-bookmarks-after-restart.txt`. Este recorrido confirma CSV real bajo
sandbox; no se atribuye como prueba de reinicio de XLSX o movimiento de archivo.

La validación funcional con sandbox no certifica distribución Apple. La QA
posterior de distribución utiliza una copia aislada con firma local de desarrollo
y Hardened Runtime desactivado; la candidata mantiene Hardened Runtime activado.
Continúan pendientes la firma Apple real y Keychain bajo el perfil de App Store.
