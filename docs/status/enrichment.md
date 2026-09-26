# Enriquecimientos — recibo de módulo

## Columnas calculadas con DuckDB — 2026-09-23

Implementado y probado con fixtures y en el bundle nativo Integration QA. Preview, confirmación, segunda fórmula independiente y reapertura verificados el 2026-09-23.

- El mismo compositor distingue una propuesta IA de una fórmula local. El planificador prefiere SQL para operaciones deterministas: cocientes, porcentajes, reglas CASE, texto, fechas y condiciones. Sigue proponiendo Jev para juicios semánticos y Gemini para generación/información externa. El diseño en lenguaje natural usa una llamada Gemini con nombres/tipos de columnas; no envía registros.
- Entrada directa `SQL: price / NULLIF(area, 0)`, sin leer claves ni llamar a ningún proveedor. El botón «Escribir una fórmula SQL» prepara ese modo. Una nueva columna obtiene un nombre por defecto libre y una identidad independiente de las ya creadas.
- La propuesta de fórmula muestra nombre y SQL editables, hasta tres ejemplos reales locales y un botón explícito «Crear columna». El preview se actualiza al editar. Cambiar expresión, nombre, selección o esquema deshabilita inmediatamente la confirmación anterior. No se escribe una definición hasta confirmar.
- La columna abarca todo el archivo, aunque la muestra respete selección/filtros; la UI lo indica. Es una vista viva nativa de DuckDB, sin trabajo IA por fila ni transferencia del dataset a JavaScript. Se recalcula cuando cambian sus entradas. Los errores de cálculo y resultados numéricos no finitos quedan NULL sin perder las demás filas.
- No es una muestra congelada: una celda IA que cambie entre preview y confirmación puede cambiar el resultado. El fingerprint verifica en nativo fórmula, esquema, tipos, definiciones y revisión; no congela valores de celdas. Esta semántica está indicada en la UI. Añadir una proyección no invalida resultados IA ajenos.
- Seguridad de ejecución: parser nativo `json_serialize_sql(CAST(? AS VARCHAR))`, una sola expresión escalar y lista de funciones permitidas. Se rechazan SELECT/FROM, subconsultas, ventanas, agregaciones, parámetros, columnas desconocidas y funciones de archivos/red/extensiones/estado/azar. Validación al proponer, previsualizar, crear y reabrir; no se confía en SQL del modelo ni en el preview enviado por el cliente.
- Fórmulas y esquema de resultados se guardan en el sidecar. Se reconstruyen en orden y solo pueden depender de columnas anteriores: referencias a sí mismas/ciclos se rechazan. Tabla, perfiles, filtros, gráficos y exportación leen `dl_data`, que incluye las derivadas. Export/joins reciben sus valores calculados como una instantánea; no heredan fórmulas con referencias al dataset de origen.
- Al reabrir desde otra caché se restaura primero el esquema de entradas IA; sus valores no presentes siguen vacíos hasta generarse. Casts incompatibles con una fórmula dependiente fallan y restauran el estado anterior.

Contrato nuevo en `src/contracts/derived-columns.ts`: `suggestColumn`, `previewDerivedColumn`, `createDerivedColumn`. Se mantienen las APIs anteriores. Los tres comandos usan `spawn_blocking`; los campos privados de `DataStore` permanecen privados. La UI reutiliza `onResultsChange → onDataChanged`; no se modificó ExplorerApp.

Verificación: `bun run check` PASS; crate de enriquecimiento **24/24 PASS**; crate de datos completo **43 PASS, 2 ignoradas existentes**, incluidos ocho tests nuevos de derivadas y seis de workspace. Las regresiones cubren preview sin escrituras, filas fuera de la muestra, NULL/división por cero, tipado, cadena de fórmulas, export/reapertura con caché nueva, entradas IA 4→7 con resultado 8→14, confirmación caducada, casts con rollback y sidecar manipulado. Workspace verificó dos hojas Excel + derivada + JOIN (valor 24). No se han hecho nuevas llamadas API ni lecturas de claves para esta entrega. La ruta de lenguaje natural ampliada se verificó con respuestas estructuradas de prueba; no se presenta como prueba contra Gemini real.

Recorrido nativo con `src-tauri/crates/datolens-enrichment/tests/fixtures/derived-examples.csv` (cuatro filas), en `com.victoriano.datolens.integrationqa`:

