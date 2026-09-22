# Datolens

Exploración local de CSV, XLSX y Parquet y enriquecimientos selectivos con Gemini.
MVP para macOS Apple Silicon: Tauri 2, React/TypeScript y DuckDB nativo.

## Desarrollo

Requisitos: Bun, Rust estable y Command Line Tools de Xcode.

```sh
bun install
scripts/prepare-duckdb.sh  # solo si falta vendor/duckdb/libduckdb.dylib
bun run app:dev
```

`~/.cargo/bin` debe estar en PATH. `.cargo/config.toml` fija las rutas de la
biblioteca oficial DuckDB 1.5.5; no se requiere instalar DuckDB en el sistema.

## Bundle local

```sh
scripts/build-macos.sh
```

Genera `src-tauri/target/debug/bundle/macos/Datolens.app`, con DuckDB incluido en
`Contents/Frameworks`. Se usa un perfil local sin símbolos debug para limitar el
uso de disco; no es distribución notarizada ni una publicación en la App Store.
Consulta `docs/QA.md` para el estado real de las verificaciones.

## Datos y claves

La fuente permanece intacta. Vistas, base de resultados y cola se guardan en
`~/Library/Application Support/com.victoriano.datolens/projects/`.
La app restaura el último archivo y su vista. Cambios en la fuente producen una
identidad/revisión distinta para no mezclar resultados.

Introduce la clave Gemini exclusivamente en el panel de la app; se guarda en el
Llavero de macOS bajo el servicio `com.victoriano.datolens.providers`. Abrir o
filtrar no llama a Gemini. Antes de ejecutar se muestra el alcance congelado, las
llamadas estimadas y un límite; solo viajan los campos seleccionados.

## QA

```sh
bun run check
bun test src/features/explorer/model.test.js
python3 scripts/create-fixtures.py
```

Los tests Rust y los benchmarks se ejecutan de manera secuencial para compartir
el target sin bloquear compilaciones. Ver `docs/QA.md` y los recibos de
`docs/status/` para comandos, resultados y límites. Los fixtures web explícitos
no forman parte de la entrada de producción ni sustituyen la prueba de la app.

«Jev» no está identificado; Gemini es el único proveedor implementado.
