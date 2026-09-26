# Varios datasets, hojas y consultas SQL

Estado: implementación integrada y verificada en la app macOS real de QA (`com.victoriano.datolens.integrationqa`). La publicación del bundle principal queda coordinada por Integración.

## Comportamiento

- Abrir otro archivo añade una pestaña. Cambiar de tabla conserva su vista mediante la cola de guardado y el sidecar existentes.
- XLSX muestra todas sus hojas como pestañas; se cargan al visitarlas o seleccionarlas en una consulta. Las hojas tienen vistas e IDs independientes.
- Se recuerdan las pestañas y la activa en almacenamiento local; al reiniciar solo se carga la activa. Cerrar una pestaña no borra el archivo ni cancela enriquecimientos en curso.
- «Consulta SQL» muestra alias `t1`, `t2`, etc., las columnas reales y permite seleccionar las fuentes. Acepta SELECT/WITH y JOIN. El ejemplo se puede regenerar con los nombres de columnas leídos.
- Las consultas incluyen todas las filas y valores actuales (casts, enriquecimientos y derivadas); no aplican los filtros visuales. Las fórmulas originales no se trasladan al nuevo dataset: se materializa su valor actual.
- Cada resultado es un Parquet independiente en Application Support/projects/query-results, junto con `query.json` de procedencia. Se abre automáticamente en una nueva pestaña, se puede explorar, consultar de nuevo y exportar usando las acciones existentes.
- Preparación, exportación de fuentes y SQL corren en el motor nativo; no se pasa el dataset entero a JavaScript.

## Ejecución y límites

- Hasta 32 fuentes seleccionadas, consulta de hasta 100.000 bytes, resultado máximo 1.000.000 de filas. Si se excede el límite, se informa y no se publica un resultado parcial.
- Conexión DuckDB temporal en disco, 512 MB y dos hilos. Snapshots Parquet de las fuentes seleccionadas; tablas materializadas para ejecutar sin acceso externo.
- Antes del SQL: `enable_external_access=false`, extensiones automáticas desactivadas y configuración bloqueada. Consulta incrustada en subquery tabular; se rechaza cualquier separador `;` interno incluso dentro de un literal. Se admiten separadores al final.
- Timeout de 30 segundos para SQL con interrupt y espera del watchdog. Preparar snapshots y copiar el resultado están fuera de ese plazo. No hay cancelación manual durante preparación/ejecución en esta primera versión.
- Al terminar la conexión aislada, otra conexión ejecuta exclusivamente COPY generado por el host a una ruta interna. No vuelve a ejecutar el SQL del usuario con acceso al sistema.
- Los archivos temporales se eliminan al terminar o fallar. Las fuentes permanecen intactas.

## Verificación

- TypeScript global: PASS.
- Modelo frontend: 2 tests, 7 aserciones PASS (hojas, deduplicación y columnas con comillas).
- Motor nativo: joins con ID >2^53, NULL, reapertura; bloqueo de archivos/red/config/múltiples sentencias y funciones indirectas; timeout real; límite de filas y vacío: PASS.
- Integración de servicio: registro de dataset resultado, procedencia, reapertura y protección de nombres/rutas: PASS.
- Test conjunto XLSX + columna derivada: PASS tras corrección de `json_serialize_sql` por su propietario. Dos hojas se abren independientemente; la fórmula `total * 2` se exporta y llega al JOIN con el valor 24. Suite final del motor: 6 PASS.
- Logs: `docs/qa/workspace-data-tests.txt`, `docs/qa/workspace-service-tests.txt`.
- Bundle conjunto de QA compilado y firmado por Integración. Recorrido nativo PASS: dos CSV, filtros por dataset, dos hojas XLSX, JOIN agregado 20/NULL/15 en nuevo Parquet, cierre de pestaña y reinicio recuperando pestañas/vistas/resultado. Evidencia: `docs/qa/workspace-native.md`.

## Actualización 2026-09-23: consultas en lenguaje natural

