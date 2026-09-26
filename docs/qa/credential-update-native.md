# Regresión de credenciales al actualizar — QA nativa, 2026-09-24

## Causa y protección verificadas

El proceso que mostraba el rechazo había arrancado a las 17:59:10; su bundle
se sustituyó a las 18:01:23. La firma del disco era válida, pero no correspondía
al código que seguía ejecutándose. Una prueba nativa con dos padres firmados y
claves sintéticas reproduce ese rechazo al sustituir el archivo de un padre
vivo; un proceso nuevo vuelve a acceder sin permiso del Llavero.

El nuevo build separa compilación y empaquetado. Durante el build completo real,
el PID, los bytes y los inodos del ejecutable principal y del helper abierto
permanecieron iguales. El intento de instalar mientras seguía abierto y una
llamada directa a `tauri bundle` fueron rechazados antes de alterar la app.

Se instalaron dos versiones mediante `--install-pending`, después de salir de
la app por su interfaz. Se conservó cada bundle anterior. La versión final está
abierta en el bundle principal, PID 74450 al verificar:

- Principal: `137eeaba5939aba8d30e79a0a480d037a3df6058`.
- Helper: `51ff7572f85386aa26c090e0473d77f877109202`, idéntico al ya autorizado.
- Validación del código en ejecución: `runtime_validation=0`; Hardened Runtime.

## Flujo real

- Settings detecta Gemini y Jev como configurados después de actualizar y reabrir.
- Jev → Authorize access devuelve `Access ready` sin diálogo de contraseña,
  tanto tras la primera actualización como tras la segunda. No se probó Jev HTTP.
- El catálogo remoto de Gemini se refresca con la clave existente, sin contraseña.
- Se abrieron modelos distintos y se hicieron peticiones explícitas; ninguna
  volvió a pedir contraseña ni devolvió el rechazo de firma.
- El filtro de Gemini 2.5 Flash, limitado a `tenure` y sin enviar filas, devuelve
  una propuesta válida `tenure ≥ 12`, con Apply filters habilitado. Explicación:
  `Filters rows where the numeric 'tenure' is greater than or equal to 12.`
- La primera respuesta con límite inclusivo no se pudo deserializar. Se reforzó
  el contrato JSON en el prompt de filtros y se repitió la prueba en el binario
  recompilado: la propuesta anterior es el resultado de esa verificación.
- La propuesta se canceló. Quedó abierta la tabla de churn con 7.043 de 7.043
  filas, sin aplicar filtros de prueba ni guardar cambios de preferencias.

## Límites observados

El HTTP 400 de Gemini 3.8 Flash y 3.5 Flash Lite sigue siendo independiente del
Llavero y no queda resuelto por este cambio. Gemini 2.5 Flash Lite devuelve 404
por disponibilidad, pese a figurar en el catálogo. Evidencia adicional y estado
en `docs/status/gemini-http-400.md`. No se afirma que todos los modelos hayan
respondido correctamente ni que el problema del proveedor esté solucionado.

## Recibos

- `credential-helper-update-regression.txt`: identidad, actualización del padre,
  migración y rechazo de procesos no autorizados, con claves sintéticas.
- `macos-bundle-regression-tests.txt`: cuatro pruebas de protección, rollback y
  bloqueo concurrente; proceso real descartable, sin claves reales.
- `credential-regression-rust-tests.txt`: 42 pruebas, cero fallos.
- `credential-update-live-preservation.json`: app abierta intacta durante build.
- `credential-update-live-guards.json`: instalación/empaquetado directo bloqueados.
- `credential-update-staged-build.txt`, `credential-update-filter-build.txt`:
  TypeScript, Vite, Rust, empaquetado y firma.
- `credential-update-final-installed.json`: identidad final del proceso y helper.

No se extrajeron claves para los recibos ni se registraron cuerpos HTTP brutos.
