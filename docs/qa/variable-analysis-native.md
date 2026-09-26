# Recorrido nativo de análisis de variables

Fecha: 2026-09-22. App: **Datolens Integration QA**, identificador
`com.victoriano.datolens.integrationqa`, bundle conjunto QA2.

Control por CUA sobre la app macOS real. Datos sintéticos en
`/tmp/datolens-analysis-qa/variables.csv`, seis filas. Sin inyección de estado
JavaScript ni sustitución de IPC por mocks. La apertura usa el selector nativo.

## Estadísticas y conversiones

1. Abrir Σ de `precio` y modo Explorar: **100 / 200 / 300 / 300 / 400 / 500**
   para Min/P25/Mediana/Media/P75/Max; **5 válidos, 1 vacío, 5 distintos**.
2. Menú de `importe_texto` muestra Auto, Number, Date, Category, List y Text.
   Seleccionar Number: previsualización **1 de 5 valores no vacíos** pasa a vacío.
3. Aplicar: icono/tipo Number e histograma numérico. Σ devuelve **2 / 3.125 /
   3.75 / 4.875 / 5.5 / 10** y **4 válidos, 2 vacíos, 4 distintos**.
4. Volver a Auto: previsualización **0 de 5**; aplicar devuelve Category,
   recupera la categoría literal `error` y **5 válidos, 1 vacío, 5 distintos**.
5. Filtro manual de `precio` entre 200 y 400: **3 de 6 filas**, alcance
   `Filtered rows`, estadísticos **200 / 250 / 300 / 300 / 350 / 400** y
   **3 válidos, 0 vacíos, 3 distintos**.

## Grupos, roles, arrastre y persistencia

1. Asignar a `precio` el rol Target y el grupo `Precio y valoración`.
2. App muestra Ungrouped (5) y Precio y valoración (1).
3. Arrastrar realmente el grip de `importe_texto` hasta la tarjeta `precio`:
   grupos pasan a **4 y 2**. `importe_texto` queda con rol Feature, `precio`
   conserva Target. El arrastre termina sin ghost ni error.
4. Selector de roles → Target: **1 variable**, `precio`, dentro de su grupo;
   la cantidad de filas no cambia por filtrar variables.
5. Reabrir el mismo CSV desde el nombre del archivo: se conservan modo Explorar,
   Target, grupo, Σ y filtro numérico, con los mismos estadísticos y 3 de 6 filas.
6. Lectura del sidecar confirma los dos metadatos de grupo/rol, el orden tras
   arrastre, ambos estadísticos abiertos, `roleFilter: target`, el filtro
   numérico, `typeRevision: 2` y `columnTypes: {}` después de volver a Auto.

## Gemini: comprobación inicial y cierre de QA4

Abrir Clasificar después del recorrido: permanece `Checking Gemini…` y
`Suggest classification` deshabilitado. No se pulsa generación: **0 llamadas**.
La app se deja operativa tras cerrar el diálogo. No aparece un aviso de Llavero
en el inventario de apps, árbol AX ni captura de la ventana; esto no prueba que
no haya una espera del sistema fuera de la ventana. La investigación del acceso
a credenciales está coordinada con Integración y Enriquecimientos. Sin copiar
secretos, introducir contraseñas ni alterar ACL.

Integración corrigió la comprobación de existencia para consultar únicamente
atributos. En QA4 Enriquecimientos confirma claves detectadas (`Connected`), pero
el único intento explícito queda detenido en `SecItemCopyMatching` antes de
contactar al proveedor. Computer Use devolvió exactamente: “Computer Use is not
allowed to use the app 'com.apple.SecurityAgent' for safety reasons.” Es una
restricción de la herramienta, no una denegación del usuario ni un rechazo de
auto-review de shell. No se alteró el Llavero ni se
introdujeron contraseñas. Integración indica no repetir las dos llamadas de
análisis porque comparten la misma barrera.

Resultado: estadísticas, casts/Auto, grupos, filtro por rol, arrastre y
persistencia **PASS nativo**. Clasificación y filtro NL están implementados,
con validadores probados, y **pendientes de inferencia real por autorización del
Llavero**. El modelo predeterminado de la compilación final es
`gemini-3.8-flash`. Ninguna prueba del proveedor de otras tareas se atribuye a
estas dos funciones.
