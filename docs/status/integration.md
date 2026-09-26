# Integración — ampliación del 23 de septiembre entregada

## CLI y apertura desde Finder/terminal (25 de septiembre)

La instalación real en `/Applications/Datolens.app` incluye
`datolens-cli`, asociaciones CSV/XLSX/Parquet/SAV y recepción de aperturas en
frío o en caliente. El enlace `~/.local/bin/datolens` está activo; una invocación
con CSV + Parquet abrió dos pestañas reales y dejó el Parquet activo con 1.200
filas. Ajustes muestra el estado y la orden de activación.

QA aislada con App Sandbox abrió un CSV externo de 1.200 filas, guardó un
bookmark 0600 y lo recuperó tras reiniciar sin selector. Automatización: Rust
46 PASS, frontend 121 PASS / 2332 aserciones, CLI 2 PASS y empaquetado 4 PASS.
Detalle, límites de sidecar y frontera TestFlight en `cli-file-opening.md`.

## Compatibilidad funcional con App Sandbox

Bookmarks persistentes: QA nativa confirmó reapertura sin selector y conservación
del filtro Madrid (300/1.200), con almacén privado 0600. Exportación mediante
NSSavePanel: CSV y Parquet reabiertos con exactamente 300 filas Madrid, original
intacto. La biblioteca con httpfs incorporado preparada por Distribución abrió
su muestra HTTPS en la app: 1.200 filas y 7 columnas. Recibo comprobado:
`artifacts/distribution/sandbox-functional-receipt.json`.

Alcance: App Sandbox ON, firma local de desarrollo y Hardened Runtime OFF solo
en copia QA aislada. La candidata conserva Hardened Runtime ON. No se declara
validación de distribución Apple: quedan firma Apple real, volumen externo,
Keychain bajo el perfil real y proveedores IA. Los cambios de Integración están
congelados; detalles en `sandbox-bookmarks.md` y `sandbox-export.md`.

## Fuentes remotas (23 de septiembre, 13:20 CEST)

El menú + ofrece archivo local, URL y derivación. Descarga nativa con progreso,
límite de 8 GiB y limpieza de temporales; las hojas XLSX se registran juntas.
Parquet público sin query usa rangos HTTP cuando el servidor admite Range real
y ETag fuerte, con httpfs oficial incluido y verificado. Auto aplaza perfiles;
los análisis explícitos pueden leer toda la fuente. URLs con query se descargan
a copia local para no persistir posibles credenciales.

Datos 54 PASS (2 manuales ignoradas), integración 14 PASS, frontend 49 PASS y
prueba dirigida posterior de URL firmada PASS. QA nativa aislada completa con
CSV, XLSX, Parquet 5M, fallback, persistencia y selector Finder. Evidencia:
`docs/qa/remote-final-native.md`. Principal recompilado/firmado sin reiniciar las
instancias del usuario. El último ajuste propaga un fallo de activación al
diálogo; su TypeScript/build/firma pasan, sin repetir todo el recorrido nativo.

## Recuperación del permiso del Llavero (23 de septiembre)

El estado de proveedores dice «Claves guardadas» porque la consulta de presencia
no demuestra que macOS permita leer el secreto. El panel de configuración ofrece
«Comprobar acceso al Llavero» y el error del compositor ofrece la misma acción.
Esta acción lee la clave dentro del proceso nativo, descarta el valor y no llama
a Gemini ni Jev. Si macOS deniega la lectura, la interfaz indica cómo abrir
Acceso a Llaveros con Spotlight y revisar «Control de acceso» para el servicio
`com.victoriano.datolens.providers`. El permiso debe concederlo el usuario.
`bun run check`, `cargo check --locked` y `git diff --check` pasan. Un bundle
debug posterior incluye el comando nativo y pasó `codesign --verify --deep
--strict`. La inspección CUA encontró una instancia anterior aún abierta, por
lo que la apariencia del nuevo botón en el bundle actualizado no se atribuye
a esa captura. La concesión real del permiso continúa pendiente de una acción
manual del usuario en macOS; no se hizo ninguna llamada API en esta revisión.

## Ampliación del 23 de septiembre — verificada

- Workspace integrado: varios archivos y hojas XLSX, filtros/vistas por dataset,
  consultas sobre todas las filas y resultados Parquet independientes persistentes.
  QA nativa PASS, incluido join Ana=20/Luis=NULL/Marta=15, cierre de una pestaña
  y recuperación después de reiniciar. Recibo: `docs/qa/workspace-native.md`.
