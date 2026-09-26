# Previsualización al reordenar variables

## Implementado

- Tarjeta flotante que sigue al puntero, conserva el histograma y muestra una
  sombra discreta y su posición de destino.
- Hueco azul discontinuo con «Soltar aquí», y desplazamiento de las vecinas con
  animaciones de 170 ms. La misma interacción sirve en cuadrícula y panel lateral.
- El layout provisional usa CSS order sin modificar la vista guardada. Al soltar
  se confirma el orden; Escape cancela el gesto sin salir de Explorar. Se limpian
  el clon, los estilos provisionales y los listeners al terminar o cancelar.
- Se respeta prefers-reduced-motion: se mantiene la señal de destino sin animar
  las tarjetas. Se anuncia el movimiento mediante aria-live.
- Corrección de orden con tarjetas fijadas: el resultado se calcula desde el
  orden visible, para coincidir con el hueco incluso si la tarjeta fijada estaba
  al final del orden original. Se conservan variables ocultas.

## Verificación de este cambio

- TypeScript y bundle macOS con firma ad hoc: PASS.
- Modelo: 12 pruebas, 46 aserciones, 0 fallos. Incluye regresión de tarjeta fijada
  con orden original distinto y una variable oculta.
- Navegador real, mismo componente: arrastre Empresa detrás de Ciudad; arrastre
  Sector a posición 2 manteniendo el puntero pulsado; hueco visible y tarjetas
  vecinas desplazadas; al soltar, orden exacto y cero clones/estilos order residuales.
- Escape durante un arrastre conserva el orden y el modo Explorar.
- Panel lateral, snapshot aislado: Empresa pasa delante de Identificador. Durante
  el gesto hay un clon, «Soltar aquí · 1» y cero animaciones al emular movimiento
  reducido. La preferencia emulada se retiró después.
- App nativa aislada com.victoriano.datolens.dragqa: visualizados el clon y el
  hueco con un CSV real de prueba (240 filas, 10 columnas). **El drop nativo nuevo
  no quedó confirmado de extremo a extremo**: CUA presentó fallos de posición de
  ventana/foco y entregas de eventos incompletas. El recorrido completo anterior
  se validó en navegador; integración debe repetir el gesto en su QA nativo final.

El usuario seguía usando la app principal; no se repuso una vista antigua sobre
sus cambios posteriores. La QA aislada usa datos artificiales y almacenamiento
propio. No se hicieron llamadas a IA ni cambios de credenciales.

## Corrección del 24 de septiembre

- La virtualización introdujo filas contenedoras; el `order` de cada tarjeta ya
  no podía desplazarla entre filas. En el panel virtualizado, el arrastre ahora
  marca el borde real de inserción en la tarjeta de destino y muestra una línea
  y «Soltar aquí» por encima de la tarjeta flotante. Si el borde queda fuera de
  la zona visible, la señal permanece dentro del panel.
- Verificado en navegador con el componente real y 246 variables: señal visible
  durante el arrastre en cuadrícula y panel lateral; el drop en cuadrícula cambia
  el orden. TypeScript y build web pasan. El bundle macOS se compiló y abrió con
  una tabla real; la comprobación del gesto nativo quedó pendiente porque la
  sesión de la app cambió de control durante la QA. No se alteró el orden de
  las variables de los datos del usuario.

## Corrección del 25 de septiembre

- El destino mostraba «Soltar aquí» dos veces: una etiqueta en la tarjeta y otra
  sobre la línea de inserción. Eliminada la primera; queda una sola señal.
- Verificación visual durante un arrastre en la cuadrícula con 246 variables:
  una etiqueta visible. TypeScript y build web pasan.
- Bundle macOS instalado mediante `scripts/build-macos.sh` y
  `--install-pending` con la app cerrada. `/Applications/Datolens.app` se reabrió
  y recuperó sus dos pestañas y la vista de Gráficos. No se repitió un arrastre
  nativo sobre los datos del usuario.

- Ajuste posterior: retirado también el segundo recuadro azul del destino. El
  origen queda como hueco neutro y solo la línea con «Soltar aquí» marca la
  inserción. Comprobado durante el arrastre en la cuadrícula de 246 variables;
  TypeScript y build pasan. Se volvió a instalar en `/Applications/Datolens.app`
  y se verificó que recupera ambas pestañas y la vista Explorar.

- La línea podía quedar en el borde de una tarjeta alta, lejos del gráfico que se
  arrastraba. Ahora sigue el borde superior de la tarjeta flotante y se recorta
  al panel. En la prueba visual quedó 4 px encima del gráfico (343,6 frente a
  347,6 px); Escape retiró clon y línea sin confirmar el cambio. Pasan TypeScript
  y build. Se instaló el nuevo bundle verificado en `/Applications/Datolens.app`
  con la app cerrada y se reabrió con sus dos pestañas en preparación.

## Rectificación de la señal de destino (25 de septiembre)

- El ajuste que pegaba la línea al clon era incorrecto y queda sustituido: la
  línea se ancla 6 px por encima de la tarjeta que ocupa el índice de destino,
  tanto al avanzar como al retroceder. Si está parcialmente fuera del viewport,
  la señal se limita al borde visible del panel. El clon sigue solo al puntero.
- Comprobado con el componente real en navegador: al mover el clon de
  (435, 573,6) a (500, 628,6), la línea permaneció en (437,3, 566,6), encima de
  la tarjeta de destino situada en y=572,6. El gesto se canceló con Escape.
- La prueba de este ajuste es de interfaz web; no acredita un drop nativo.
- TypeScript y bundle macOS pasan. Una compilación concurrente posterior
  instaló la versión compartida mientras la app estaba cerrada; se verificó
  la firma de `/Applications/Datolens.app` y que abre con ambas pestañas.

## Relevo coordinado

- Integración recibió contratos/IPC/plataforma/raíz/target y ExplorerApp.tsx.
- Analysis recibió Variables.tsx, model.ts/model.test.js, explorer.css y los dos
  módulos de drag para adaptar cabeceras y movimientos entre grupos. Los IDs del
  hook deben conservar el mismo orden que la proyección visual y el drop guardado.
- reconcileView preserva ahora saved.plots y workspace.mode=plots por solicitud
  de integración. Los campos opcionales de variablePanel ya se preservaban.
- Este recibo cubre la interacción anterior a las ampliaciones de grupos e i18n;
  esas integraciones requieren su propia comprobación final.
