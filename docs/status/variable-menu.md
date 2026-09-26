# Acciones de variable: Gráficos y nombre/descripción

23 de septiembre de 2026.

- El menú de cada tarjeta permite **Abrir en Gráficos**. Crea un borrador nuevo
  con el ID de esa columna en X: barras para número/categoría y línea de
  recuentos para fecha. Conserva los gráficos guardados y usa el tema actual.
- **Editar nombre y descripción** abre un diálogo con validación de nombre no
  vacío. Guarda metadatos de presentación en `ViewState.variablePanel.metadata`,
  dentro del sidecar de la vista. El ID y nombre físico de la columna siguen
  intactos para filtros, consultas y exportaciones. El nombre visible se usa
  en tarjetas, tabla, filtros y ajustes del gráfico; la descripción se muestra
  en la tarjeta. La clasificación y el cambio de grupo conservan ambos textos.
- `bun run check`, `bun run build` y 28 pruebas de Explorer/Plots: PASS.
  La regresión `setVariableText` comprueba que editar texto deja ausente una
  función analítica que no estaba clasificada.
- Recorrido en fixture de navegador: menú visible, edición de «Facturación» a
  «Ingresos de prueba», descripción visible y cabecera de tabla actualizada.
  «Open in Plot» abrió Barras con la variable editada en X. El fixture no
  dispone de cálculo nativo de gráficos.
- Recorrido nativo en el bundle debug existente con
  `/private/tmp/datolens-variable-menu-qa.csv` (4 filas): edición de `PRICE`,
  tabla y tarjeta actualizadas, barras calculadas con 4/4 filas y cuatro grupos,
  X correcto. Reabrir el CSV restauró nombre, descripción y gráfico desde el
  sidecar. Se restauró después `idealista_dataset.csv` con 94.815 filas.
- Smoke final en el bundle debug recompilado con
  `fixtures/generated/integration-september-23.csv`: `price` estaba «Sin
  clasificar» antes de editar. Tras guardar «Precio de prueba» y «Importe
  sintético para QA.», la tarjeta y la tabla mostraron el alias, la tarjeta
  mostró la descripción y el rol siguió «Sin clasificar». El sidecar guarda
  `name` y `description` sin campo `role`. Se dejó el fixture activo para las
  pruebas de integración siguientes.

No se modificó el archivo de datos ni se hizo ninguna llamada a IA.

## Nombre original tras renombrar (2026-09-25)

- El primer renombrado guarda `originalName` junto al alias de presentación. Los renombrados posteriores y la restauración del nombre visible conservan ese origen; las vistas antiguas con alias se migran al abrirse usando el esquema fuente.
- El nombre original aparece al pasar el puntero por el alias en la cabecera de tabla, las tarjetas y diálogos de variables, el selector de columnas, los filtros y las reglas de orden. El formulario de nombre y descripción muestra siempre el original persistido.
- Verificación: `bun test src/features/explorer/model.test.js` (**15 pass**), `bun run build` (**PASS**), `git diff --check` (**PASS**) y `./scripts/build-macos.sh` (**PASS**). Como `/Applications/Datolens.app` seguía abierta, el script conservó intacto el proceso y bundle instalados y dejó la actualización firmada pendiente; la comprobación del gesto en el proceso nativo nuevo requiere salir de la app e instalar ese bundle.

## Acciones secundarias en los tres puntos

- Fijar/desfijar y ocultar variable pasan de la cabecera al menú de opciones.
  Estadísticas continúa como acceso directo.
- Las cuatro opciones (fijar/desfijar, ocultar, gráficos y editar) incluyen
  iconos SVG con el mismo tamaño y estilo; fijar refleja su estado activo.
- Las acciones cierran el menú y conservan los cambios existentes de vista.
- Verificación: `bun run check` y 14 pruebas de `model.test.js` correctas.
  Este ajuste no se ha comprobado visualmente en el binario nativo.

## Cabecera y búsqueda de tarjetas

- Se aumenta la presencia del distintivo de tipo y del nombre; el título admite
  varias líneas y las acciones pasan a una segunda línea en tarjetas estrechas.
- La lupa aparece junto a estadísticas y el menú en variables categóricas,
  multivalor y texto. En categorías busca entre las barras cargadas y recupera
  la lista al cerrar; en texto despliega el filtro existente y lo aplica con Intro.
- Validado en la vista de prueba: Empresa buscó «Marea Labs» y restauró las seis
  categorías al cerrar; Identificador filtró una fila de 240. `bun run check`,
  `bun run build` y 14 pruebas de Explorer pasaron. La vista nativa no se abrió
  para este ajuste visual.
