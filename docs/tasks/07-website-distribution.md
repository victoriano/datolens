# Landing y distribución — 23 de septiembre de 2026

Autorización: landing pública en `datolens.victoriano.me`, descarga de Datolens
y preparación/envío a la Mac App Store, pedido explícito del usuario en esta tarea.

Propiedad de esta tarea: `website/`, `distribution/`, `docs/status/distribution.md`
y este recibo. No cambiar contratos, módulos de la app, lockfiles raíz ni trabajos
de las otras tareas. No crear repositorio remoto, commits o pushes.

La web se publica desde su directorio independiente; nunca se sube el repositorio
completo ni datasets privados. Demos con datos sintéticos identificados como tales.

Bloqueos iniciales comprobados: solo certificado local de desarrollo, sin
certificados Apple Developer ID/Distribution; App Store Connect solicita inicio
de sesión; `altool` no está instalado, sí `notarytool`. La cuenta Vercel personal
está autenticada y los NS de victoriano.me son de Cloudflare.

Resultado: landing publicada en producción, beta 0.1.0 (2) firmada y notarizada
mediante la cuenta Xcode cloud existente de `home-macbook`, PKG de App Store
firmado. La subida se detuvo porque falta la ficha en App Store Connect; se
solicitó login al titular. Estado y evidencias en `docs/status/distribution.md`.

Excepción de propiedad acordada con la tarea de integración: cambio mínimo de
`src-tauri/crates/datolens-data/src/remote.rs` para cargar httpfs incorporado a
DuckDB conservando la ruta de extensión externa. Bookmarks, IPC y exportación
los modificó integración. No se cambió otro código de su propiedad desde aquí.
