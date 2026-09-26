# Credenciales: QA de la app principal — 24 de septiembre de 2026

Bundle comprobado y abierto:
`src-tauri/target/debug/bundle/macos/Datolens.app`.

- `scripts/build-macos.sh`: exit 0, frontend+Rust compilados y firma estricta
  verificada. El helper empaquetado coincide byte por byte con el independiente.
  Identidades y hashes: `credential-helper-bundle.json`.
- Se cerró la instancia anterior desde la UI y se abrió este bundle. Se
  conservaron las pestañas `churn_dataset.csv` y `NYC 311 Calls - 1.2M.csv`.
- Ajustes detectó Gemini y Jev a través del helper autenticado. Se autorizó la
  lectura inicial de cada entrada antigua desde los avisos protegidos de macOS.
  Datolens confirmó «Access ready» para ambas.
- Inspección exclusivamente de metadatos de las dos entradas nuevas: el único
  lector autorizado es `Contents/MacOS/datolens-credentials`; la única partición
  es `cdhash:51ff7572f85386aa26c090e0473d77f877109202`. No se leyeron ni guardaron
  secretos mediante el diagnóstico. Recibo: `credential-helper-live-acl.json`.
- Se salió completamente de Datolens y se volvió a abrir. Ajustes → Authorize
  access en Gemini y en Jev devolvió «Access ready» inmediatamente, sin otro
  aviso de contraseña. Esta comprobación usa un proceso nuevo y caché vacía.
- En Category colors de Churn se actualizó el catálogo real de Google; apareció
  la lista remota, incluyendo `gemini-3.8-flash`.
- Se ejecutó una llamada real `gemini-2.5-flash`, limitada al nombre Churn y los
  dos valores de categoría `false`/`true`. No se enviaron filas del dataset.
  Se obtuvieron dos propuestas de color, con `false` → `#009e73`, resumen y
  razones en inglés conforme a Settings → English. No hubo otro aviso del
  Llavero. La propuesta se canceló; no se guardaron colores de la prueba.

Resumen de Gemini observado en la UI: «Colors are assigned based on the common
business interpretation of churn as a negative outcome and no churn as a
positive outcome.» La UI indicó «2 proposed colors staged for review».

Jev se validó en lectura de credencial antes y después del reinicio, no mediante
una llamada HTTP al proveedor. La resistencia a cambios de hash del ejecutable
principal y los rechazos de procesos no autorizados se probaron con procesos
nativos firmados y credenciales sintéticas: `credential-helper-native-tests.txt`.
La reconstrucción limpia del helper conservó su hash:
`credential-helper-reproducibility.txt`.

La tarea de selectores de modelos recibió el target Cargo libre y la instrucción
de seguir usando `scripts/build-macos.sh` para mantener la identidad del helper.
