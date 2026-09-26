# Muestreo — QA nativa final, 2026-09-23

## Paquetes

- Principal: `src-tauri/target/debug/bundle/macos/Datolens.app`, binario firmado a las `2026-09-23 11:01:52 +0200`. SHA256 `0ea9296641eb1e7365d483f77a6abe3004e77adaec4196e2762e911e5f82f33f`.
- QA de la misma fuente y mismo frontend: `src-tauri/target/debug/bundle/macos/Datolens Sampling QA.app`, firmado a las `2026-09-23 11:03:31 +0200`. SHA256 `68a9bb49daab149ca98e7a5c720200be51bfb9ea0f3328ff645b24e54f82f53a`.
- QA compilado con override Tauri explícito: identifier `com.victoriano.datolens.samplingqa`, productName `Datolens Sampling QA`. No basta con cambiar Info.plist.
- Ambos pasan `codesign --verify --deep --strict`. El build QA no modifica el bundle principal generado.
- Fuente de QA: clon APFS de NYC en `/tmp/datolens-performance/NYC 311 Calls - 1.2M.csv`, para aislar también el sidecar. Sin modificar CSV ni vista de la sesión del usuario.
- `lsof` de PID 49645 confirma DuckDB en `~/Library/Application Support/com.victoriano.datolens.samplingqa/projects/ds_d3387aaf01a73ac988b84111.duckdb`; WebKit bajo identifier QA.

## Inicio

- Apertura por ruta absoluta mediante CUA. AX inicial solo tenía WebView; siguiente observación mostró bienvenida completa con botones y preferencias, captura correcta.
- Selector nativo abre copia NYC. Progreso visible: Inspecting file → Importing data into local cache, fuente 785 MB.
- Las dos instancias principales previas se preservan. Selección ambigua de CUA confirmada; no se atribuye causa definitiva a su ventana blanca. El bundle principal final todavía no se reinicia para no alterar diálogo Jev/sesión del usuario.

## Interacciones

- Importación completa: `1,123,454 of 1,123,454 rows`, `Sample · 23,000 / 1,123,454`, aviso de conteos muestreados visible. NYPD sin seleccionar: 6.539 de la muestra.
- Clic NYPD: tabla `317,766 of 1,123,454 rows`; gráfico NYPD 6.539 (100% de la selección en muestra). Filtro aplicado al dataset completo en la tabla.
- Selector: Automatic 23.000, presets 10.000/50.000/100.000/500.000/1.000.000, All rows exact, número personalizado. Preset 50.000: muestra 50.000 y NYPD 14.178.
- Personalizado 25.000: muestra 25.000 y NYPD 7.040. Sidecar leído tras acción UI confirma `analysisSampling={mode:rows,rows:25000}` y filtro NYPD.
- Cierre normal con Cmd-Q: PID QA termina. Reapertura por ruta absoluta restaura automáticamente el CSV, `25,000`, filtro NYPD, tabla exacta 317.766 y mismo conteo muestreado 7.040. No se vuelve a importar el CSV.
- All rows exact: `Exact · 1,123,454`; gráfico NYPD 317.766 igual al total filtrado de la tabla. Captura nativa revisada con datos y controles visibles.
- Retorno Auto: muestra 23.000 y NYPD 6.539, estable respecto al primer pase. Limpiar filtro: tabla vuelve a 1.123.454. Sidecar leído confirma Auto y filtros vacíos.
- Workspace comprobó `+`, cancelar y carpeta inicial sobre este mismo bundle, sin otra compilación: PASS. Segundo CSV de dos filas en una pestaña adicional; cancelar conserva estado; carpeta inicial corresponde al archivo abierto. Recibo en `docs/qa/workspace-add-tab-native.md`.
- Tras recuperar CUA, se confirmó NYC Auto 23.000 sin filtros y se cerró normalmente solo la instancia QA con Cmd-Q. Servidores propios de desarrollo/preview detenidos; tres cachés temporales de benchmark eliminadas. Sesiones principales conservadas.

No se invocó IA ni se accedió a credenciales. La QA verifica el motor y el frontend reales de Tauri, con almacenamiento y sidecar aislados. La app principal final se generó y firmó; su sesión anterior permanece abierta y no se reinició.