- Columnas SQL locales integradas: AST validado, muestra de hasta tres filas,
  confirmación explícita y columnas vivas con dependencias. Dos creaciones y
  reapertura nativas PASS sin IA ni credenciales; recibo en `enrichment.md`.
- Significant variables y Open in Plot/alias/descripción: QA nativa PASS.
  El ajuste final conserva Unclassified al editar texto: smoke principal PASS.
- Selectores buscables: selector X, teclado, sin resultados y alcance de análisis
  verificados en nativo. Menú Columnas buscable, scroll y filtros con decimal
  exacto 300.25 también PASS en principal.
- Corregida la fecha estadística de timestamps DuckDB sin zona: se normaliza a
  UTC y se respetan offsets explícitos. La regresión reproducida en Madrid era
  `2024-01-01 00:00:00` → `31 dic 23`; tres pruebas cubren invierno/verano,
  offsets y nulos/inválidos. Se añadió normalización del offset corto +01 de
  la media temporal. Cuatro regresiones y comprobación visual final PASS.
- Suites: datos 43 PASS / 2 ignoradas, enriquecimientos 24 PASS, root/IPC 7 PASS,
  frontend 45 PASS / 1640 aserciones. TypeScript y compilación PASS.
- El fallo de parser `json_serialize_sql first argument must be VARCHAR` quedó
  corregido con CAST explícito y regresión XLSX + fórmula + join PASS.
- Bundle principal conjunto generado y firmado: 171 MiB,
  `src-tauri/target/debug/bundle/macos/Datolens.app`.
  Log: `docs/qa/workspace-derived-main-build.txt`; contiene fecha UTC y selectores.
  Cierre y apertura por ruta exacta, restauración y smokes finales PASS.
  Recibo: `docs/qa/workspace-derived-final-native.md`. App final abierta en el
  archivo previo del usuario, matt_berman_openclaw_repliers.csv (338 × 10).
  Fixture de integración cerrado; Integration QA cerrada.
- La tarjeta de fórmula pareció ausente en una captura de QA, pero Raise y scroll
  mostraron la tarjeta y confirmación completas. No se confirmó un defecto de CSS
  ni se modificó el diseño por esa observación.
- La validación IA nativa mantiene el límite de Llavero documentado en el corte
  del 22 de septiembre. Las fórmulas SQL directas no necesitan proveedores.

## Ampliación actual (22 de septiembre)

Integración es el único escritor de contratos, IPC, adaptador desktop, shell y
ExplorerApp. Las tareas existentes mantienen sus módulos; las compilaciones
Cargo comunes y los turnos de interfaz se coordinan secuencialmente.

- Aplicado `docs/patches/file-actions.patch`: icono revela el origen en Finder y
  nombre abre el selector nativo con ruta actual. QA nativa completa PASS.
- Contratos y comandos de análisis registrados: estadísticas, clasificación,
  filtros estructurados y previsualización/aplicación de tipos. Estadísticas,
  casts, Auto, grupos, arrastre y persistencia probados en la app nativa.
- MultiProvider y Keychain Gemini/Jev conectados. Comandos de propuesta y prueba
  de hasta tres filas conectados, con proyección nativa y comprobación de revisión.
- Gráficos: módulo visual, consultas, exportación y persistencia conectados;
  variables disponibles como panel lateral y filtros compartidos. Barras, filtros,
  pivot, correlación, exportación y persistencia nativos PASS. QA4 confirma
  huecos temporales sin puntos falsos, tooltip con medida derivada, placeholders
  y cabeceras CSV en inglés.
- Idiomas/temas: provider, controles, permiso nativo, localización Explorer/tabla
  y selector conectados. ES/EN × claro/oscuro, menús, reinicio y recuperación
  de la apariencia del Mac mediante Sistema nativos PASS.
- Cuatro bundles intermedios `Datolens Integration QA.app` compilados y firmados,
  identificador/almacenamiento separado `com.victoriano.datolens.integrationqa`.
