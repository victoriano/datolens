# Menú de columnas de la tabla

23 de septiembre de 2026.

- Cada cabecera tiene un botón de dos puntos con acciones para ocultar la columna, localizar la variable en cross filters, abrirla en Gráficos y editar nombre y descripción.
- Localizar abre el panel de variables si estaba cerrado, retira la ocultación y los filtros de navegación del panel, despliega su grupo, desplaza la tarjeta al centro y la resalta brevemente. Conserva los filtros aplicados a los datos.
- La edición usa el diálogo y los metadatos de presentación ya existentes; no cambia el ID físico de la columna. Abrir en Gráficos reutiliza la creación del borrador actual.
- `bun run check`, `bun run build` y `git diff --check`: PASS.
- Recorrido en fixture de navegador: menú y cuatro opciones visibles; ocultar quita la columna de la tabla; localizar restaura una variable oculta, limpia la búsqueda y desplaza la tarjeta; editar muestra alias en tabla y panel y descripción en la tarjeta; Gráficos abre barras con el alias en X. El fixture no dispone de cálculo nativo de gráficos.
- `scripts/build-macos.sh`: PASS; bundle debug reconstruido y firma ad hoc verificada. En English, el menú nativo muestra «Hide column», «Find in cross filters», «Open in Plot» y «Edit name and description».
- Recorrido nativo con `/tmp/datolens-table-menu-native.csv` (4 filas, 3 columnas): ocultar `area` redujo la tabla a 2 columnas; buscar `city` en el panel y localizar `price` desde su cabecera limpió la búsqueda y mostró su tarjeta; Open in Plot calculó barras con `price` en X y 4/4 filas, 4 grupos; editar `price` a «Precio QA» con descripción «Importe sintético.» actualizó cabecera y tarjeta. La pestaña sintética se cerró y se retiraron su CSV y sidecar.
- Se conservaron las pestañas `matt_berman_openclaw_repliers.csv` y `victorianoi_followings.csv`, esta última activa en Tabla con panel visible y filtro `location=Madrid` en 101/1.502 filas.

## Reordenación por arrastre

- Las filas del menú «Columnas» se pueden arrastrar con una posición provisional visible; las flechas y el teclado siguen disponibles. Con una búsqueda activa, las columnas que no coinciden conservan su posición.
- Las cabeceras de la tabla admiten arrastre desde su superficie libre. El orden se guarda en `columns.order`; el de los cross filters permanece en `variablePanel.order`.
- `bun run build` y `scripts/build-macos.sh`: PASS; firma del bundle macOS verificada por el script. En la vista de prueba, arrastrar «Identificador» al tercer lugar produjo «Empresa, Ciudad, Identificador» en menú y tabla, mientras los cross filters conservaron «Identificador, Empresa, Ciudad». La app nativa que estaba abierta seguía ejecutando el bundle anterior; el gesto nuevo no se comprobó en esa instancia.
