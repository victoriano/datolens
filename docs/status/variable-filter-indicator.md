# Indicador discreto de variable filtrada — 2026-09-23

Petición: reducir el énfasis del bloque azul que cubría toda la variable activa.

- Las tarjetas con filtro conservan su superficie y borde normales, tanto en el
  panel lateral como en Explorar. También se elimina el fondo azul del duplicado
  que sigue al puntero al reordenar una variable filtrada.
- El estado se indica con una línea de 2 × 18 px, con extremos redondeados,
  junto al encabezado. Usa el acento del tema y no ocupa espacio ni recibe clics.
- Los gráficos, sus rangos, las categorías seleccionadas y los controles
  conservan sus indicadores. No se modifica la lógica ni la persistencia.
- Cambios en `src/styles/explorer.css` y eliminación de la regla global que
  imponía el fondo azul en `src/styles/theme.css`.

## Verificación

- `bun run check`: PASS.
- `scripts/build-macos.sh`: PASS, incluyendo build frontend y firma local
  verificada. Bundle principal en
  `src-tauri/target/debug/bundle/macos/Datolens.app`.
- Avisos existentes: chunks de más de 500 kB y rpath duplicado del enlazador.
- QA en una app macOS compilada con el mismo frontend y un identificador
  separado (`com.victoriano.datolens.selectionqa`), usando un CSV sintético
  local de 120 filas. No es una prueba en navegador ni una captura simulada.
- Filtro nativo P75–Máx de BATHNUMBER: 40/120 filas, intervalo 4–5. La tarjeta
  mostró la línea corta sobre su fondo neutro en modo oscuro y claro.
- Explorar en modo claro: fondo y borde normales, línea junto al encabezado.
- Limpiar filtros: regreso a 120/120 filas y desaparición de la línea,
  comprobados mediante accesibilidad y captura de la app real.
- Se cerró la instancia de QA. La instancia principal estaba en uso y no se
  reinició: cargará estos estilos al volver a abrir el bundle actualizado.
- Logs: `/tmp/datolens-variable-selection-build.log` y
  `/tmp/datolens-variable-selection-qa-build.log`.

El arrastre no se ejercitó manualmente en este pase; su cambio es únicamente
la eliminación de la regla de fondo para la tarjeta duplicada.
