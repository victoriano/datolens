# Etiquetas de ejes de gráficos

- Las etiquetas de bins numéricos se abrevian automáticamente según la escala y el ancho de intervalo; los límites exactos siguen en los datos de la marca para tooltips y filtros.
- Los ejes usan detección de solapamiento de Vega y ocultan etiquetas cuando falta espacio. Esto se recalcula al cambiar el ancho del gráfico.
- En **Ajustes → Diseño → Eje X/Y** se puede escoger un formato manual predefinido o escribir uno personalizado de D3, rotar etiquetas, cambiar su ancho y fijar la separación mínima. Las fechas usan un formato automático acorde con el periodo elegido.
- `bun run check`, `bun test src/features/plots/model.test.js` (10 pruebas, 91 aserciones) y `bun run app:build`: correctos. La prueba nueva ejecuta Vega con 16 bins, comprueba que se ocultan etiquetas cuando falta espacio y que los límites de filtro siguen intactos; cubre formatos manuales, uno personalizado y valores vacíos.
- El paquete nativo se generó en `src-tauri/target/release/bundle/macos/Datolens.app`. No se realizó un recorrido visual dentro de esa app; queda como límite de la verificación.