- Bundle principal de la ampliación generado mediante `scripts/build-macos.sh`:
  `src-tauri/target/debug/bundle/macos/Datolens.app`, 166 MiB, firma ad hoc
  verificada con `codesign --verify --deep --strict`. DuckDB incluido por @rpath,
  sin dependencias de Homebrew/workspace. Log `docs/qa/features-build-macos.txt`.
  Instancia principal cerrada con ⌘Q y bundle final reabierto por su ruta exacta.
  Recuperó `idealista_dataset.csv`, 94.815 filas × 41 columnas, con vista y
  siete variables ocultas conservadas. Nuevos controles de gráficos, idioma,
  apariencia, estadísticas, roles y compositor visibles. Captura nativa revisada.
- File actions: QA nativa completa en `docs/qa/file-actions-native.txt`.
- Root: 6 tests PASS; datos: 28 PASS (incluye totales de gráficos), 1 benchmark
  ignorado; enriquecimiento: 22 PASS, incluyendo compatibilidad de hashes legacy.
- Frontend: 30 pruebas PASS / 1546 aserciones, incluida regresión temporal UTC
  con zona Europe/Madrid y huecos/tooltip de componentes de series.
- Enriquecimiento real desde crate: Gemini, Jev y web con fuentes pasan con
  fixtures sintéticos; evidencia en `enrichment.md`. QA4 nativa detecta las claves
  inmediatamente, pero un único intento explícito de chat queda en lectura del
  secreto del Llavero (`SecItemCopyMatching`/`SecurityServer::decrypt`), antes de
  HTTP. CUA no permite acceder a SecurityAgent; no se alteraron ACL ni protecciones.
  0 llamadas nuevas; preview/lote y las dos inferencias de análisis nativas quedan
  pendientes de autorización macOS. Evidencia `docs/qa/features-keychain-pending.txt`.
- Dos correcciones de integración: opciones por defecto no cambian los hashes
  anteriores; guardar una definición compara su tipo físico, no el cast de vista.
- Enlaces de fuentes HTTP/HTTPS pasan al navegador mediante comando nativo con
  validación de esquema. La prueba de enlaces desde iframe Google sigue pendiente.

## Entrega base verificada (anterior a esta ampliación)

Fecha: 22 de septiembre de 2026. Bundle real macOS Apple Silicon en
`src-tauri/target/debug/bundle/macos/Datolens.app`.

- Tauri/React integrados con los motores nativos de datos y enriquecimientos por
  IPC; paginación y proyección, sin dataset completo en JavaScript.
- Selector macOS, selección de hoja XLSX, eventos drop, persistencia local,
  resultados/cola SQLite, adaptador Keychain y proveedor Gemini conectados.
- DuckDB 1.5.5 oficial incluido en el bundle, checksum fijado; firma ad hoc local
  verificada. Build final mediante `scripts/build-macos.sh`.
- Verificación: TypeScript/build PASS, modelo explorador 8 PASS, integración
  Rust 2 PASS, datos 12 PASS y scheduler 12 PASS. Benchmark explícito adicional.
- Recorrido real: CSV/XLSX/Parquet, filtros cruzados, sorting múltiple, columnas,
  portapapeles con ID largo exacto, exportación/reapertura y vista tras ⌘Q/reinicio.
- CSV Idealista real 94.815×41 verificado, incluida la fila `NA` tardía y su filtro.
- Corrección posterior: enteros CSV fuera de BIGINT preservados como texto antes
  de cualquier conversión DOUBLE. Dos regresiones prueban exportación/reapertura,
  reparación transaccional de cachés y conservación de vistas/resultados.
- El paquete conjunto incluye el parche del explorador para reintentar la
  operación que falló y bloquear selección/copia por teclado durante una consulta.
  Reintento de apertura probado en macOS antes/después: reponer un fixture ausente
  y pulsar Reintentar ahora abre sus cinco filas; antes solo quitaba el error.
- Rendimiento medido con 1M CSV y 1M/5M Parquet; condiciones y cifras en QA.
- Enriquecimiento: definición/columna/plan visibles en app; cadena A→B→C,
  invalidación, fallos parciales y persistencia probados con proveedor determinista.
  **Gemini real y escritura de clave real en Keychain no probados**: no se
  introdujeron credenciales ni se hicieron llamadas facturables.

Evidencia, comandos y límites: [QA.md](../QA.md). Drag-and-drop está conectado,
pero no se registró un arrastre real desde Finder. La app es una entrega local,
sin notarización ni publicación; no se han creado commits ni repos remotos.
