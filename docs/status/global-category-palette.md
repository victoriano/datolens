# Paleta categórica general — 2026-09-24

## Comportamiento

- Ajustes generales ofrece las cinco paletas categóricas existentes con muestras. La preferencia `defaultCategoryPalette` se guarda localmente, comienza en Clásica para instalaciones antiguas y se valida al leerla.
- Los gráficos categóricos, la tabla coloreada, el editor de colores y el editor de orden usan la paleta general mientras la variable no tenga una propia. Al cambiar Ajustes, las variables que heredan se actualizan sin modificar la vista del dataset.
- El editor de una variable permite fijar cualquiera de las cinco paletas, incluida Clásica, o volver a «Usar paleta general». Solo se guarda una elección explícita en `categoryPalettes`. Los colores manuales por valor original siguen teniendo prioridad y no se borran al cambiar de paleta.

## Verificación

- 100 pruebas del explorador y preferencias, 0 fallos; `bun run check`, `bun run build` y `git diff --check` correctos. Registro: `docs/qa/global-palette-frontend-tests.txt`.
- Bundle nativo QA aislado, compilado y firmado. En Ajustes se eligió Pastel y la variable `Group`, sin paleta propia, adoptó sus colores en el gráfico y la tabla, mientras `MultipleLines` conservó Tierra y el rojo manual `#d00000` para `No`.
- `Group` se fijó explícitamente en Clásica. Tras cambiar la paleta general a Viva, el editor seguía mostrando Clásica y `#4477aa` para `A`. Se pulsó «Usar paleta general»: `A` pasó a `#e63946`, la elección propia desapareció del sidecar, y los colores de `MultipleLines` permanecieron. Tras reiniciar la QA, Ajustes restauró Viva.
- No se enviaron datos a proveedores de IA en esta verificación. Compilación QA: `docs/qa/global-palette-native-build.txt`.

## Instalación

- App principal instalada en `src-tauri/target/debug/bundle/macos/Datolens.app`, firmada y verificada. SHA-256 final del ejecutable: `6abe1a0aec53ba17a42f0807cba68e7b6c6581409fda88716f5c1e1712005bb5`. Compilación: `docs/qa/global-palette-main-build.txt`; copia anterior al cambio: `src-tauri/target/global-category-palette-backup/Datolens.app`.
- Una primera copia firmada solo con el certificado mostraba en Ajustes «El almacén de credenciales no reconoce esta firma de Datolens»: Tauri había sustituido el auxiliar de credenciales y faltaba el hardened runtime del paquete exterior. Se rehizo el paquete instalado con el auxiliar independiente original (comparación binaria exacta), `--options runtime` y las entitlements de `scripts/build-macos.sh`; `codesign --verify --deep --strict` pasó. La primera copia se conservó en `src-tauri/target/global-category-palette-unsigned-backup/Datolens.app` para diagnóstico.
- La instancia principal PID 68902, que había cargado la primera copia, se cerró y la app instalada se reabrió como PID 71136. En el dataset real `churn_dataset.csv` (7.043 filas), el panel de enriquecimiento muestra «Keys saved» y ya no aparece el error de firma del almacén de credenciales. No se realizaron llamadas a Gemini. La app notarizada en `artifacts/distribution/notarized/Datolens.app` no se modificó.
