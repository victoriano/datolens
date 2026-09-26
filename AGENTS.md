# Datolens — reglas de trabajo

El usuario ha autorizado implementar el primer MVP macOS. No reabrir un proceso
de validación comercial ni pedir otra autorización para comenzar. El diseño de
referencia ya está integrado en los módulos propios del proyecto.

## Trabajo simultáneo

Hay varios threads trabajando en la misma carpeta. No estás solo. No reviertas
ni sobrescribas el trabajo de otros. Respeta la propiedad de archivos descrita
en `docs/tasks/`; acuerda cambios de contrato con el thread de integración.
No crear otros threads/agentes salvo necesidad concreta coordinada por el líder.

- Integración: configuración raíz, shell Tauri, Cargo raíz, adaptadores IPC,
  `src/contracts/`, `src/App.tsx`, entradas de app, empaquetado, integración y QA.
- Datos: `src-tauri/crates/datolens-data/` y `docs/status/data.md`.
- Explorador: `src/features/explorer/`, `src/styles/explorer.css` y
  `docs/status/explorer.md`.
- Enriquecimientos: `src-tauri/crates/datolens-enrichment/`,
  `src/features/enrichment/` y `docs/status/enrichment.md`.

No modificar repositorios externos. No crear repos remotos, commits, pushes ni
publicar sin instrucción adicional. Es posible inicializar Git para trabajo local,
pero solo después de que los threads hayan quedado vinculados al proyecto.

## Stack y ejecución

- Usar Bun para el frontend y Cargo para Rust. El coordinador gestiona las
  dependencias raíz y los lockfiles. Los workers pueden mantener el Cargo.toml
  de su crate independiente y comunicar requisitos al coordinador.
- No compilar simultáneamente en el mismo target de Cargo ni instalar dependencias
  sobre el mismo lockfile. Coordinar verificaciones o usar targets separados.
- App para el usuario y el Dock: `/Applications/Datolens.app`. Mantener esta ruta
  en todas las actualizaciones; no abrir ni anclar copias dentro de `target`.
- Bundle local: usar `scripts/build-macos.sh`. Empaqueta aparte y, si la app está
  abierta, deja la actualización pendiente. Salir de la app antes de ejecutar
  `scripts/build-macos.sh --install-pending`. Nunca copiar ni volver a firmar el
  bundle abierto: invalida su identidad en ejecución y bloquea las credenciales.
- El código de datos corre en nativo y en trabajos que no bloqueen la interfaz.
  No cargar el dataset entero en JavaScript. Paginar y proyectar columnas.
- API keys en Keychain; no en JSON, logs, prompts guardados ni fixtures.
- Datos en local salvo los campos que el usuario seleccione para enriquecimiento.
  No usar credenciales de otros proyectos para probar llamadas reales.

## Calidad y entrega

- Las verificaciones pertinentes están autorizadas como parte del MVP: compilación,
  pruebas de consultas/dependencias/persistencia y comprobación de la app real.
- Distinguir implementado, probado con fixtures y probado contra Gemini real.
- Guardar fallos y limitaciones en `docs/status/`; no marcar una entrega terminada
  por tener solo código, mocks, un build web o una captura de pantalla.
- Un fallo aislado de una celda no debe perder resultados de otras filas.
- Controles de coste y alcance para llamadas IA; nunca enviar un dataset entero
  automáticamente al abrirlo.

La falta de Rust en PATH puede requerir instalar el toolchain oficial de Rust
desde su fuente oficial. El usuario ha pedido un MVP ejecutable; el coordinador
puede preparar las dependencias normales de desarrollo necesarias, sin modificar
protecciones del sistema ni instalar software de procedencia desconocida.
