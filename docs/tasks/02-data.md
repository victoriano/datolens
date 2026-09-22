# Motor local de datos y persistencia

Implementa `src-tauri/crates/datolens-data/` como crate Rust independiente de
Tauri. Lee AGENTS.md, MVP.md, ARCHITECTURE.md y el contrato DesktopApi. No estás
solo: no reviertas cambios de otros y coordina con integración las interfaces.

Responsabilidad: apertura/inspección CSV/XLSX/Parquet, catálogo de columnas,
identidad estable de filas, páginas con proyección, filtros y sorting global,
conteos, perfiles/distribuciones, exportación y persistencia local del proyecto.
Gestiona importación progresiva, datos mayores que RAM y errores recuperables.
DuckDB nativo; XLSX con extensión incluida o lector Rust compatible, sin depender
de instalaciones arbitrarias descargadas en la máquina del usuario final.

Reutiliza la semántica SQL ya documentada. Añade pruebas con fixtures
que comparen filtros/gráficos/tabla y sorting multicolumna con resultados esperados.
Guardar metadatos con escritura atómica y restaurar de forma validada. Proporcionar
operaciones para leer valores y aplicar resultados por IDs para el enriquecedor.

Tu crate puede desarrollar APIs internas antes del scaffold. Declara dependencias
en su Cargo.toml; informa a integración para enlazarlo. No edites Cargo/lock raíz,
contratos TS, shell o UI. Evita colisiones de target de Cargo con otros threads.

Entrega API Rust documentada, pruebas, fixtures pequeños y docs/status/data.md.
Comunica a integración los nombres de funciones/tipos y dependencias. No realizar
commits, pushes ni publicación.
