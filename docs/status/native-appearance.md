# Apariencia macOS — 22 septiembre 2026

Petición: adaptar el MVP existente para que parezca una app nativa.

Alcance: capa de presentación de integración en `src/styles/native.css`,
wrapper de `App.tsx`, título overlay Tauri y permiso de arrastre de ventana.
No se modifican contratos, módulos del explorador/enriquecimiento, motores de
datos, dependencias ni `reference/`. Los equipos originales figuran entregados
en `docs/THREADS.json`; esta tarea no les asigna trabajo nuevo.

## Criterio visual

La persona está explorando un archivo local grande: necesita leer filas,
comparar distribuciones, filtrar variables, seleccionar celdas y exportar una
vista. La referencia es una herramienta documental de macOS.

- Dominio: archivo, tabla, filas, columnas, selección y distribuciones.
- Paleta: blanco de documento, gris de barra, gris cálido de inspector, grafito
  de texto, azul de selección; estados de error mantienen su semántica.
- Identidad: inspector con distribuciones cruzadas al lado de la tabla.
- Sustituir cabecera de marca por título del documento; espacio vertical de web
  por herramientas compactas; rejilla uniforme por bandas alternas de tabla.
- Tipografía del sistema y cifras tabulares; estados de foco, pulsado y disabled.
- Controles reales de ventana conservados, sin dibujar botones falsos.

## Verificación

- `bun run check` y `scripts/build-macos.sh`: correctos; bundle firmado ad hoc y
  verificado con codesign. Avisos existentes de chunk Vega y rpath duplicado.
- Bundle macOS real reabierto con `idealista_dataset.csv`: 94.815 filas y 41
  columnas recuperadas. Tabla, inspector, histogramas y estado guardado visibles.
- Menú Columnas abierto y cerrado en la app real; captura revisada.
- Filtrado de PRICE ejercitado y retirado; vista completa restaurada y persistida.
- Arrastre de cabecera implementado mediante API Tauri; la prueba por coordenadas
  no confirmó el movimiento de ventana, por lo que queda sin verificar.
- Alineación vertical de semáforos ajustada después de la primera revisión.

Esto sigue siendo Tauri/WebKit con apariencia macOS, no una migración a SwiftUI.
La paleta continúa clara. Windows, modo oscuro y Gemini real no forman parte de
esta verificación visual.
