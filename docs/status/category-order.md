# Orden de categorías e IA en lote — 2026-09-24

Trabajo autorizado: modal de orden manual, sugerencias ordinales con Gemini y revisión en lote de orden/color. Las otras tareas del proyecto estaban inactivas al comenzar; se reutilizan sus componentes y contratos sin revertir cambios.

Contrato aditivo: `ViewState.categoryOrders` por ID estable y código original; modo de presentación `manual`; `suggestCategoryOrder` devuelve una permutación completa o indica que la variable no tiene un orden natural. El estado de vista se guarda mediante el sidecar existente. No cambia el orden de filas de la tabla.

El lote carga agregados completos de cada variable seleccionada en nativo, conserva los límites existentes de 256 categorías y muestra los casos truncados. El orden IA requiere una escala completa de hasta 100 valores; colores admite un ámbito acotado. Generación explícita, presupuesto de llamadas, interrupción entre peticiones, revisión y guardado independiente de las propuestas válidas. Se preservan las personalizaciones salvo elección explícita.

## Entrega

Implementado y activo en la app principal. En el menú de una variable categórica, **Ordenar categorías… / Order categories…** abre un modal con arrastre, flechas de teclado, búsqueda, inversión del orden, restauración por frecuencia y sugerencia ordinal con IA. Cancelar descarta el borrador; Aplicar guarda el orden. Los colores siguen asociados al código original y los nulos permanecen al final.

**✧ Categorías / Categories**, en el panel de variables, permite ordenar, colorear o hacer ambas cosas en todas las variables categóricas, booleanas y multivaluadas seleccionadas, incluidas las ocultas. Primero prepara agregados locales, después muestra el número de llamadas previstas y permite generarlas por tandas. Cada propuesta se revisa y selecciona antes de aplicar. El presupuesto inicial es de 20 llamadas por tanda; detener conserva la respuesta en curso y los resultados anteriores. Un error no pierde otras propuestas y el reintento es explícito. La IA puede identificar una variable nominal y dejar su orden intacto.

Solo se envían nombres, códigos, etiquetas y el contexto opcional elegido; no se envían filas. Las pruebas reales utilizaron exclusivamente un CSV sintético de 100 filas. No se cambiaron credenciales ni se enviaron los datasets del usuario a Gemini.

## Verificación

- `bun run check`: correcto.
- `bun test src/features/explorer src/features/plots`: **109 pruebas, 743 aserciones, 0 fallos**. Evidencia: `docs/qa/category-order-regression-tests.txt`.
- Rust, pruebas de categorías con `tauri/custom-protocol`: **9 pruebas, 0 fallos**. Evidencia: `docs/qa/category-order-native-tests.txt`.
- Build Tauri completo y firma verificada con `codesign --verify --deep --strict`. Cargo se ejecutó secuencialmente en `/tmp/datolens-chart-qa-target`. Evidencia: `docs/qa/category-order-main-build.txt`.
- App nativa de QA: arrastre real y teclado, cancelar, invertir y aplicar; crossfilter de 100 a 28 filas sin perder el orden; cierre y reapertura restauraron orden y colores del sidecar.
- Gemini real en la app de QA: orden `Nunca → A veces → A menudo → Siempre`; escala de acuerdo con colores divergentes; frecuencia con escala azul; marcas nominales sin orden inventado. Una respuesta de color tuvo JSON inválido: las otras propuestas se conservaron y el reintento explícito completó la propuesta. Una marca desconocida conservó la paleta existente. Resultado persistido: `docs/qa/category-order-native-result.json`.
- Fixture de UI con proveedor simulado: presupuesto de dos llamadas, fallo aislado, aplicación de propuestas seleccionadas, detener durante una llamada conservando su resultado y cancelar sin guardar. Fixture reproducible: `docs/qa/category-order-regression.html`.
- App principal instalada y reiniciada: restauró las dos pestañas del usuario y las 7.043 filas del dataset activo. Verificados el nuevo botón de lote y el modal de orden de `MultipleLines`; se cerró con Cancelar.

Bundle activo: `src-tauri/target/debug/bundle/macos/Datolens.app`. SHA-256 de `Contents/MacOS/datolens`: `e66cfc41e0d652eebfd548d9399df0dadd3d4106d048c50a39b4df9559bc7cf7`.

La copia anterior del bundle queda en `src-tauri/target/category-order-backup/Datolens.app`. La app de QA y el servidor Vite temporal quedaron cerrados. No se crearon commits ni se publicó nada.

## Límites

El orden manual afecta las barras del explorador; no reordena filas ni configura los gráficos de la sección Charts. La consulta nativa conserva su límite de 256 categorías y el modal avisa cuando la lista está truncada. El orden IA exige la lista completa de 2–100 categorías válidas y un tamaño acotado de texto; los casos incompletos o demasiado grandes se omiten con explicación. Los colores admiten hasta 100 categorías por petición y muestran su ámbito antes de generar. La revisión del usuario sigue siendo necesaria para decidir si la interpretación semántica propuesta es adecuada.
