# Acciones del archivo en la cabecera — 22 septiembre 2026

Petición: pulsar el icono del documento abre su carpeta contenedora en Finder;
pulsar el nombre abre el selector nativo de macOS con el archivo actual seleccionado.

## Entrega para integración

- Módulo propio nuevo: `src-tauri/src/source_file.rs`. Resuelve la ruta desde la
  sesión abierta, ejecuta `/usr/bin/open -R` fuera del hilo de interfaz, pasa la
  ruta como argumento independiente y devuelve errores si falta el original o
  Finder no puede abrirse.
- Parche para el escritor de integración: `docs/patches/file-actions.patch`.
  Modifica únicamente contratos, adaptador, registro del comando, cabecera/open
  del explorador y estilos del título. No requiere dependencias ni permisos nuevos.
- `selectDatasetPath(defaultPath?: string)` sigue aceptando llamadas sin argumento.
  `revealDatasetSource?(datasetId: string)` es opcional para conservar los fixtures.
- Dos botones accesibles independientes, con foco visible. El wrapper de arrastre
  existente excluye botones y, por tanto, no intercepta estos clics.
- Cancelar el diálogo devuelve `null` sin cambiar el dataset, la vista ni la selección.

## Estado de verificación

- `git apply --check docs/patches/file-actions.patch`: correcto contra el árbol al
  preparar la entrega. El responsable de integración confirmó que aplicó el
  parche a fuentes compartidas y registró el comando nativo.
- `bun run check` con el parche aplicado a una copia temporal del frontend:
  correcto (`docs/qa/file-actions-typecheck.txt`), sin modificar fuentes compartidas.
- Bundle nativo compilado y firmado por integración:
  `src-tauri/target/debug/bundle/macos/Datolens Integration QA.app`, identificador
  `com.victoriano.datolens.integrationqa`. Log: `docs/qa/features-qa-build.txt`.
- Verificación real mediante CUA en esa instancia: ambos clics, selección inicial
  del panel, aceptar/cancelar, cambio de archivo y error/reintento comprobados.
  Recibo detallado: `docs/qa/file-actions-native.txt`.
- No se cerró ni se modificó la sesión de la app principal del usuario. Tampoco
  se operó `Datolens Drag QA.app`.
- Integración confirmó el bundle principal actualizado y su firma verificada:
  `src-tauri/target/debug/bundle/macos/Datolens.app`.
  Log: `docs/qa/features-build-macos.txt`. Incluye las fuentes congeladas de QA4.
  La instancia principal abierta todavía corresponde a la versión anterior;
  integración coordina su reinicio tras los turnos de CUA pendientes.

## Comprobación nativa realizada

1. `datos á con espacios #1.csv`: 3 filas cargadas. Clic en icono abre Finder en
   `datolens-file-actions-fixtures` y selecciona ese CSV (AX y captura).
2. Clic en nombre abre `NSOpenPanel` en esa carpeta con el CSV seleccionado y
   `Open` habilitado. Confirmar el mismo fichero conserva las 3 filas.
3. Elegir `segundo archivo.csv` desde el selector cambia el documento a 1 fila.
   Volver a pulsar su nombre preselecciona el segundo fichero, no el anterior.
4. Cancelar conserva documento y selección: antes y después figura la celda
   `Segundo` seleccionada y el contador `1 celdas`, con `1 de 1 filas`.
5. Mover temporalmente solo el segundo fixture produce el aviso de original
   ausente. Restaurarlo y pulsar `Reintentar` elimina el error y abre Finder con
   ese fichero seleccionado. El fixture quedó restaurado.

El primer intento de inspeccionar Finder mostró otro fichero seleccionado y
un cambio ajeno de foco/orden en el inspector. Se trató como observación
inconclusa, se coordinó la pausa de otras acciones CUA y se repitió con estados
frescos; las selecciones correctas quedaron confirmadas por AX y capturas.
No se identificó un fallo reproducible en estas acciones.
