# Datolens — verificación del MVP macOS

## CLI y documentos — 25 de septiembre de 2026

El bundle instalado en `/Applications/Datolens.app` abrió desde `datolens` un
CSV y un Parquet en pestañas separadas; el Parquet mostró 1.200 filas. La app
aislada con App Sandbox abrió un CSV externo de 1.200 filas, persistió el
bookmark con modo 0600 y lo reabrió tras reiniciar sin selector. Suites del
corte: Rust 46 PASS, frontend 121 PASS / 2332 aserciones, CLI 2 PASS y guardas
de bundle 4 PASS. El PKG directo y el Cask están preparados, no publicados; el
binario exacto de TestFlight/App Store sigue pendiente. Evidencia y límite del
sidecar hermano: [estado CLI](status/cli-file-opening.md).

## SAV del CIS — 23 de septiembre de 2026

La nueva importación SPSS se comprobó con un fixture `.sav` creado para pruebas y con `66091222.sav`, un microdato real del CIS encontrado en el Mac. El motor devolvió 15.242 filas, 155 columnas y 148 variables con etiquetas. Se verificaron página, distribución, filtro por código y conservación byte a byte del original. En `Datolens SAV QA.app` se abrió mediante el selector nativo y se vieron las 15.242 filas, las 155 columnas y valores como `1 · Andalucía` y `2 · Mujer`. La compilación de QA consta en [sav-build.txt](qa/sav-build.txt) y la del bundle principal firmado en [sav-main-build.txt](qa/sav-main-build.txt).

Los códigos perdidos definidos en SPSS permanecen como códigos etiquetados y participan en agregados; los perdidos del sistema aparecen como nulos. Algunas etiquetas del archivo real muestran `â?¬` en lugar de `€`: la secuencia dañada `E2 3F AC` está en el `.sav` original.

Fecha: 22 de septiembre de 2026. Bundle real compilado, arrancado y probado mediante
accesibilidad y capturas de su ventana macOS. No se considera un build web como
sustituto de esta comprobación.

## Ampliación del 23 de septiembre — verificada

- Workspace: pestañas por archivo/hoja, consultas locales y resultados Parquet
  persistentes. QA nativa de archivos, dos hojas Excel, join y reinicio PASS:
  [recibo workspace](qa/workspace-native.md).
- Derivadas: expresiones escalares validadas, preview de tres filas y creación
  explícita como columnas vivas. Dos fórmulas independientes y reapertura nativas
  PASS sin API ni credenciales: [recibo enriquecimientos](status/enrichment.md).
- Datos: 43 PASS, 2 ignoradas; enriquecimientos: 24 PASS; root/IPC: 7 PASS;
  frontend: 45 PASS / 1640 aserciones. Total: 119 pruebas pasadas.
  Logs `qa/workspace-derived-{root,frontend}-tests.txt` y recibos de módulos.
- Bundle principal conjunto compilado y firmado; `qa/workspace-derived-main-build.txt`.
  Se cerró la instancia anterior y se abrió la ruta exacta del bundle actualizado.
- Pase final nativo PASS: edición de alias sin asignar rol, cuartiles globales,
  edición decimal exacta, fechas UTC/offset corto, búsqueda y scroll de Columnas,
  persistencia tras reinicio. [Recibo final](qa/workspace-derived-final-native.md).
- La app queda abierta en el archivo previo del usuario, 338 filas × 10 columnas.
  Se cerraron el fixture y la instancia Integration QA.
- Gemini/Jev reales conservan las pruebas CLI del corte anterior; la ruta IA
  nativa sigue pendiente de autorización de lectura del Llavero de macOS.

## Entorno y bundle

### Corte anterior del 22 de septiembre

La entrega base descrita debajo precede a las funciones de análisis, gráficos,
Jev, idioma y temas. Su integración se validó en un bundle separado:
`Datolens Integration QA.app` (`com.victoriano.datolens.integrationqa`).
El bundle principal actualizado ya se ha generado y firmado: 166 MiB,
`src-tauri/target/debug/bundle/macos/Datolens.app`; compilación y firma PASS en
`qa/features-build-macos.txt`. Se cerró la instancia principal anterior con ⌘Q
y se abrió la ruta exacta del bundle final. Recuperó Idealista 94.815 × 41,
su vista y siete variables ocultas, con los controles nuevos visibles. Inspección
AX y captura macOS PASS. La instancia QA quedó cerrada.

