# Paletas por frecuencia — 2026-09-24

## Comportamiento

- Los colores automáticos de cada variable categórica siguen la frecuencia de referencia de las distribuciones, de mayor a menor. Un empate se resuelve por el código original. Al agotar la paleta, esta vuelve a comenzar.
- El orden visual del gráfico y los filtros no reasignan los colores. Los valores no incluidos entre las categorías cargadas conservan una asignación determinista por código hasta que haya frecuencia disponible. Nulos y valores perdidos SPSS no ocupan una posición de la paleta.
- El modal muestra, para cada alternativa, sus primeros colores en el orden que reciben las categorías más frecuentes. Los colores personalizados se ven en la lista de categorías y conservan prioridad. Los colores sugeridos a la derecha corresponden a la paleta seleccionada.
- La tabla utiliza el mismo orden de frecuencias cuando está activada la preferencia de colorear celdas, incluso si el panel de variables está oculto.

## Verificación

- 89 pruebas del explorador y preferencias, 0 fallos; TypeScript sin errores.
- Bundle nativo QA aislado, compilado y firmado. Con 100 filas sintéticas (No 70, Yes 20, No phone service 10), Tableau mostró No `#4e79a7`, Yes `#f28e2b` y No phone service `#e15759`. Las muestras del editor mostraron los HEX de Tableau.
- En la QA, No se personalizó como `#d00000`; al cambiar a Tierra mantuvo el rojo mientras Yes adoptó `#5f7856`. Tras Aplicar, gráfico y tabla mostraron el mismo rojo y el sidecar guardó el override y `earth`.
- Registro de compilación nativa: `docs/qa/category-color-frequency-native-build.txt`.

## Activación

- App principal instalada en `src-tauri/target/debug/bundle/macos/Datolens.app`, firmada y verificada con `codesign --verify --deep --strict`. SHA-256 del ejecutable: `5fbf2540ba4c15a57441dc2426515c414ac00dd21478cd287012a034befeae2c`. Compilación: `docs/qa/category-color-frequency-main-build.txt`. Backup previo: `src-tauri/target/category-color-frequency-backup/Datolens.app`.
- La instancia principal PID 32493 seguía abierta con un modal y cambios sin aplicar; se preservó sin cerrarla ni reiniciarla. Para cargar el nuevo ejecutable hay que cerrar esa instancia y volver a abrir la app. El flujo nativo descrito arriba se comprobó en el bundle QA aislado, no en esa instancia antigua.
