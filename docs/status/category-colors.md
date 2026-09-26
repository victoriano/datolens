# Colores de categorías — 2026-09-24

## Implementado

- Paleta automática de 24 colores, reutilizada por valor original mediante un hash estable. Ordenar, filtrar, cambiar de página o reabrir no cambia la asignación; las categorías pueden compartir color porque la paleta es finita. No se carga el dominio completo ni el dataset en JavaScript.
- Botón de paleta junto a cada variable categórica, booleana o multivalor. El diálogo permite buscar categorías/códigos/etiquetas SPSS, editar mediante selector nativo/HEX/paleta, introducir un valor exacto fuera de los bins cargados, y restablecer categoría o variable. Aplicar guarda; Cancelar/Escape descartan el borrador. Los valores nulos y perdidos SPSS son neutros; las variables de texto mantienen el acento anterior.
- `ViewState.categoryColors` guarda solamente elecciones explícitas por columna y valor original. La reconciliación valida HEX, elimina columnas inexistentes y conserva claves especiales/vacías. Las vistas nativas ya persisten JSON opaco: no se altera el formato ni se requiere una migración Rust.
- Ajustes → General → Colorear categorías en la tabla: preferencia global persistente, desactivada de forma predeterminada, compatible con ajustes antiguos. Las celdas usan etiquetas con un fondo tenue y el mismo color que el gráfico; selección, valores copiados y etiquetas SPSS se conservan. Las listas colorean cada elemento.
- Se conservan los límites de memoización de barras y celdas. Solo se pasan las asignaciones de la columna correspondiente; no se añaden consultas de datos ni dependencias.

## Verificado

- `bun test src/features/explorer src/ui`: **83 pruebas, 0 fallos, 2.017 aserciones**. Incluye persistencia/migración, 1.000 valores de alta cardinalidad, claves especiales, formatos de tabla, identidad del modelo, copia y restauración. Log: `docs/qa/category-colors-frontend-regression.txt`.
- TypeScript y build Vite correctos dentro de las compilaciones nativas.
- Test Rust `sidecar_restores_view_with_a_fresh_cache_and_preserves_source`: PASS. Colores recuperados con caché nueva y archivo original intacto. Log: `docs/qa/category-colors-native-persistence.txt`.
- QA en aplicación Tauri real con CSV de 120 filas y 4 columnas, mediante UI nativa: tabla sin color inicialmente; edición de `Status/Active` a `#16a34a`; validación de HEX incorrecto; ajuste de color activado; mismo verde visible en gráfica y tabla; filtro de Active devuelve 40 filas y limpiar restaura 120; restablecer y cancelar conserva el color guardado; reiniciar conserva preferencia y asignación; valor exacto no cargado `Rare category/#123456` guardado. Revisión visual en claro y oscuro.
- Compilación QA final: `/tmp/datolens-chart-qa-target/debug/bundle/macos/Datolens Colors QA.app`, SHA-256 `cb10c1f569c7a0dc57a9047f16040d8b7fb0e4bbf16fa9508ce1ba000ed9b949`. Los datos de verificación son sintéticos; no se hicieron llamadas IA ni se alteraron claves.

## Entrega y activación

- Bundle principal actualizado en `src-tauri/target/debug/bundle/macos/Datolens.app`, firmado con la identidad local habitual y verificado con `codesign --verify --deep --strict`.
- SHA-256 principal: `66b63bb42e99743c4637dc88590b43fef69ee8d6637f8c88c0248d5e463a82ff`. Compilaciones: `docs/qa/category-colors-{native,main}-build.txt`; recibo: `docs/qa/category-colors-native-result.json`.
- El proceso principal que estaba abierto conserva un borrador de análisis sin guardar; se ha mantenido su sesión. **La nueva versión está instalada en disco y se cargará al cerrar y volver a abrir Datolens.** No confundir la QA nativa con la activación en ese proceso.
- Copia anterior preservada en `src-tauri/target/category-colors-backup/Datolens.app`. No se han creado commits ni publicado artefactos remotos.
