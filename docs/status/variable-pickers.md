# Selectores de variables compactos — 2026-09-23

- Componente compartido `src/ui/VariablePicker.tsx`: búsqueda por nombre sin distinguir mayúsculas ni tildes, desplegable con seis filas visibles (192 px), scroll, estado vacío, flechas/Enter/Escape y cierre al hacer clic fuera. Se monta fuera de los paneles con scroll.
- Aplicado a ejes, color, tamaño, medida de celdas y selección previa de la galería.
- Selecciones múltiples de gráficos, análisis y columnas enviadas a enriquecimientos: búsqueda, lista de 180 px y recuento de seleccionadas/resultados. Filtrar la lista conserva la selección completa y su orden; análisis mantiene el máximo de 128 variables.
- Menú Columnas: búsqueda y altura máxima de 240 px, conservando controles de orden y visibilidad.
- `bun run check`, `bun run build` y 9 pruebas de gráficos (75 aserciones): PASS. Build macOS y firma ad hoc verificados.
- Prueba en Datolens nativo con `idealista_dataset.csv` (94.815 filas, 41 variables): selector X muestra seis opciones a la vez; búsqueda `floor` devuelve tres; flecha abajo + Enter selecciona FLOORCLEAN; consulta inexistente muestra estado vacío y Escape cierra.
- En el alcance del análisis: `floor` muestra tres resultados y conserva 41 seleccionadas. No se ejecutaron peticiones Gemini ni enriquecimientos reales. No se recorrieron individualmente todas las instancias del componente compartido.