| Área | Evidencia actual |
| --- | --- |
| Root/IPC | 6 pruebas Rust PASS, `qa/features-root-tests.txt` |
| Datos, casts y gráficos | 28 pruebas PASS, 1 benchmark ignorado; `qa/features-data-tests.txt` y `qa/features-plot-totals-tests.txt` |
| Enriquecimiento | 22 pruebas PASS y llamadas reales CLI Gemini/Jev/web; `status/enrichment.md` |
| Modelos frontend e idiomas | 30 pruebas PASS / 1546 aserciones, `qa/features-frontend-tests.txt` |
| Archivo/Finder/selector | Recorrido nativo PASS, `qa/file-actions-native.txt` |
| Estadísticas/casts/grupos | Recorrido nativo local PASS, `qa/variable-analysis-native.md` |
| Gráficos | Barras, filtro 60/240, pivot con totales, correlación/regresión, exportación SVG/PNG/CSV y persistencia de cuatro gráficos PASS; QA4 confirma huecos sin puntos falsos, tooltip derivado y CSV EN; `status/plots.md` |
| Idiomas/temas | ES/EN × claro/oscuro, menús nativos, reinicio y Oscuro→Sistema PASS; `status/ui-preferences.md` |
| IA desde la app | QA4 muestra Connected; único intento explícito bloqueado en lectura protegida del Llavero antes de HTTP, 0 llamadas nuevas. Preview/lote/clasificación/filtro IA nativos pendientes; `qa/features-keychain-pending.txt` |

Se corrigió la consulta de existencia de claves: ahora solicita solo atributos,
sin descifrar el secreto al abrir un dataset. La lectura del secreto sigue ligada
a una acción explícita que usa el proveedor. No se alteraron ACL del Llavero.
El rechazo al intentar inspeccionar el diálogo fue una restricción de Computer
Use, no una denegación del usuario: `Computer Use is not allowed to use the app
'com.apple.SecurityAgent' for safety reasons.`

### Entrega base

- Mac14,2, Apple Silicon arm64, 16 GiB RAM; macOS 27.0 (26A428).
- Rust 1.98.1; Bun 1.2.8; Tauri 2.11.6; React 19.3.0; DuckDB 1.5.5.
- Bundle: `src-tauri/target/debug/bundle/macos/Datolens.app`, 163 MiB aparentes.
- `codesign --verify --deep --strict`: PASS. Firma ad hoc para uso local, sin notarización/distribución.
- `otool -L`: DuckDB enlazado por `@rpath/libduckdb.dylib`, incluido en `Contents/Frameworks`; sin dependencia de Homebrew ni ruta del workspace.
- Perfil local sin símbolos debug. DuckDB es la biblioteca oficial precompilada;
  checksum y procedencia en `vendor/duckdb/PROVENANCE.md`.
- El primer build falló por disco lleno. Se retiraron exclusivamente targets
  regenerables de este proyecto y se evitó compilar DuckDB desde C++.

## Pruebas automatizadas observadas

- TypeScript y build Vite: PASS.
- Explorador: 8 pruebas del modelo PASS (IDs, rangos, copia, vista, sorting).
- Integración Rust: **2 PASS**. Cadena A→B→C con requisitos, orden de tabla durante
  ejecución, resultado aplicado al ID original, exportación/reapertura Parquet,
  persistencia/reanudación sin repetir éxitos e invalidación de dependientes.
  Segunda regresión: reabrir un dataset ya en caché actualiza el último archivo.
- Datos: **12 PASS, 1 benchmark ignorado por defecto**, ejecutado explícitamente.
  CSV/XLSX/Parquet, precisión, sorting global, filtros/estadísticas, listas,
  nulos, persistencia versionada, fuentes cambiadas, exportación y outlier tardío.
  Dos regresiones adicionales cubren enteros CSV fuera de BIGINT, valores mixtos,
  exportación/reapertura CSV/Parquet y reparación de caché sin perder resultados
  ni vistas, incluyendo recuperación entre commit de base de datos y escritura JSON.
- Scheduler: **12 PASS**. DAG, ciclos, fallo parcial, revisión de prompt/entradas,
  cancelación, recuperación, historial, materialización idempotente y presupuesto.
- Comando repetible: `scripts/test-native.sh` (secuencial, un target compartido).
- Evidencia exacta: [native-tests.txt](qa/native-tests.txt),
  [integration-tests.txt](qa/integration-tests.txt), [build-macos.txt](qa/build-macos.txt).
  Corrección posterior de precisión: [datos](qa/csv-precision-tests.txt) y
  [integración](qa/csv-precision-integration.txt).

