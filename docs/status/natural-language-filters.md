# Filtros en lenguaje natural con perfiles locales

## Implementación (2026-09-25)

- La propuesta de filtros recibe un perfil local acotado de las variables seleccionadas: `p25`, mediana y `p75` (además de mínimo/máximo y ausencias) para variables numéricas y de fecha, y valores frecuentes con conteos para variables booleanas, categóricas y multivalor.
- Los perfiles se calculan en Rust con el muestreo automático ya usado por las distribuciones. No se cargan filas en JavaScript ni se envían filas completas al proveedor. El diálogo informa ahora de los resúmenes y valores categóricos que sí se envían.
- Las expresiones subjetivas y superlativas se aproximan mediante cuartiles: por ejemplo, «grandes y baratos» puede convertirse en área `>= p75` y precio `<= p25`, explicando la aproximación antes de aplicarla.
- Una petición valorativa sin criterio explícito ya no se rechaza automáticamente. El modelo debe inferir un proxy de dominio revisable; en vivienda, «los mejores pisos» usa amplitud `>= p75` y asequibilidad `<= p25` cuando existen superficie y precio, explicándolo como aproximación acotada a un precio bajo por unidad de superficie y no como cociente exacto.
- Gemini puede resolver categorías por su semántica, pero solo puede devolver valores exactos presentes entre los candidatos frecuentes (o escritos literalmente por el usuario). El backend rechaza categorías inventadas antes de ejecutar la consulta.
- El contexto categórico queda acotado a 512 valores en total y 64 por variable; si hay muchas variables, el presupuesto se reparte con un mínimo de cuatro candidatos frecuentes por variable.

## Límites de validación

- `bun run check`: **PASS**.
- `bun test src/features/explorer/analysis-model.test.ts`: **5 PASS**.
- `DYLD_LIBRARY_PATH="$PWD/vendor/duckdb" cargo test --manifest-path src-tauri/Cargo.toml analysis::tests --lib` con `CARGO_TARGET_DIR` temporal: **4 PASS**. El primer lanzamiento sin `DYLD_LIBRARY_PATH` compiló correctamente pero no pudo cargar `libduckdb.dylib`; se repitió con la librería vendorizada del proyecto.
- `scripts/build-macos.sh`: **PASS**. Como `/Applications/Datolens.app` seguía abierta, el script conservó intacto el bundle en ejecución y dejó la actualización firmada pendiente en `src-tauri/target/macos-staging/build-9hggns0v/debug/bundle/macos/Datolens.app`; `codesign --verify --deep --strict` pasó. Después se cerró Datolens normalmente, se instaló con `scripts/build-macos.sh --install-pending` y se reabrió la ruta canónica `/Applications/Datolens.app`.
- **Gemini real verificado en la UI nativa instalada** con `gemini-3.8-flash`, el fixture `housing-demo.parquet` de 1.200 filas y la consulta «Los pisos más grandes más baratos». La propuesta visible fue `property_type = Apartment`, `area_m2 >= 175` (`p75`) y `price_eur <= 249000` (`p25`), con una explicación explícita de la aproximación por cuartiles. La propuesta se dejó abierta para revisión y no se aplicó a la vista.
- Segunda verificación real tras la regla de proxy de dominio: «los mejores pisos» produjo igualmente `property_type = Apartment`, `area_m2 >= 175` y `price_eur <= 249000`. La explicación ya no rechazó «mejores»: indicó que, al no existir valoración explícita, amplitud alta más asequibilidad alta funciona como proxy acotado de precio bajo por unidad de superficie, no como ratio exacto. La propuesta quedó visible y sin aplicar.
