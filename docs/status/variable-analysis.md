# Análisis de variables, tipos y Gemini

Implementación del encargo de las cuatro referencias, conservando explorador,
histogramas, selección estable, sidecars y drag existentes. Estado actual: código
integrado en la compilación conjunta, pruebas automáticas y recorrido nativo local
completado en QA2. QA4 detecta la clave guardada; la lectura explícita del secreto
sigue esperando autorización del Llavero. Las dos inferencias Gemini de esta
funcionalidad quedan pendientes de esa autorización. No atribuir las pruebas
mock o los GET models de otras tareas a Gemini real de análisis.

## Comportamiento

- Botón **Σ** por variable. Numéricas/fechas: mínimo, P25, mediana, media, P75 y
  máximo, más válidos/vacíos/distintos. Categóricas/texto/listas: conteos. Los
  agregados cubren todas las filas que cumplen los filtros; no se estiman desde
  los bins ni desde la página. `count` y `distinct` excluyen nulos; los valores
  numéricos no finitos cuentan como ausentes. `quantile_cont` usa interpolación
  lineal y precisión del tipo nativo de DuckDB; media usa su precisión nativa.
- Menú de tipo: **Auto, Número, Fecha, Categoría, Lista, Texto**. Previsualización
  nativa de inválidos antes de confirmar. La proyección `dl_data` se construye
  sobre `dl_raw`: conserva originales y aplica la misma conversión a filas,
  filtros, gráficos, entradas a enriquecimientos y exportaciones.
- Enteros se convierten a BIGINT o DECIMAL(38,0), preservando IDs de 30 dígitos
  incluso en Parquet. La mezcla de decimales con enteros inseguros para DOUBLE
  se rechaza con un error explícito. Tokens fuera de rango/inválidos se contabilizan
  en la previsualización como nuevos vacíos, recuperables mediante Auto.
- Tipo y revisión persisten separados de la vista en el sidecar. El autoguardado
  de vista/definiciones no elimina overrides. Un cast cambia la revisión sin
  cambiar RowId; una previsualización obsoleta no puede aplicarse. El comando
  bloquea casts si hay runners o trabajos queued/running; evita respuestas de
  enriquecimiento en vuelo durante una mutación de tipos.
- Rol analítico independiente: **Objetivo, Accionable, Explicativa, Identificador**,
  con iconos SVG. Grupo temático editable, cabeceras plegables y filtros por
  grupo/rol/búsqueda. Preferencias en `variablePanel`. Un drag entre grupos adopta
  el grupo destino y conserva el rol. No sobrescribe otros roles al clasificar.
- **Clasificar** llama una vez a Gemini con nombres/tipos de 1–128 columnas
  seleccionadas. Propuesta editable antes de aplicar; máximo 8192 tokens de salida.
  Modelo editable, predeterminado `gemini-3.8-flash`: la documentación oficial
  del 22 de septiembre limita 2.5 a cuentas que lo utilizaban previamente.
- **Filtrar con IA** envía nombres/tipos seleccionados y petición (máx. 4000
  caracteres); máximo 4096 tokens de salida. Devuelve y valida `Filter[]` tipado:
  solo columnas seleccionadas, tipos compatibles, IDs únicos, límites de tamaño.
  No ejecuta SQL/código generado. Propuesta revisable antes de aplicar; combina
  con filtros existentes sustituyendo solo las variables incluidas.
- El contrato actual de filtros admite rangos inclusivos, fechas, categorías,
  listas y búsqueda textual any/all. No permite NOT, OR entre columnas, nulos ni
  comparaciones estrictas. El prompt exige explicar peticiones no expresables,
  sin aplicarlas como una aproximación silenciosa.
- Clave de Gemini en el Llavero común de Datolens. Sin claves en sidecars/logs,
  sin filas enviadas, sin llamadas automáticas al abrir un dataset. Se reutiliza
  el helper HTTPS de enriquecimientos, con timeout y sin reintentos ocultos.

## Verificación

- Suite nativa de datos: **27 PASS**, 1 benchmark omitido intencionadamente;
  [recibo](../qa/features-data-tests.txt). Incluye cuatro pruebas nuevas de
  estadísticos/casts/IDs/export/persistencia/Auto y las cinco de Plot.
