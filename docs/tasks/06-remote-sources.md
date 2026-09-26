# Fuentes remotas — coordinación

Petición: el botón + permite archivo local, URL y dataset derivado. Parquet usa
rangos HTTP cuando es posible; otros formatos se descargan nativamente.

- Workspace (01a0ccff): menú, diálogo URL, ExplorerApp, progreso, persistencia
  de pestañas y aviso de perfiles remotos diferidos. Sin modificaciones del motor.
- Datos/Rendimiento (01a0cd63): DataStore remoto, httpfs oficial fijado y sus
  pruebas Range/identidad/consulta/sidecar; vendor/httpfs y documentación.
- Integración (01a0c872): DesktopApi, adaptador, remote_sources.rs, registro IPC,
  AppService, recursos Tauri y empaquetado. Descarga local con temporales,
  límite de 8 GiB y progreso; pruebas HTTP locales. No cuerpos en JavaScript.

Contrato definitivo: `importDatasetUrl(url,onProgress?) -> Dataset|null`.
`openDataset({path:URL})` usa el mismo flujo para reabrir fuentes Parquet remotas.
Dataset sourcePath es URL en rango y ruta local para descargas completas.
Evento dataset-open-progress/requestId; fase download con receivedBytes/totalBytes.
Data API: `open_remote_parquet_with_progress(url,storage,httpfs_path,progress)`.
`Error::RemoteDownloadRequired` solicita fallback completo; los errores de
identidad/fuente cambiada fallan, no se ocultan como una nueva descarga.

Auto remoto devuelve deferredReason=remote_source sin reservoir inicial; la UI
informa y permite tamaño manual/Todo explícito. Un filtro exacto o un perfil
manual puede leer columnas enteras. El tamaño de los row groups determina el
mínimo físico; no se garantiza un porcentaje fijo descargado.

Cargo: primero datos, luego tests root y build conjunto con fuente congelada.
CUA: un owner a la vez. Usar QA con configuración Tauri/almacenamiento separados;
no tocar las instancias principales con sesión Jev del usuario.

Motor congelado: 54 pruebas PASS y 2 manuales preexistentes ignoradas. Integración
nativa: 14 pruebas PASS, incluidas descarga CSV/reapertura/enteros grandes,
fallback Parquet sin Range, límite en streaming, limpieza parcial, validación de
URL y errores HTTP sin exponer parámetros. Logs en docs/qa/remote-*-tests.txt.

Entregado: TypeScript y frontend (49 pruebas) PASS, bundles principal y Remote
QA firmados, recorrido nativo CSV/XLSX/Parquet Range/fallback/reinicio/Finder
PASS. Evidencia y límites: docs/qa/remote-final-native.md. Workspace asumió
temporalmente empaquetado/QA mientras una llamada CUA de Integración estaba
pendiente. No hay Cargo ni CUA en uso por estas tareas.

El host descarga localmente cualquier URL con query para evitar persistir
posibles tokens, incluso si el servidor admite Range. Último build principal
posterior a la QA incluye la propagación del error de activación: TypeScript,
build y firma PASS; no se repitió el recorrido nativo completo por ese ajuste.
