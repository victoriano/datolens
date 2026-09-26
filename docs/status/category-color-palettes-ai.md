# Paletas y colores semánticos — 2026-09-24

## Implementación

- El diálogo de colores ofrece cinco paletas por variable: Clásica, Tableau, Pastel, Viva y Tierra. La asignación automática actual sigue el orden de frecuencia de referencia de las categorías; al agotar la paleta vuelve a empezar. Los colores explícitos tienen prioridad y se guardan junto con la paleta en la vista. Aplicar guarda ambos borradores y Cancelar los descarta. Véase `docs/status/category-color-frequency.md` para la corrección posterior y su verificación.
- La acción de Gemini propone colores semánticos para los valores cargados que coinciden con la búsqueda del diálogo, hasta 100 por solicitud. Omite nulos, códigos vacíos, perdidos SPSS y colores personalizados salvo que se marque reemplazarlos. Hay contexto opcional, selección de modelo y actualización explícita de modelos disponibles.
- Solo salen el nombre de la variable, los valores incluidos, sus etiquetas SPSS y el contexto escrito. El backend nativo impone límites por valor, contexto y texto total (20.000 bytes), valida el tipo de columna, categorías permitidas y HEX, y comprueba la revisión del dataset antes y después de la llamada. No envía filas ni otras columnas. Claves en Keychain; no hay registros de prompts, respuestas brutas ni credenciales.
- Cada clic produce una solicitud con límite de tokens y tiempo de espera, sin reintentos automáticos. Categorías sin asociación fiable conservan la paleta. Las propuestas y sus razones se muestran en el borrador: no se guardan hasta Aplicar. Se ignoran respuestas tardías si se cierra el diálogo o cambia el dataset.
- Corregido el formato común de Gemini: `TextResponseFormat.mimeType` usa el enum `APPLICATION_JSON`, según la [referencia oficial](https://ai.google.dev/api/generate-content#TextResponseFormat). La llamada con búsqueda web mantiene su formato de evidencia y fuentes sin esquema restringido.

## Verificación

- Frontend: **86 pruebas, 0 fallos, 2.062 aserciones**. `docs/qa/category-palettes-ai-frontend-tests.txt`.
- Comando nativo: **7 pruebas, 0 fallos** sobre límites, alcance de etiquetas, formatos inválidos, respuestas parciales, diagnósticos sin datos y revisiones obsoletas. `docs/qa/category-palettes-ai-native-tests.txt`.
- Proveedor: **4 pruebas, 0 fallos**, incluido el cuerpo de la petición estructurada y la rama con búsqueda. `docs/qa/category-palettes-ai-provider-tests.txt`.
- TypeScript, Vite y compilación Tauri correctos. Bundle QA aislado y firmado: `/tmp/datolens-chart-qa-target/debug/bundle/macos/Datolens Colors QA.app`.
- QA nativa con `/tmp/datolens-semantic-colors-qa.csv` (100 filas sintéticas): Cancelar descarta la paleta provisional; Tierra se guarda en el sidecar y vuelve seleccionada tras reiniciar.
- La primera llamada real superó el antiguo HTTP 400 pero fue rechazada por estructura de respuesta inválida, sin modificar colores. Se hizo explícito el sobre JSON esperado en el prompt y se añadieron diagnósticos de estructura sin exponer el contenido.
- **Gemini real verificado en UI nativa**, tras completarse la autorización del Llavero: `gemini-2.5-flash` recibió cinco categorías sintéticas y propuso Coca-Cola `#e60000`, Greenpeace `#008000`, Partido Popular `#0066cc` y Spotify `#1db954`. `Zyxqv 482` conservó la paleta sin asignación explícita. Se revisaron las razones antes de Aplicar; cambiar de Tierra a Pastel conservó el azul del Partido Popular. Tras Aplicar, gráfica y tabla mostraron los cuatro colores y el sidecar guardó los HEX junto con la paleta Pastel.
- Se cerró y reabrió la QA: el modal restauró Pastel y Coca-Cola `#e60000`, con los cuatro colores personalizados excluidos de nuevas solicitudes por defecto (1 valor restante). QA cerrada al terminar, sin solicitudes pendientes.

## Activación principal

- Principal instalada, firmada y verificada con `codesign --verify --deep --strict`: `src-tauri/target/debug/bundle/macos/Datolens.app`. SHA-256 final `54c4292a576e0346ca78b01b91b59dc705e0f146461b617c0661b8fec8777d9d`, PID 27680 al comprobarla.
- Al reiniciar se restauraron `churn_dataset.csv` y `NYC 311 Calls - 1.2M.csv`. En NYC311 se abrió el modal de `agency_name`: cinco paletas y controles de IA visibles, ámbito de 71 valores. Se cerró sin guardar cambios ni enviar esos datos a Gemini.
- Se coordinó con la tarea del fallo HTTP 400. Hubo una carrera entre su build principal y el intercambio del staging: la firma y el hash final se verificaron después de ambos. El binario final contiene tanto `APPLICATION_JSON` como el prompt y los diagnósticos nuevos del módulo de colores. No quedaron builds activos.
- Backup anterior conservado en `src-tauri/target/category-palettes-ai-backup/Datolens.app`; compilaciones y recibo en `docs/qa/category-palettes-ai-*`. Sin commits ni publicación.
