# Cabecera compacta — 23 septiembre 2026

Petición: una sola barra con las pestañas junto a los controles nativos de
ventana, «+» después de la última pestaña y Ajustes en el extremo derecho.

## Implementación

- `WorkspaceBar` pasa a ser la cabecera arrastrable de 48 px. Desaparece la
  fila independiente con la marca. La barra de herramientas del dataset
  conserva su posición inmediatamente debajo.
- Pestañas en una línea, con el nombre completo y tamaño de caché en el tooltip.
  Las hojas XLSX conservan el nombre del archivo como contexto en la misma línea.
- «+» sigue al ancho ocupado por las pestañas. Cuando no caben, solo su lista
  se desplaza horizontalmente; la activa se revela al cambiar o abrir datasets.
  El botón y Ajustes mantienen su espacio. Una zona flexible permite arrastrar.
- El menú de «+» se coloca dentro de los límites de la ventana, también sin
  archivos abiertos; Escape lo cierra y devuelve el foco al botón.
- Ajustes usa el mismo diálogo y atajo existentes. El arrastre de la ventana
  excluye pestañas, botones y el menú de apertura.
- `trafficLightPosition.y` pasa de 31 a 26 para alinear los controles nativos
  con el centro de la nueva barra; alineación revisada en el bundle final.

## Verificación

- TypeScript y build nativo `Datolens Header QA.app`: PASS. Firma local
  verificada con `codesign --verify --deep --strict`.
  Log: `docs/qa/compact-header-build.txt`.
- App nativa aislada `com.victoriano.datolens.headerqa`: estado vacío, menú «+»
  sin recorte y apertura de Ajustes desde el engranaje: PASS. No se editaron
  preferencias ni claves y no se hicieron llamadas IA.
- CSV sintético restaurado mediante `last-source.json` en el perfil aislado:
  pestaña de una línea, «+» inmediatamente después, Ajustes a la derecha,
  tabla e histogramas con 3/3 filas: PASS en captura y accesibilidad.
- La apertura del fixture desde el selector nativo no se pudo completar:
  Finder mantuvo «Open» deshabilitado pese a mostrar el CSV seleccionado.
  Se canceló el diálogo; la prueba de datos anterior usó restauración.
- Entrega del bundle principal coordinada con las tareas de scroll y diagnóstico
  de Gemini: compilado y reiniciado por la tarea de scroll, conservando los
  cambios de diagnóstico. Inspección propia del proceso principal nuevo
  (PID 68877, ruta exacta `src-tauri/target/debug/bundle/macos/Datolens.app`):
  pestañas Idealista/PISA, «+» pegado a la última, Ajustes en el extremo derecho,
  semáforos alineados y tabla inmediatamente bajo las herramientas: PASS en
  captura y accesibilidad. Esta inspección no cambió datasets, filtros ni scroll.
- El desbordamiento con muchas pestañas y el movimiento efectivo de ventana
  están implementados, pero no se ejercitaron en este pase nativo.

## Ajuste final de Escape

- En el principal se abrió el menú «+» con las dos pestañas reales: las opciones
  de archivo local, URL y derivación aparecieron correctamente. Escape no cerró
  el menú en la prueba, por lo que se añadió un listener de teclado en captura
  mientras esté abierto: no depende de que macOS enfoque el botón al pulsarlo.
- TypeScript y `scripts/build-macos.sh`: PASS. Log:
  `docs/qa/compact-header-final-build.txt`. SHA-256 del ejecutable principal:
  `b8fde0f635908807f78e9a7a0e6f177973d2b3b1eb2707145b92f8aea8343dba`.
- Esta compilación ya está en disco. No se reinició la instancia para activar
  el ajuste de teclado porque la tarea de diagnóstico había iniciado una
  comprobación de Gemini y el proceso esperaba respuesta del usuario al aviso
  protegido del Llavero. La cabecera visual ya está activa y verificada; la
  comprobación nativa del ajuste final de Escape queda pendiente del reinicio.