Los fallos de desarrollo quedaron corregidos antes de estos resultados: CSV
inferido solo desde las primeras filas, candidato HUGEINT no admitido por DuckDB,
y comparación de rutas `/var` frente a `/private/var` en una prueba macOS.

## Recorrido observado en Datolens.app

Fixtures reproducibles: `python3 scripts/create-fixtures.py`, en `fixtures/generated/`.

- **CSV:** 12 filas/6 columnas; ID `9007199254740993` exacto; facturación numérica,
  fecha DATE, booleanos y nulo en la cuarta fila observados.
- **Dos filtros:** `pais=ES` + `facturacion>=500` → **4 de 12 filas** (600, 700,
  900, 1200). Categoría ES muestra 4 seleccionadas de 6; FR/PT muestran 0.
  Histogramas y tabla coinciden.
- **Sorting:** `pais ASC`, `facturacion DESC` → 1200, 900, 700, 600. La prueba Rust
  complementa la comprobación visual y valida orden global fuera de la página.
- **Vista:** ocultar `activa`, mover `empresa` antes de `id`, ancho de `empresa`
  **259,6875 px**. El JSON persistido contiene exactamente esos cambios junto a
  los filtros y las dos prioridades de sorting. Reabrir el CSV en la misma app
  restauró 4/12 filas, orden y cinco columnas visibles.
- **Portapapeles:** copiar ID seleccionado y pegarlo en el buscador local produjo
  exactamente `9007199254741015`, sin redondeo.
- **Exportación:** la UI guardó `qa-filtrado.parquet`. Reabrirlo produjo 4/4 filas,
  cinco columnas, los mismos IDs, fechas y orden 1200, 900, 700, 600.
- **XLSX:** el selector ofreció `Empresas` y `Notas`; `Empresas` abrió 12 filas,
  conservó IDs textuales y nulo. Las fechas de este fixture son celdas de texto;
  la prueba Rust adicional cubre tipos de celdas XLSX.
- **Enriquecimiento UI:** crear `Resumen QA` con entrada exclusiva `empresa`;
  definición y nueva columna visibles. Plan de 12 filas → 12 llamadas previstas,
  límite 100; botón de ejecutar deshabilitado sin clave. Cero llamadas facturables.

- **Reinicio completo final:** cerrar con ⌘Q y volver a arrancar el bundle restaura
  `empresas.csv`, 4/12 filas, cinco columnas, `empresa` antes de `id`, anchura
  ampliada, filtros ES/≥500 y prioridades pais ASC/facturacion DESC. Árbol AX y
  captura confirman 1200, 900, 700, 600 después del reinicio.
- **CSV Idealista real:** 94.815 filas y 41 columnas, sin descartar el `NA` tardío.
  Filtrar `CADASTRALQUALITYID=NA` devuelve una fila. Detalle y comprobación
  independiente en [csv-import-bug.md](status/csv-import-bug.md). Reiniciar la
  versión final también restauró ese archivo completo, sin filtros.
- **Categorías limitadas:** el bundle final muestra «Primeras 256 categorías por
  frecuencia» para ASSETID, observado tras el reinicio.
- **Precisión CSV corregida, bundle v3:** `fixtures/generated/csv-precision.csv`
  abre 5/5 filas y dos columnas. Se observan completos y distintos
  `9223372036854775808`, `9223372036854775809`, `18446744073709551615`,
  `123456789012345678901234567890` y `-9223372036854775809`.
  El filtro del segundo ID devuelve 1/5, sin incluir el primero. Copiar el entero
  de 30 dígitos y pegar en el buscador local devuelve exactamente sus 30 dígitos.
  La columna amount sigue numérica, con 1.25, 2.5, 3.75, 4.5 y 5.25.
- **Recuperación de apertura, paquete conjunto final:** abrir el fixture local
  `retry-open.csv`, cerrar la app y retirar temporalmente solo ese fixture.
  El arranque muestra el error de archivo ausente. Tras reponerlo, **Reintentar**
  abre 5/5 filas y dos columnas, con enteros exactos y sin banner de error.
  Antes del parche, el mismo recorrido solo quitaba el error y no abría datos.
  Al terminar se volvió a abrir Idealista: 94.815/94.815 filas y 41 columnas.
  TypeScript y las ocho pruebas existentes del explorador pasan. Las barreras
  de teclado/copia durante `busy` están implementadas y revisadas; no se atribuye
  a este recorrido una prueba manual de teclado durante una consulta pendiente.

