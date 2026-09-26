# Gemini HTTP 400 en análisis de variables

## Comprobación posterior al arreglo de credenciales — 2026-09-24

La tarea de credenciales eliminó el rechazo de firma y verificó el acceso desde
el bundle principal, tras dos actualizaciones y reinicios. El helper conserva
el hash autorizado; no apareció ningún permiso de contraseña en estas llamadas.
Eso permite separar los siguientes resultados de cualquier problema de Keychain:

- Catálogo remoto: responde correctamente con la clave guardada.
- Filtro sobre una sola columna (`tenure`, sin filas), petición
  `Show rows where tenure is at least 12.`: `gemini-3.8-flash` y
  `gemini-3.5-flash-lite` devuelven HTTP 400 con mensaje genérico
  `Request contains an invalid argument.` El cuerpo usa ya el enum
  `APPLICATION_JSON`, que coincide con la referencia oficial vigente:
  https://ai.google.dev/api/generate-content#TextResponseFormat
- `gemini-2.5-flash-lite` devuelve HTTP 404 indicando que no está disponible para
  nuevos usuarios, aunque aparece en el catálogo. No se infiere de ello que los
  modelos 3.x no estén disponibles: sus respuestas son distintas.
- `gemini-2.5-flash` devuelve una respuesta estructurada: para `greater than 12`
  explica correctamente que el contrato local solo admite límites inclusivos;
  para `at least 12`, el primer intento no pudo convertirse a `FilterProposal`.
  Se reforzó el prompt con el sobre JSON `filters`/`explanation` y los campos
  `kind`/`column`, además del esquema de la API. No se flexibilizó la validación
  de columnas, tipos, límites ni revisión del dataset.

No hay evidencia suficiente para atribuir el HTTP 400 a un campo concreto.
No se han registrado claves ni respuestas brutas, ni modificado credenciales.

Tras recompilar con el contrato JSON explícito, **Gemini 2.5 Flash devuelve en
la app principal una propuesta válida `tenure ≥ 12`**, con Apply filters activo.
La propuesta se canceló sin modificar la vista. Gemini 3.8 Flash continúa
devolviendo HTTP 400 para esa misma petición; no se declara resuelto ese rechazo.
Recibo nativo: `docs/qa/credential-update-native.md`.

Fecha: 2026-09-23. Investigación en la app macOS de desarrollo abierta, sobre `idealista_dataset.csv`. No se aplicaron propuestas ni se modificó la vista.

## Reproducción nativa

- La captura del usuario muestra «Filtrar con lenguaje natural», 41 variables, petición «pisos caros en Madrid», modelo `gemini-3.8-flash`, error `Gemini HTTP 400`.
- «Actualizar modelos disponibles» devolvió modelos para la clave configurada, incluidos `gemini-3.8-flash`, `gemini-3.7-flash` y `gemini-2.5-flash`.
- Se repitió el filtro con las mismas 41 variables y el mismo texto, usando `gemini-3.7-flash`: `Gemini HTTP 400`.
- Se probó «Clasificar» con solo la variable `PRICE` y `gemini-3.8-flash`, después con `gemini-2.5-flash`: ambas llamadas devolvieron `Gemini HTTP 400`.
- Se cerró el diálogo sin aplicar cambios. No se inspeccionó ni extrajo la clave del Llavero.

## Código y alcance del diagnóstico

`AnalysisDialog.tsx` pasa el modelo y columnas al comando nativo. `analysis_filter` y `analysis_classify` comparten `GeminiProvider::generate_json`. La solicitud se envía a `v1beta/models/{model}:generateContent` con `responseMimeType: application/json`, `responseJsonSchema`, límite de tokens y temperatura 0.2. `response_json` en `src-tauri/crates/datolens-enrichment/src/provider.rs` descarta el cuerpo completo de respuestas HTTP no exitosas y devuelve solamente `Gemini HTTP 400`.

El modelo ausente, la petición en lenguaje natural y el tamaño del esquema de 41 variables no explican por sí solos las reproducciones. La causa precisa del rechazo de Google queda **sin identificar**: podría estar en la configuración común de generación o en una condición de la cuenta/clave que la lista de modelos no comprueba. No hay base para atribuirla a un campo concreto de JSON Schema ni para afirmar que cambiar de modelo la resuelve. La documentación oficial muestra `gemini-3.8-flash` y el endpoint `generateContent`, y describe la salida estructurada: <https://ai.google.dev/gemini-api/docs/generate-content/latest-model> y <https://ai.google.dev/gemini-api/docs/generate-content/structured-output>.

## Próximo paso para cerrar la causa

`datolens-enrichment` debe mostrar solo el mensaje del error de Gemini, con longitud limitada y sin registrar encabezados, clave, prompt, dataset ni cuerpo bruto. Una sola reproducción nativa con esa instrumentación distinguirá un parámetro inválido, acceso/facturación u otra condición. Después se corrige la causa indicada por Google y se verifica de nuevo el filtro en la app real.

## Seguimiento de la corrección

`provider.rs` ya extrae un máximo de 500 caracteres imprimibles de `error.message`; la prueba unitaria correspondiente pasa. `scripts/build-macos.sh` compiló y firmó la app de desarrollo. Al intentar la petición mínima «PRICE entre 200000 y 300000» con ese binario, macOS denegó el acceso de la nueva compilación a la clave del Llavero **antes** de llamar a Gemini. Datolens mostró «No se autorizó el acceso a la clave en el Llavero». La petición original de Gemini sigue sin poderse diagnosticar a partir de ese intento. Se ha solicitado al usuario autorizar el aviso de macOS para continuar la prueba nativa; no se han modificado permisos del Llavero por código ni se ha extraído la clave.

