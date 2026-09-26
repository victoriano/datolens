# Menú de orden de categorías — 2026-09-24

El orden de las barras categóricas, multivaluadas y de texto se elige desde un icono en el encabezado de cada variable. El menú muestra «Por todo», «Por selección», «Por diferencia» y «Por TF-IDF», con una breve explicación y marca del modo activo. Si existe un orden manual guardado, aparece también «Orden personalizado». Se eliminó el selector situado sobre las barras; la lógica de orden y su persistencia no cambiaron.

Verificación: `bun run check`, `bun run build` y 19 pruebas dirigidas correctas. Compilación Tauri de QA, firma y `codesign --verify --deep --strict` correctos. Se activó ese bundle en la app principal y se comprobó visualmente el icono y el desplegable en `agency` con el dataset local de NYC (1.123.454 filas). El cambio a «Por selección» se guardó; después se restauró el modo y se eliminó la entrada temporal del sidecar. Las dos pestañas originales volvieron a abrirse. No se modificaron filas ni se hizo ninguna llamada IA.

La primera apertura tras sustituir el bundle mostraba recursos antiguos de WebKit. Tras retirar solo la caché de red regenerable de Datolens y reiniciar, el nuevo menú apareció en la app principal. El bundle anterior permanece en `src-tauri/target/category-sort-backup-Datolens.app` como respaldo local. No se creó commit ni se publicó nada.
