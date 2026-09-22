# Enriquecimientos — recibo de módulo

Estado 2026-09-22: implementado y validado con proveedor determinista. No se ha realizado ninguna llamada real a Gemini ni se han usado claves de otros productos. La integración y el recorrido de app macOS corresponden al coordinador.

## Implementado

- Crate independiente `datolens-enrichment`: SQLite WAL, versión de formato 1, definiciones y versiones previas, celdas/resultados, snapshots de entradas seleccionadas, huellas SHA-256, cola e historial.
- DAG explícito: ciclos rechazados, aristas necesarias para consumir resultados, salidas únicas, referencias `{{columnId}}` limitadas a las columnas autorizadas.
- Scope congelado en `CellKey { row_id, enrichment_id }`. Integración resuelve celdas/rangos/filas/filtrados/todo a IDs nativos. Requisitos y dependientes se expanden solamente con las opciones explícitas.
- Completar pendientes conserva éxitos vigentes; regenerar invalida descendientes. Se preservan los valores anteriores y el historial. Cambiar prompt/entradas invalida las celdas correspondientes; las respuestas antiguas se guardan como descartadas y no se materializan.
- Solo se ejecutan celdas con requisitos vigentes. Paralelismo nativo 1–8, un driver por Engine, un trabajo activo por dataset, límites de llamadas (incluidos reintentos), máximo tres intentos por celda ante HTTP 429/5xx y backoff exponencial en `run_to_completion`.
- Fallo parcial por fila, pausa/cancelación/reanudación. Abrir un almacén interrumpido convierte running→pending y ejecución running→paused. No garantiza exactly-once remoto.
- Outbox: el éxito se guarda antes de aplicar su valor a datos; un fallo de materialización pausa el trabajo, y reanudar vuelve a aplicar sin repetir proveedor.
- Gemini real con HTTPS, credencial desde `CredentialStore`, modelo configurable, respuesta JSON con esquema y validación local de número/bool/texto/categoría/fecha/lista. No hay fallback automático a mock, ni proveedor inventado «Jev». Errores HTTP no incluyen body ni claves.
- `EnrichmentPanel`: creación/edición, entradas y dependencias, inserción de referencias, configuración Keychain vía DesktopApi, alcance y plan previo, presupuesto/concurrencia, controles de ejecución, recuperación de trabajos y estados/historial de hasta 50 celdas seleccionadas. El nombre/tipo de columnas existentes se conservan por limitación actual de datos.
- `preview.html`/`preview.tsx`: fixture de interfaz explícito y aislado, sin llamadas IA ni credenciales; no importado por la entrada de producción.

## API pública para integración

`Engine::open(path, Arc<dyn DataAccess>, Arc<dyn CredentialStore>, Arc<dyn Provider>)` por dataset. Compartir Engine en Arc; no mantener el mutex de datos al invocar Engine.

- `DataAccess::dataset_revision() -> Result<String>`
- `read_inputs(row_id, columns) -> Result<InputSnapshot { revision, values: BTreeMap<String, Value> }>`: leer solo columnas fuente pedidas; revisión debe reflejar cambios relevantes de origen.
- `apply_result(row_id, column_id, value, fingerprint) -> Result<()>`: materialización idempotente por ID estable.
- `CredentialStore::key(provider) -> Result<String>`: integración implementa Llavero.
- `list_definitions`, `save_definition`, `delete_definition`, `definition_history`.
- `plan(cells, mode, include_prerequisites, include_dependents, concurrency, max_calls)`, `start`, `status`, `list_runs`, `pause`, `resume`, `cancel`.
- `tick` procesa una tanda; `run_to_completion` es el runner nativo con backoff. Si devuelve error persiste el trabajo como failed en la medida en que SQLite esté disponible.
- `cell`, `get_cells`, `history`, `invalidate_inputs(row_id, changed_columns)`.
- `GeminiProvider::new()` para producto; `MockProvider` exclusivamente para tests.

Frontend: `EnrichmentPanel({api,dataset,selectedRowIds?,selectedCells?,filters?,onDefinitionsChange?,onResultsChange?})`, exportado por `src/features/enrichment/index.ts`. Montar con `key={dataset.id}`. Carga trabajos persistidos al abrir; callbacks permiten refrescar esquema/páginas.

## Verificación observada

Comando:

```sh
/Users/victoriano/.cargo/bin/cargo test --offline --manifest-path src-tauri/crates/datolens-enrichment/Cargo.toml --target-dir /tmp/datolens-enrichment-target
```

Resultado final: **12 passed, 0 failed** (1,38 s de tests; compilación 1m45s bajo presión de disco).

Casos: cadena A→B→C y completar sin repetir éxitos; ciclos/aristas no declaradas; fallo parcial; invalidación/historial; requisitos explícitos; recuperación de proceso interrumpido; respuesta antigua en vuelo; cancelación; recuperación de materialización; presupuesto de reintentos; validación de salidas/referencias; rechazo de plan modificado o presupuesto insuficiente.

Primera compilación Rust necesitó descarga autorizada de crates. `cargo fmt` no disponible porque falta rustfmt en el toolchain mínimo; esto no impidió compilar ni pasar tests.

TypeScript: `bun run check` final **PASS (exit 0)**. La primera pasada global detectó un fixture de explorador sin tres nuevos métodos DesktopApi; comunicado y corregido por su propietario antes de la pasada final.

Prueba visual: primer intento CUA agotó tiempo (equipo bajo presión de disco). No se considera validación visual completada. El coordinador pidió evitar más sesiones UI pesadas; explorador comprueba web y el coordinador la app real. El servidor de desarrollo 1420 pertenece a otro compañero; un intento propio acabó al detectar puerto ocupado.

## Límites y tareas de integración

- Gemini está implementado, pero **no probado contra el servicio real**. Requiere clave propia configurada en la app y un lote mínimo autorizado. No presentar mock como prueba Gemini.
- La comparación de revisión y la materialización dependen de DataAccess. Una edición de fuente gestionada externamente debe cambiar su revisión o llamar `invalidate_inputs`; integración comprueba también identidad de archivo.
- La lectura del historial y listados de trabajos es local; no hay todavía paginación del historial para sesiones muy largas.
- `tick` es el primitivo sin espera; el backoff está en `run_to_completion`, que usa el shell.
- `maxOutputTokens=2048`, tres intentos máximo por celda; no se estima dinero sin conocer precios/tokens reales del modelo. No se interpreta Retry-After; sí se aplica backoff acotado a 429/5xx.
- Contrato de salida MVP por tipo; no editor de JSON Schema arbitrario.
- SQLite del scheduler y DuckDB no tienen transacción distribuida: la outbox guarda primero y materializa idempotentemente; el cierre entre ambos se recupera.
- No se ha realizado commit, push, publicación ni modificación de reference/.

Referencia primaria del proveedor: [Gemini structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output?hl=en). API usada: generateContent, header x-goog-api-key, generationConfig.responseMimeType/responseJsonSchema. La prueba real queda explícitamente pendiente.

## Dependencias

Solo el manifest del crate: serde/serde_json, rusqlite 0.32 bundled, reqwest 0.12 blocking/json/rustls-tls, sha2. Frontend sin paquetes adicionales. Lock del crate independiente generado. Cargo root, contratos y lock raíz quedan en integración.

El coordinador autorizó limpiar únicamente `/tmp/datolens-enrichment-target`; se eliminó tras guardar esta evidencia. Nuevas pruebas deben coordinarse en el target raíz sin compilación simultánea. La última lectura de disco muestra 7,5 GiB libres (también trabajaron los demás módulos en liberar sus targets).