- `SQL: price / NULLIF(area, 0)` mostró tres ejemplos locales: 2000, 3000 y vacío. La tabla conservó sus cuatro columnas antes de confirmar.
- Tras pulsar el botón visible «Create column», aparecieron cinco columnas y los cuatro valores 2000, 3000, NULL y 2000, incluida la fila que no estaba en el preview.
- «Create another column» + `SQL: area * 2` propuso el nombre libre `Columna calculada 2`. Preview 100, 160 y 0; al confirmar, seis columnas y valores 100, 160, 0 y 80. La primera fórmula permaneció intacta.
- Tras cerrar y reabrir la QA, se restauraron las pestañas y ambas columnas con todos sus valores. La captura final mostró las seis columnas completas. La tarjeta de propuesta es desplazable y su confirmación quedó visible; no fue necesario modificar CSS después del bundle.
- Cero llamadas API y cero lecturas de secretos en este recorrido. La QA quedó abierta y CUA se devolvió a integración.

Sin dependencias nuevas, commits ni publicación. El enrutamiento nuevo desde lenguaje natural sigue probado con fixtures, no con una nueva llamada real a Gemini.

## Estado previo de IA

Estado 2026-09-22: Jev y Gemini implementados y probados contra sus APIs reales con datos sintéticos. Chat, selección de proveedor y muestra de hasta tres filas integrados. QA4 nativa confirma que el panel detecta ambas claves sin bloquearse. El único intento explícito de chat en primer plano sigue esperando autorización del Llavero antes de llamar a Gemini. El recorrido nativo completo permanece pendiente de esa autorización; el replay web no se presenta como sustituto.

## Entrega actual

- `MultiProvider` selecciona Jev o Gemini. Gemini configura una columna a partir de la petición, los nombres/tipos de columnas y, si existe, la propuesta anterior. No lee registros para diseñarla.
- Jev usa `POST https://api.typesafe.ai/v1/systemone`, `state` con las entradas seleccionadas y preguntas tipadas: Choice (categoría cerrada), Score (0 a niveles−1, admite fracciones) o Noul (probabilidad 0–1 o booleano con umbral). No se le atribuyen búsqueda web ni generación libre.
- Gemini 3.8 Flash es el valor por defecto para nuevas propuestas, extracción y generación; con Google Search investiga hechos externos. Las definiciones guardadas conservan su modelo. El cambio evita la restricción de 2.5 para nuevos usuarios anunciada en la documentación de Google del 22 de septiembre. La prueba real histórica de extracción/chat usó 2.5 con éxito; 3.8 se probó contra web, sin repetir llamadas reales por el cambio de default. El enrutamiento es explícito por capacidad y el usuario puede modificarlo antes de probar.
- El compositor transforma una petición en nombre, instrucciones, entradas y modelo; muestra hasta tres resultados reales, errores aislados, confianza/probabilidad Jev y fuentes Gemini. Aceptar guarda la definición y prepara un plan; no inicia el lote.
- La muestra es nativa, limitada a tres filas, 128 columnas y 64 KB de entradas por fila, sin guardar definiciones/resultados/historial ni modificar datos. Respeta selección/filtros. Las respuestas cuyas entradas cambian se descartan.
- Las claves de Jev y Gemini se obtuvieron de 1Password por instrucción explícita del usuario y se guardaron en el Llavero de Datolens. Ninguna clave está en archivos, argumentos del proceso, fixtures o logs. Los ejemplos CLI leen referencias a secretos desde variables de entorno, no secretos literales.
- Procedencia por celda: proveedor, modelo real, confianza/probabilidad y fuentes; persiste junto al resultado y al historial. Las sugerencias de búsqueda se muestran en un iframe sin scripts ni acceso al documento principal.
- UI en `src/features/enrichment/`: chat compacto, ajuste progresivo de opciones, muestra de entradas/resultados y revisión de alcance. La tarea de preferencias posee el pase de traducción ES/EN y tema claro/oscuro sobre estos componentes.

## Motor y persistencia