- Integración verifica **6 PASS** en `features-root-tests.txt`, incluidas dos
  pruebas del validador de clasificación/filtros de `analysis.rs`.
- Tras ampliar los totales de Plot, su suite separada verifica **6 PASS** en
  `features-plot-totals-tests.txt`; el conjunto cubierto queda en 28 pruebas
  nativas de datos, sin repetir las 22 que no cambiaron.
- Modelo frontend: **16 PASS / 59 assertions** tras añadir agrupación/filtros y
  drag entre grupos (junto a regresiones del explorador).
- Navegador con fixture explícito de 240 filas: iconos/menú de roles, asignar
  Objetivo, crear grupo Precio y valoración, filtrar por Objetivo conserva solo
  Facturación. Se corrigió un cierre involuntario del menú al enfocarlo tras
  scroll. Las cifras del fixture no son evidencia de consultas nativas.
- App macOS `com.victoriano.datolens.integrationqa`, bundle QA2, CSV sintético
  de seis filas: estadísticas exactas de precio y recalculadas tras filtro;
  conversión Número con previsualización de un inválido y Auto recuperando el
  texto original; rol Objetivo, grupo temático, arrastre real entre grupos,
  filtro de variables por rol y persistencia tras reabrir. Detalles y valores
  esperados/observados en [recibo nativo](../qa/variable-analysis-native.md).
- Gemini de análisis: **0 llamadas reales**. En QA2 el diálogo permanecía en
  `Checking Gemini…`. Integración corrigió `has_provider_key` para consultar
  atributos sin leer el secreto; QA4 muestra la clave conectada. El único intento
  explícito posterior de Enriquecimientos sigue detenido en `SecItemCopyMatching`,
  antes de llegar a Gemini. Integración cierra esta comprobación como pendiente
  de autorización del Llavero, sin repetir las dos llamadas de análisis que
  encuentran la misma barrera. No se han copiado claves ni cambiado permisos.

## Propiedad y coordinación

Cesiones explícitas recibidas de datos y del owner del sidecar/drag. Integración
escribe contratos, plataforma, `lib.rs` y `ExplorerApp.tsx`; este trabajo escribe
`analysis.rs`, tipos/store/pruebas de datos y componentes/modelo del explorador.
Traducciones/tema se coordinan con su owner. Sin commits, pushes o publicación.

Referencia técnica del proveedor: [GenerationConfig y salida JSON estructurada
de Gemini](https://ai.google.dev/api/generate-content#v1beta.GenerationConfig).
Disponibilidad del modelo predeterminado:
[calendario oficial de modelos](https://ai.google.dev/gemini-api/docs/deprecations).

## Selector Jev y Gemini Flash (2026-09-23)

- Clasificar variables selecciona `jev-latest` de inicio. Jev recibe solo nombres,
  tipos e IDs y responde, en una consulta, dos preguntas Choice por variable:
  rol analítico y grupo de un catálogo cerrado. Los resultados siguen siendo
  editables antes de aplicarse. Gemini conserva la propuesta de grupos libres.
- El menú ofrece Jev primero y modelos Gemini Flash. Muestra una lista local
  inicial; «Actualizar modelos disponibles» consulta explícitamente los modelos
  de las cuentas configuradas mediante los endpoints oficiales de cada proveedor.
  Las claves se guardan desde el propio diálogo en Keychain. La consulta de
  modelos no envía el esquema del dataset.
- Filtrar con lenguaje natural continúa usando Gemini, ya que Jev no produce
  filtros estructurados de formato libre. No se han hecho peticiones reales de
  clasificación ni de listado de modelos con las claves del usuario en esta tarea.
- Verificación: `bun run check` pasó; las 3 pruebas nativas de `analysis::tests`
  pasaron con la biblioteca DuckDB del bundle en `DYLD_LIBRARY_PATH`. La prueba
  nueva comprueba el cuerpo Choice y rechaza roles desconocidos. En la app macOS
  se observó Jev como valor inicial y el desplegable con Jev antes de Flash;
  cambiar a Gemini actualizó el proveedor visible. En la vista de fixture,
  sin claves, aparecieron los dos formularios de Keychain. No se guardaron
  claves durante la prueba.