- «Crear dataset» abre primero una descripción en lenguaje natural. Gemini prepara una propuesta con explicación; el usuario crea el dataset explícitamente. «Ver y editar SQL» queda plegado y permite ajustar la consulta. También se puede escribir SQL sin IA ni clave.
- Detecta la clave Gemini existente y ofrece añadirla mediante el Keychain del sistema. Modelo configurable y listado de modelos bajo acción explícita. Este flujo usa Gemini; no añade otros proveedores.
- El planificador envía descripción, SQL anterior y esquema seleccionado, sin filas, rutas ni IDs internos. Comprueba cambios de esquema/revisión y valida SELECT/WITH contra tablas vacías antes de entregar la propuesta. La ejecución mantiene el sandbox anterior.
- Cambiar petición, modelo o tablas invalida la propuesta para evitar ejecutar SQL desactualizada.
- TypeScript, prueba nativa de privacidad/binding y build firmado PASS. UI simulada verificada incluyendo ausencia de clave, propuesta plegada, invalidación y ejecución de SQL editada. App principal reiniciada: lenguaje natural por defecto, clave detectada y alternativa manual PASS; pestañas y filtro preservados.
- No se hizo una llamada real a Gemini ni se guardaron credenciales reales durante este corte. Evidencia detallada: `docs/qa/workspace-natural-native.md`.

## Actualización 2026-09-23: selector de modelos

- Al detectar una clave Gemini, el diálogo consulta automáticamente los modelos Flash disponibles para esa clave y llena el selector; «Actualizar modelos» permite repetir la consulta. El modelo predeterminado solo se conserva cuando aún no se recibió una lista utilizable.
- El selector indica que genera SQL con Gemini y explica por qué los modelos de Jev no aparecen: la integración actual de Jev clasifica, puntúa y decide mediante respuestas cerradas; el planificador SQL usa generación de JSON libre de Gemini.
- TypeScript y build macOS firmado PASS. Fixture de UI confirmó aparición automática de tres modelos simulados, incluidas dos versiones anteriores, y explicación de Jev. No se leyó la clave real ni se consultó el catálogo real en esta prueba.

## Actualización 2026-09-23: añadir otra hoja o dataset

- Botón «+» después de las pestañas existentes: abre el selector de archivos y registra el archivo elegido mediante el flujo normal. Si es XLSX, aparecen sus hojas como pestañas; al cancelar no cambia la vista.
- El selector utiliza como ubicación inicial el último archivo abierto, incluida la última hoja XLSX. Se recuerda la ruta por separado para conservarla al cerrar todas las pestañas y al reiniciar.
- TypeScript y build macOS firmado PASS. En una app nativa de QA aislada se abrió un segundo CSV desde «+», apareció junto al primero con sus dos filas, y Finder arrancó después en la carpeta de ese segundo archivo. Cancelar conservó las pestañas; al cerrar el CSV de prueba volvió el dataset anterior con su muestra y el selector volvió a su carpeta. Evidencia: `docs/qa/workspace-add-tab-native.md`.

## Actualización 2026-09-23: selección inicial de fuentes

- «Crear dataset» inicia con todas las tablas y hojas abiertas seleccionadas. El usuario puede desmarcar cualquiera antes de preparar o ejecutar la consulta. Se mantiene el máximo existente de 32 fuentes por consulta.
- TypeScript PASS; bundles macOS principal y QA aislado compilados y firmados. En la app nativa, dos CSV abiertos aparecieron seleccionados al entrar en «Crear dataset»; desmarcar uno redujo el contador a uno y reabrir el diálogo volvió a seleccionar ambos. Evidencia: `docs/qa/workspace-default-all-native.md`.

## Actualización 2026-09-23: añadir datasets desde archivo, URL o derivación

- El «+» abre un menú con archivo del Mac, URL remota y derivación de los datasets abiertos. El menú está disponible incluso sin pestañas; la derivación aparece cuando existe al menos una fuente. La tercera opción abre el diálogo de consulta en lenguaje natural.
- La URL se importa en nativo, con progreso y apertura automática de la pestaña. CSV, XLSX y SAV se descargan a la caché local; XLSX registra todas las hojas. Parquet con soporte de rangos se consulta de forma remota y deja en pausa los gráficos automáticos para evitar leer el archivo entero al abrirlo. Una selección explícita de muestra o «Todas» inicia ese análisis. Si el servidor no admite la ruta parcial, se descarga el Parquet completo, con límite de 8 GiB.
- La ruta remota ni su copia en caché sustituyen la última carpeta local usada por Finder; tampoco se ofrece «Mostrar en Finder» para un Parquet remoto sin archivo local. Una URL Parquet con parámetros se descarga a copia local para no persistir posibles tokens firmados. `bun run check`, test nativo dirigido, builds firmados y recorrido nativo aislado: PASS. Evidencia: `docs/qa/remote-final-native.md`.
