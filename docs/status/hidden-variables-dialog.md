# Diálogo de variables ocultas

El botón «Mostrar N variables ocultas» abre un diálogo con la lista de nombres visibles. Cada fila permite restaurar una variable y «Mostrar todas» restaura el resto. El diálogo se cierra al restaurar la última variable.

Verificado el 23 de septiembre de 2026: `bun run check` y `bun run build` pasan. En el fixture de interfaz, se ocultaron Identificador y Empresa; el diálogo mostró ambas, restaurar Identificador dejó Empresa en la lista y «Mostrar todas» devolvió el contador del panel a siete variables sin botón de ocultas. El fixture temporal se retiró.

La interacción todavía no se ha comprobado en el bundle nativo. La app nativa que estaba abierta usaba un bundle anterior y no se modificó durante esta prueba.
