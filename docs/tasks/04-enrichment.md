# Enriquecimientos: Gemini, dependencias y ejecución selectiva

Propiedad exclusiva: src-tauri/crates/datolens-enrichment/,
src/features/enrichment/ y docs/status/enrichment.md. Otros threads trabajan en
datos, explorador e integración; no estás solo y no debes revertir su trabajo.

Implementa proveedor Gemini real con API key del usuario obtenida desde Keychain
mediante integración, modelo configurable, prompts con referencias a columnas y
salida estructurada validada. El otro proveedor «Jev» sigue sin identificar: crear
interfaz extensible, no inventar conector ni reemplazarlo por otro proveedor.

Motor DAG con detección de ciclos, estados por celda, entradas y prompts
versionados, dependencias explícitas y scheduling concurrente de tareas listas.
Ejecución por celda, rango, columna, selección filtrada y dataset; completar
pendientes o forzar regeneración. Congelar el alcance por IDs antes de lanzar.
Mostrar estimación de número de llamadas y límites de concurrencia. Si faltan
entradas, informar; expandir requisitos/dependientes solo según opción elegida.

Persistir éxitos/errores/historial/cola, manejar 429/5xx, cancelación y recuperación.
Evitar que respuestas antiguas sobrescriban revisiones nuevas. Marcar dependientes
desactualizados cuando cambian entradas; preservar valores previos. No prometer
exactly-once ante llamadas remotas ambiguas. Separar mock de proveedor real.

Crate Rust independiente de Tauri con interfaces para leer entradas, obtener
credencial y persistir/aplicar resultados. Acordarlas con datos/integración.
Componente React `EnrichmentPanel` exportado con props documentadas y cliente
DesktopApi; permitir configurar enriquecimientos y ejecutar alcance seleccionado.

Pruebas deterministas de dependencias, fallo parcial, invalidación y reanudación.
No realizar llamadas facturables con claves ajenas ni pedir secretos en chat.
Comunicar paquetes necesarios al coordinador; no editar lock/manifests raíz.
No commits, pushes ni publicación. Entregar recibo detallado en docs/status/.