- SQLite WAL, definiciones/versiones, celdas, snapshots proyectados, huellas SHA-256, cola e historial. Opciones/evidencia nuevas con valores por defecto al abrir definiciones antiguas. Las opciones por defecto se omiten al serializar para preservar exactamente las huellas anteriores: test con definición sin options, hash anterior y resultado persistido confirma 0 llamadas pendientes tras reabrir.
- DAG explícito: rechaza ciclos, aristas no declaradas, salidas duplicadas y referencias a entradas no seleccionadas. Los requisitos y dependientes se incluyen solamente con las opciones explícitas.
- Scope congelado por `CellKey`. Completar pendientes conserva éxitos vigentes; regenerar invalida descendientes y conserva historial. Una respuesta de una definición anterior no se aplica.
- Paralelismo nativo 1–8, un driver por Engine, trabajo activo por dataset y límite de llamadas que incluye reintentos. Hasta tres intentos por celda ante 429/5xx, con backoff en `run_to_completion`.
- Fallos aislados por fila, pausa/cancelación/reanudación y recuperación tras cierre. Outbox: persiste éxito antes de materializar; recuperar una materialización fallida no repite la llamada IA. No ofrece exactly-once remoto.
- HTTPS con timeout de 60 segundos; errores sin cuerpo remoto ni credenciales. Salidas tipadas y validadas localmente. No hay fallback a mocks en producción.

## Pruebas reales observadas

Suite explícita `examples/live_examples.rs --live`: ocho solicitudes como máximo, todas sobre descripciones sintéticas y una entidad pública. El archivo conserva el fallo web inicial para no ocultar el diagnóstico.

| Entrada | Jev real | Gemini real, habitaciones |
| --- | --- | --- |
| Piso de 3 habitaciones con ascensor en Barcelona | Piso | 3 |
| Casa unifamiliar de 4 habitaciones con jardín en Sevilla | Casa | 4 |
| Estudio de 1 habitación en Madrid | Otro | 1 |

- Jev devolvió el modelo `jev-1.13.0`; su confianza reportada fue 1 en estos tres ejemplos. No es una garantía general de exactitud.
- Gemini 2.5 Flash extrajo 3, 4 y 1. El chat real propuso Jev Choice para clasificar las viviendas.
- Gemini 3.8 Flash verificó «Museo del Prado, Madrid, España»: horario dominical 10:00–19:00, con dos referencias devueltas de `museodelprado.es` y sugerencias de Google. Evidencia en `tests/live-web-2026-09-22.json`; suite inicial en `tests/live-results-2026-09-22.json`, dentro del crate.
- Problema detectado y corregido: la respuesta exclusivamente JSON podía no incluir `groundingChunks`, incluso quitando el schema de la API. La llamada web ahora pide una explicación breve citada y un único bloque JSON final, analizado estrictamente. Es una sola solicitud por fila, sin segunda llamada oculta. Si faltan fuentes o no hay valor verificable, la fila conserva un error y no se aplica la respuesta.
- La prueba demuestra esos ejemplos, no una evaluación de precisión general. Jev Score/Noul están verificados con fixtures; las llamadas reales de Jev cubren Choice.

CSV para repetir el recorrido en la app: `src-tauri/crates/datolens-enrichment/tests/fixtures/enrichment-examples.csv`.

## Verificación técnica y visual

Comando del crate, en target propio para no competir con la integración:

```sh
CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_DEV_INCREMENTAL=false \
  /Users/victoriano/.cargo/bin/cargo test --offline \
  --manifest-path src-tauri/crates/datolens-enrichment/Cargo.toml \
  --target-dir /tmp/datolens-enrichment-v2
```

22 pruebas pasadas, 0 fallos. Se corrigió un conflicto del helper de pruebas: dos SQLite temporales podían compartir PID+timestamp bajo ejecución paralela; ahora añade un contador atómico. El defecto estaba en el aislamiento de tests, sin cambio del scheduler de producto. Cubren DAG, scope, presupuesto, fallos parciales, cancelación, entradas que cambian, outbox, recuperación, tipos Jev, enrutamiento, propuestas con columnas inventadas, muestra sin escrituras y procedencia conservada tras reinicio/regeneración.

TypeScript: `bun run check` PASS tras los estados de carga y el cambio de defaults a Gemini 3.8. La tarea de preferencias confirmó también TS PASS con las traducciones ES/EN y temas en los tres componentes de enriquecimiento.

Replay web controlado con CUA: petición → propuesta Jev → tres valores grabados de la API → guardar → plan de tres celdas, sin autoejecución. Banner explícito «REPLAY DE PRUEBA · respuestas reales guardadas, sin llamadas». Inspección visual del estado inicial y de los resultados; no sustituye el recorrido nativo pendiente.