Una apertura automatizada en segundo plano pareció detenida durante la QA. Al
activar realmente la ventana completó la restauración. No se reprodujo un
deadlock del motor; el reinicio final y la restauración de ambos CSV completaron.

## Rendimiento nativo

Una medición por escenario, proyecto/cache de importación nuevo. Archivos
generados previamente; caché del sistema **no vaciada**. No son mediciones de
lectura física fría. El máximo RSS corresponde al proceso nativo del benchmark,
no al total de WebKit + shell de la app. Sin build concurrente durante la medición.

| Formato | Filas | Archivo | Primera página, incluida apertura | Filtro + sorting de dos claves | Distribuciones (2 columnas) | Máximo RSS |
|---|---:|---:|---:|---:|---:|---:|
| Parquet | 1.000.000 | 8.031.890 B | 57 ms | 33 ms | 51 ms | 46,2 MiB |
| CSV | 1.000.000 | 18.566.689 B | 2.727 ms | 29 ms | 52 ms | 102,3 MiB |
| Parquet | 5.000.000 | 39.033.081 B | 65 ms | 164 ms | 225 ms | 48,4 MiB |

La medición CSV se repitió con la protección de enteros fuera de BIGINT: 2.727 ms
frente a 1.052 ms antes de esa comprobación adicional. Parquet no cambió.
El CSV necesita inferencia completa e importación inicial para preservar los
valores tardíos. Parquet conserva un scan nativo sobre el archivo. DuckDB limita
su memoria de trabajo a 512 MB y usa dos hilos; JavaScript recibe páginas de 100
filas y distribuciones, nunca el dataset entero.

Evidencia: [Parquet 1M](qa/benchmark-parquet-1m.txt),
[CSV 1M](qa/benchmark-csv-1m.txt), [Parquet 5M](qa/benchmark-parquet-5m.txt).
Generación mayor: `python3 scripts/create-large-fixtures.py`;
runner: `src-tauri/examples/benchmark.rs`. Para `time`, situar `DYLD_LIBRARY_PATH`
después del ejecutable del sistema: `/usr/bin/time -l /usr/bin/env DYLD_LIBRARY_PATH=... <runner> <archivo>`.

## Límites explícitos

- La pérdida de precisión CSV fuera de BIGINT fue reproducida y corregida:
  `9223372036854775808` y `9223372036854775809` antes colapsaban como DOUBLE.
  Ahora se inspeccionan los tokens originales de todas las filas antes de esa
  conversión; una columna DOUBLE con tokens enteros fuera de ±(2^53−1) se conserva como VARCHAR,
  incluso si mezcla decimales; cubre también enteros dentro de BIGINT que una
  mezcla decimal habría convertido a DOUBLE. Otras columnas decimales siguen numéricas.
  Las cachés anteriores se reimportan una vez, conservando IDs de fila, vistas,
  definiciones y resultados. Los planes/fingerprints de columnas reparadas reciben
  una revisión diferente y necesitan recalcularse; no se lanzan llamadas al abrir.
  [Reproducción anterior](qa/csv-integer-precision-before.txt).
- **Gemini real no probado**: falta clave del usuario configurada en la app. El
  proveedor está implementado; las pruebas de ejecución usan un proveedor
  determinista. Lectura de ausencia de clave y bloqueo de UI sí observados.
- No se probó escritura de una clave real en Keychain ni una petición facturable.
- XLSX carga una hoja en memoria mediante Calamine; no promete streaming de hojas
  enormes. Rango rectangular dentro de una página; filas acumulables entre páginas.
- No hay editor de JSON Schema arbitrario: salidas validadas por tipo.
- Historial de celdas local sin paginación para sesiones largas; no hay garantía
  exactly-once remota ante cierres en mitad de una llamada.
- Distribuciones categóricas limitadas a top 256; Uplift/TF-IDF ordenan esos bins.
  No hay grupos de variables ni overrides manuales de tipo en este MVP.
- Nulos visibles pero sin filtro de nulos en el contrato actual.
- Drag-and-drop conectado al evento nativo Tauri; el recorrido documentado usó
  selector macOS. No se registra como probado mediante un arrastre Finder real.
- Windows, stores, firma de distribución y «Jev» quedan fuera de lo validado.
