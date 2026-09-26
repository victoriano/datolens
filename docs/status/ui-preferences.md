# Idiomas y apariencia — 22 septiembre 2026

Petición: interfaz en español e inglés, con temas claro y oscuro.

Implementado:

- Selectores accesibles de idioma (Español/English) y apariencia
  (Claro/Oscuro/Sistema) en la cabecera, también sin archivo abierto.
- Preferencias locales versionadas (`datolens.ui.v1`), recuperación ante valores
  inválidos o almacenamiento no disponible, y sincronización entre ventanas.
  El primer arranque sigue el idioma compatible del sistema y su apariencia.
- Cambio sin remontar el explorador: conserva archivo, selección, filtros,
  borradores y consultas. Solo se guardan idioma y apariencia en estas preferencias.
- `html.lang`, controles nativos HTML y apariencia de la ventana Tauri responden
  a la elección. Sistema sigue cambios de apariencia de macOS.
- Menú predeterminado de Tauri localizado en español/inglés conservando items,
  acciones y atajos nativos. Permisos ya incluidos en `core:default`; los items
  gestionados por macOS que no exponen un texto editable se conservan.
- Catálogo ES/EN compartido para explorador, menús de variables, estadísticas,
  análisis, enriquecimientos, estados y catálogo/configuración de gráficos.
  Los valores del archivo, identificadores, nombres y textos libres se conservan.
- Números y fechas de la interfaz se formatean según el idioma. La tabla mantiene
  los valores exactos del archivo; el portapapeles y la exportación no se traducen.
- Tokens de superficies, texto, selección, errores y foco en ambos temas, incluidos
  menús, diálogos, tablas y enriquecimiento. Histogramas con colores y locale por
  vista Vega. Los gráficos guardados conservan su fondo/tema elegido.

Coordinación: integración aplicó provider, selectores, permiso de ventana y el
parche `docs/patches/ui-explorer.patch`. Los propietarios de Analysis y Enrichment
cedieron componentes para el pase de traducción. Plot incorporó sus llamadas a
`t()` y mantuvo propiedad de sus archivos. No se modificaron motores ni contratos
de datos para el idioma o tema. No se instalaron dependencias.

Verificación realizada:

- `bun run check`: PASS.
- 5 pruebas de preferencias/traducción: PASS (persistencia, defaults, fallos de
  almacenamiento, preservación de parámetros e identificadores y campos de todas
  las traducciones).
- 12 pruebas del explorador + 4 de análisis + 8 de gráficos: PASS. Último pase
  conjunto: 29 pruebas, 0 fallos y 1541 aserciones.
- Auditoría AST: sin textos JSX ni atributos estáticos visibles pendientes de
  localizar; 62 etiquetas/descripciones de catálogos de gráficos/roles cubiertas.
- `git diff --check`: PASS.

Verificación nativa realizada con CUA en `Datolens Integration QA.app` (QA3):

- Español/claro, español/oscuro, inglés/claro e inglés/oscuro: PASS, con revisión
  visual y árbol de accesibilidad. Tabla, selección, filtros, panel de variables,
  histogramas y enriquecimiento mantienen superficies y textos legibles.
- CSV sintético de 6 filas, filtro Ciudad=Madrid (3/6) y tres filas seleccionadas:
  todas las combinaciones conservan filtro, selección y valores. Acentos y los
  identificadores de 30 dígitos se mantienen exactos. El texto libre del formulario
  de enriquecimiento permanece en español al cambiar la interfaz a inglés.
- Diálogo Filtrar con IA y menú Columnas revisados en oscuro. No se ejecutó IA.
- Menú nativo Archivo/Edición/Ver/Ventana/Ayuda y Deshacer/Rehacer/Cortar/Copiar/
  Pegar/Seleccionar todo traducen al español y restauran inglés.
- CmdQ y nueva apertura: conserva Español/Oscuro, restaura el archivo y el filtro
  3/6. La selección de filas es transitoria al reiniciar, como antes del cambio.
- Gráfico guardado de fondo claro mantiene texto/ejes legibles dentro de la app
  oscura. Se conserva el tema propio del gráfico.
- SHA256 de `/tmp/datolens-ui-appearance.csv` idéntico antes/después:
  `5488fe9e1fd3ed1b4f8e73525f76ba9e7e6291da36f4fd84b26e1099643f4c91`.
- QA3 devuelta a su fixture anterior `/tmp/datolens-plots-qa.csv`, gráfico
  QA Relación y preferencias English/System. CUA liberado al coordinador.

Ajustes posteriores al pase QA3: frase de alcance Gemini en inglés; etiqueta
Observada/Observed; modo Sistema pasa `null` a `Window.setTheme`, según el contrato
del API Tauri instalado. Esto permite que macOS siga controlando la apariencia
nativa y que los cambios alcancen `prefers-color-scheme`. El provider depende de
la preferencia, incluso si Claro/Oscuro y Sistema resuelven al mismo color.

QA4 firmada: smoke Sistema→Oscuro→Sistema PASS en app nativa. El arranque con
Sistema resuelve claro; Oscuro cambia toda la ventana/interfaz; Sistema recupera
el claro del Mac. Capturas y AX de los tres estados, sin alterar el gráfico
guardado ni sus 240 filas. App abierta EN/System y CUA devuelto a integración.
No quedan comprobaciones propias de idiomas/temas pendientes.

Entrega: integración compiló y verificó la firma del bundle principal
`src-tauri/target/debug/bundle/macos/Datolens.app`, con todas las fuentes congeladas
de QA4 (`docs/qa/features-build-macos.txt`). Confirmados el ejecutable y el log de
empaquetado. En el momento de este recibo la instancia principal abierta sigue
siendo la anterior; integración coordina su reinicio al terminar los turnos CUA.
La salida libre de Gemini/Jev y los mensajes arbitrarios de proveedores/sistema
no se retraducen; su contenido se conserva. Los controles propiedad de macOS,
como AutoFill o el panel de archivos, siguen el idioma configurado en el sistema.

## Actualización de cabecera y Ajustes — 23 septiembre 2026

- Idioma y apariencia pasan de la cabecera a Ajustes. El menú nativo de la app
  ofrece `Ajustes…` / `Settings…` (`⌘,`); el icono de engranaje de la cabecera
  abre el mismo diálogo.
- El diálogo reúne Gemini y Jev: estado de la clave, sustitución, eliminación y
  comprobación de acceso al Llavero. Sigue usando los comandos Keychain existentes;
  no guarda claves en preferencias ni las muestra después de guardarlas.
- La cabecera ya no repite el nombre del archivo, el estado de guardado ni el
  botón de apertura. Las pestañas muestran los archivos y su `+` abre más fuentes.
  Los avisos de fallos de guardado siguen visibles cuando corresponda.
- `bun run check`, `bun run build` y build nativo de `Datolens Settings QA.app`:
  correctos. En la app de prueba se verificaron el icono de Ajustes, el item
  nativo del menú, el contenido del diálogo, el cambio a español y el tema oscuro.
  No se escribieron ni eliminaron claves reales durante QA. El botón final de
  comprobación de acceso al Llavero pasó `bun run check`, pero no se activó en QA
  para evitar avisos del sistema sobre las claves existentes.
