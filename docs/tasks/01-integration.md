# Integración y entrega macOS

Implementa y coordina el MVP descrito en `MVP.md` hasta obtener una app Mac
funcional. Eres responsable del scaffold, infraestructura raíz, contratos,
adaptadores IPC, conexión de componentes y verificación de extremo a extremo.

Otros tres threads trabajan en datos, explorador y enriquecimientos. No estás
solo: respeta su propiedad, no sobrescribas cambios y comunícate con ellos.
Los IDs de threads se añadirán a `docs/THREADS.json`. Mientras tanto, usa recibos
en `docs/status/`. Puedes implementar stubs claros para desbloquear integración.

Propiedad: raíz, package.json/lock, config Vite/TS/Tailwind, src-tauri/Cargo.toml,
src-tauri/src (shell), configuración/capabilities Tauri, src/contracts,
src/platform, src/App.tsx y entradas de React, scripts/QA/fixtures y docs de
integración. No editar crates o features de otros sin coordinar.

Usar Tauri 2 + React/TypeScript con build estático. Vite es apropiado aquí;
no introducir servidor Next/Supabase. Bun para frontend. Instalar toolchain Rust
oficial si falta. Seleccionar versiones compatibles y fijar lockfiles.

Crear cliente `DesktopApi` tipado y registrar commands. Cargar ExplorerApp y
EnrichmentPanel mediante sus exports. Administrar diálogo de archivos, drag/drop,
Keychain, lifecycle, errores y ventanas. Inicializar Git solo después de que
los cuatro threads estén vinculados; no commits ni pushes sin petición posterior.

La entrega no es un scaffold: integrar los resultados de los workers, corregir
fallos, verificar los tres formatos y la persistencia, compilar Datolens.app y
abrir la app real en el host Mac. Ejecutar pruebas pertinentes y documentar
limitaciones. No afirmar Gemini real sin una llamada real autorizada con clave
del usuario; usar mock solo como verificación automatizada claramente indicada.

Escribir docs/status/integration.md y docs/QA.md con evidencia y la ruta del bundle.
No publicar en stores ni crear repositorios remotos.