En macOS se detectó que hasProviderKey leía la contraseña: sample del proceso confirmó SecItemCopyMatching → SecKeychainItemCopyContent → SecurityServer::decrypt bloqueado mientras SecurityAgent esperaba autorización. Las claves existen y la consulta moderna desde el proceso que las guardó devuelve OSStatus 0. Integración corrigió hasProviderKey para consultar solo atributos, sin leer la contraseña, y diferenció ausencia de clave de denegación del Llavero. El panel separa carga local de consulta de claves y desactiva acciones IA mientras muestra «Comprobando claves…» (ES/EN).

Repetición nativa final en Integration QA4, con CUA exclusiva y ventana elevada a primer plano:

- Abierto `enrichment-examples.csv`; tres filas seleccionadas. El panel mostró `Connected` inmediatamente: comprobación de existencia de ambas claves PASS.
- Petición completa verificada en el campo: «Crea una columna llamada Tipo de vivienda. Clasifica description en Piso (piso o apartamento convencional), Casa (casa unifamiliar) u Otro (incluye estudios).» Un solo clic en `Design column`.
- El panel quedó en `Designing your column…`. Un sample del PID 13772 confirmó `suggest_enrichment → CredentialStore::key → SecItemCopyMatching → SecKeychainItemCopyContent → SecurityServer::decrypt → mach_msg`, antes de la solicitud HTTP. Evidencia local: `/tmp/datolens-qa4-enrichment-keychain.txt`.
- CUA rechazó acceder a `com.apple.SecurityAgent` por seguridad. No se intentó otra vía para interactuar con el diálogo, no se repitió el clic y no se cambiaron ACL ni protecciones. Es necesaria la autorización manual de macOS para completar la comprobación.
- Cero llamadas API nuevas en este recorrido hasta el diagnóstico. No se obtuvo propuesta nativa, no se ejecutó preview ni lote. CUA y la app se devolvieron a integración sin cerrarla ni reiniciarla; integración gestiona el bundle principal.

## API para integración

`Engine::open(path, Arc<dyn DataAccess>, Arc<dyn CredentialStore>, Arc<dyn Provider>)` por dataset. Compartir Engine en Arc y no mantener mutex de datos durante las llamadas de Engine.

- `DataAccess::{dataset_revision, read_inputs, apply_result}`: IDs estables, proyección de las entradas seleccionadas, revisión coherente y materialización idempotente.
- `CredentialStore::key(provider)`; producción usa Llavero, proveedores admitidos `gemini`/`jev`.
- `list_definitions`, `save_definition`, `delete_definition`, `definition_history`.
- `suggest(SuggestRequest) -> EnrichmentProposal` y `preview(&Definition, &[row_id]) -> PreviewResult`.
- `plan`, `start`, `status`, `list_runs`, `pause`, `resume`, `cancel`, `tick`, `run_to_completion`.
- `cell`, `get_cells`, `history`, `invalidate_inputs`.
- `GeminiProvider::generate_json(model,prompt,schema,credentials,max_output_tokens)` disponible para la tarea de análisis: 1–8192 tokens, sin búsqueda web ni reintentos ocultos.

Frontend: `EnrichmentPanel({api,dataset,selectedRowIds?,selectedCells?,filters?,onDefinitionsChange?,onResultsChange?})`, montar con `key={dataset.id}`. IPC y contratos compartidos son propiedad de integración; el wrapper `enrichment_preview.rs` proyecta esquema, resuelve tres IDs y verifica origen/revisión.

## Límites

- Máximo 4096 tokens de salida por llamada de enriquecimiento; no se calcula un importe monetario sin precios y uso real. Google Search puede cobrar búsquedas adicionales a la generación.
- La muestra no se convierte automáticamente en resultado definitivo: ejecutar el lote vuelve a llamar al proveedor para esas filas.
- La revisión de origen/materialización depende de DataAccess y del wrapper de integración. SQLite y DuckDB no tienen transacción distribuida; se usa outbox.
- Historial local todavía sin paginación para sesiones muy largas. Schema de salida por tipos MVP, no editor JSON Schema arbitrario.
- Una respuesta web sin fuentes o un timeout puede fallar; el usuario lo ve por fila. Los enlaces de Google son los devueltos por grounding y pueden ser redirects.
- No se realizaron commits, pushes, publicación ni modificaciones de repositorios externos.

Fuentes oficiales: [Disponibilidad de modelos Gemini](https://ai.google.dev/gemini-api/docs/deprecations), [TypeSafe API](https://docs.typesafe.ai/api), [TypeSafe modelos](https://docs.typesafe.ai/models), [Gemini Google Search](https://ai.google.dev/gemini-api/docs/generate-content/google-search), [Gemini structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output).