El 24 de septiembre el usuario autorizó expresamente conceder ese acceso. Se pulsó «Check Keychain access» en la app macOS firmada, pero la operación permanece esperando al aviso de `com.apple.SecurityAgent`. La herramienta de control del ordenador rechazó controlar esa aplicación protegida («Computer Use is not allowed to use the app 'com.apple.SecurityAgent' for safety reasons»). Se pidió al usuario pulsar «Permitir siempre» directamente en el aviso. Hasta que termine esa operación, no hay respuesta HTTP nueva ni base para atribuir el 400 a un campo concreto. La documentación vigente de Gemini enumera los campos `responseMimeType`, `responseJsonSchema`, `anyOf` y `additionalProperties` usados aquí; por sí sola no identifica el motivo del rechazo.

Después, el usuario mostró otra reproducción nativa con `churn_dataset.csv`, las 21 variables, `gemini-3.8-flash` y «mejores contratos»: `Gemini HTTP 400: Request contains an invalid argument.` Esto confirma que la clave llegó a Google en esa ejecución y que el rechazo es de un argumento de `generateContent`, aunque el mensaje no señala cuál. Se cambió el cuerpo de la petición estructurada desde los campos obsoletos `responseMimeType` y `responseJsonSchema` a `generationConfig.responseFormat.text.{mimeType,schema}`, según el ejemplo REST vigente de Google. `cargo test -p datolens-enrichment response_tests --lib` pasó y `scripts/build-macos.sh` compiló y firmó el bundle. La prueba real con «tenure entre 10 y 20» está abierta en la app nueva, pero macOS volvió a mostrar una autorización protegida del Llavero antes de que terminara. La aceptación por Gemini del cuerpo actualizado queda pendiente; no se ha aplicado ningún filtro.

La referencia actual de `generateContent` especifica que `responseFormat.text.mimeType` es un **enum** cuyo valor JSON es `APPLICATION_JSON`, no la cadena MIME `application/json` usada en la primera migración. El trabajo de paletas IA corrigió ese campo en el proveedor compartido y añadió pruebas de serialización. Una llamada real desde su app macOS aislada pasó del HTTP 400 y recibió una respuesta JSON de Gemini. Esto verifica el arreglo del error de argumento en ese flujo; falta repetir el filtro en el bundle principal con el proveedor ya corregido. La primera respuesta de paletas tuvo un problema semántico distinto y no aplicó colores.

## Reproducción tras corregir el enum

En el bundle principal ya actualizado, «tenure entre 10 y 20» con las 21 variables de `churn_dataset.csv` todavía devolvió HTTP 400 con `gemini-3.8-flash` y `gemini-3.7-flash`. «Clasificar» con solo `tenure` y 3.8 también devolvió HTTP 400. Con `gemini-2.5-flash`, la misma clasificación superó HTTP y llegó a `Gemini devolvió JSON inválido`. Por tanto, corregir el enum solucionó la petición aislada de paletas, pero no la del análisis.

La [guía oficial de Gemini 3.8](https://ai.google.dev/gemini-api/docs/latest-model) pide eliminar `temperature`, `top_p` y `top_k` de la configuración. El proveedor enviaba `temperature: 0.2` a todos los modelos. Se ha cambiado para omitirlo en los modelos `gemini-3.*`, preservándolo para 2.x. Las cuatro pruebas unitarias del cuerpo y parser pasan; `scripts/build-macos.sh` compiló y firmó el bundle principal. La petición nativa de filtro está esperando la autorización de macOS para que el nuevo binario lea la clave del Llavero; no hay aún un resultado de Gemini para esta corrección. El esquema de filtros usa opciones `anyOf` y `maxItems`, campos admitidos por la [referencia oficial de salida estructurada](https://ai.google.dev/gemini-api/docs/structured-output), aunque su complejidad puede requerir otra prueba si persiste el 400. No se ha aplicado ningún filtro.

## Corrección verificada en la app principal — 2026-09-25

La omisión de parámetros de muestreo no bastaba: con `gemini-3.8-flash`, tanto
`responseFormat.text` como los campos estables `responseMimeType` y
`responseJsonSchema` seguían provocando HTTP 400 en el filtro real. Al omitir la
configuración de salida estructurada para Gemini 3 y adjuntar el mismo esquema al
prompt, la petición pasó con una sola llamada. La respuesta sigue atravesando el
parser JSON y la validación local estricta; no se relajan columnas autorizadas,
tipos, límites, revisión del dataset ni validación SQL.

Verificación nativa en `/Applications/Datolens.app`, `churn_dataset.csv`, 21
variables y `gemini-3.8-flash`:

- `mejores clientes`: Gemini devolvió `filters=[]` y explicó que faltaban una
  métrica y umbrales concretos. No se habilitó aplicar cambios.
- `tenure entre 10 y 20`: Gemini propuso `tenure ≥ 10 and ≤ 20` y habilitó
  **Apply filters**. La propuesta se canceló sin modificar el dataset.
- La suite de `datolens-enrichment` pasó completa: 28 pruebas, 0 fallos.

Gemini 2.x conserva la salida estructurada del API; el fallback mediante prompt
se limita a `gemini-3.*`. No hay reintentos ocultos ni una segunda llamada.
