# Crossfilters progresivos en fuentes anchas — 2026-09-23

Esta entrega sustituye la pausa de Auto remoto y el reservoir de todas las columnas descritos en las entregas anteriores. Petición: abrir gráficos visibles de PISA remoto (4.911 columnas, 191.254 filas) y aplicar la misma optimización a archivos locales grandes.

## Motor

- Muestra uniforme sin reemplazo de ordinales (Floyd + PRNG SplitMix64 fijo, sin recorrer valores de la fuente). Tamaño Auto existente, mismas filas para todas las variables y filtros; PISA usa 1.000. No usa las primeras N filas del archivo. Algoritmo versionado en la clave persistida.
- La tabla de muestra nace con identidad de fila solamente. Se incorporan columnas de las tarjetas solicitadas y de los filtros, por proyecciones de hasta 8. Reutilización transaccional en memoria y al reabrir; se invalidan cambios de tamaño, esquema, casts, fórmulas o resultados.
- Auto remoto ya devuelve distribuciones; modo Todas conserva las agregaciones exactas sobre la fuente proyectada. Conteos de la tabla, exportación y alcance IA no se muestrean.
- Caché nativa de distribuciones sin filtro acotada a 256 variables y de conteos de muestra a 16 selecciones. Los histogramas usan límites estables de la muestra.
- Parquet remoto: se habilita el prefetch por columnas de DuckDB 1.5.5. El código oficial `ParquetReader::InitializeScan` usa direct I/O remoto con ese modo; al deshabilitarlo entraba el read-ahead de HTTPFS y se leían repetidamente bloques vecinos de 1 MiB. Sigue `force_download=false`, threshold=0, revisión con If-Match, ETag y comprobaciones de cambios. No extensión adicional.
- Apertura local con más de 256 columnas: esquema físico sin miles de perfiles VARCHAR anticipados. Parquet mantiene ordinal sin cast para favorecer poda. La inferencia de listas codificadas dentro de VARCHAR no se adelanta para esas fuentes anchas; listas con tipo Parquet nativo conservan su tipo. Los casts explícitos siguen disponibles.

## Interfaz

- Solo se montan tarjetas del viewport y margen cercano, con alturas medidas y soporte de vista Explore en rejilla, búsqueda, grupos, fijación y tarjetas expandidas. Ordenación/búsqueda de metadatos pasan a Map/Set sin búsquedas cuadráticas por cada variable.
- Las columnas visibles se solicitan primero en lotes de dos; se publican resultados parciales, y la cola descarta solicitudes obsoletas antes de IPC.
- Caché cliente LRU de 256 variables por API; claves incluyen dataset/revisión, muestreo, filtros y estadísticas. Un cambio de filtro/tamaño/revisión no muestra distribuciones antiguas. Volver a una tarjeta en caché evita IPC y red.
- El panel deja de mostrar la pausa remota. Los conteos indican Muestra/Exacto. La clasificación de diferencias aclara cuando compara solo variables cargadas.

## Verificación automatizada

- Suite de datos completa: 55 PASS, 2 manuales ignoradas antes de añadir el último test HTTP; ese test junto a los cinco anteriores: 6 PASS. `docs/qa/progressive-data-tests.txt`, `progressive-remote-tests.txt`.
- Integración Rust: 14 PASS (`progressive-root-tests.txt`).
- Frontend: 42 PASS. Geometría de 4.911 tarjetas con ventana acotada, rejilla/grupos/búsqueda, prioridades, cancelación, caché e invalidación y límite de caché. `progressive-frontend-tests.txt`.
- Pruebas de persistencia verifican que dos variables guardan solo tres columnas (ordinal + dos valores); filtrar con una variable fuera de pantalla añade una sola columna más y conserva idénticos resultados tras reabrir.

Tráfico medido en servidor de pruebas con httpfs real y un Parquet de 9.013.742 bytes:

| Operación | Antes, prefetch deshabilitado | Después, prefetch por columnas |
| --- | ---: | ---: |
| Metadatos + muestra de 1.000 valores de category | 15.473.868 bytes | 90.695 bytes |
| Añadir filtro de id | — | 731.853 bytes acumulados |
| Repetir distribución guardada | — | 0 bytes de datos adicionales |

El antes se observó al fallar la aserción de presupuesto de red; se corrigió la causa y la prueba pasa sin aumentar el umbral. No se promete el mismo porcentaje para todos los archivos: depende de sus row groups, páginas y compresión.

## Medición con archivo real

Ejemplo reproducible: `src-tauri/crates/datolens-data/examples/progressive_crossfilters.rs`. Motor nativo debug, límite DuckDB 512 MB, dos hebras, sin purgar caché del SO. Timings de motor, sin IPC/render, variables y muestra iguales en ambas fuentes.

- PISA remoto exacto de la petición: `docs/qa/progressive-pisa-remote.txt`; primera medición antes de ajustar prefetch: `progressive-pisa-remote-before-prefetch.txt`.
- Copia local del mismo archivo (160.410.264 bytes): apertura 1.024 ms; primeros dos gráficos 274 ms; pares siguientes 236–244 ms; repetir primeros 5 ms; filtro 6 ms. `progressive-pisa-local.txt`.
- Reapertura local con muestra persistida: apertura 816 ms; primer par 34 ms, siguientes 7–16 ms. `progressive-pisa-local-reopen.txt`.

## Límites

Se optimiza lectura por columnas, no se garantiza leer solo N valores físicos de Parquet: una muestra uniforme distribuida puede necesitar todos los row groups de las columnas solicitadas. Las tarjetas lejanas no se analizan hasta ser demandadas. Los valores raros pueden no estar en una muestra; Todas mantiene análisis exacto. La muestra nativa puede ocupar más disco si se visitan miles de columnas; los valores permanecen locales. La caché de distribuciones en RAM sí está acotada. Ninguna llamada IA.

Medición remota final después del ajuste de lectura: apertura 5.231 ms; primeros dos gráficos 2.738 ms; siguientes pares 2.211–2.408 ms; repetición nativa con comprobación HEAD 218 ms. La caché de interfaz evita incluso esa consulta en revisitas con la misma revisión/filtros. Estos tiempos son una ejecución, no una promesa de latencia de red.

Fuente técnica comprobada para el ajuste de prefetch: [lector Parquet oficial de DuckDB v1.5.5](https://github.com/duckdb/duckdb/blob/v1.5.5/extension/parquet/parquet_reader.cpp), funciones `ShouldAndCanPrefetch`, `InitializeScan` y registro de rangos por columnas en `Scan`. La validación de bytes anterior decide el cambio, no una suposición sobre el nombre de la opción.

## App nativa y entrega

Prueba por CUA en `Datolens Crossfilter QA.app`, bundle aislado con los cambios finales. Se conserva la sesión abierta del usuario en la app principal.

- Abrir la URL exacta en Auto: tabla con 191.254 filas y gráficos COUNTRY/SCHOOLID/STIDSTD cargados; muestra indicada de 1.000, sin pausa remota ni error de memoria.
- Pulsar COUNTRY=724: tabla exacta de 62.496 filas; 323 seleccionadas en la muestra; los otros gráficos cambian con el filtro. Quitar el filtro recupera el fondo.
- Buscar PV10CPRO: se solicita esa columna lejana y aparece su histograma numérico real.
- Explore: aparecen los gráficos de la rejilla por lotes; desplazar dos páginas solicita y termina ST05Q01/ST07Q01/ST09Q01 y los histogramas de las nuevas tarjetas. Volver a Table recupera las primeras categorías de la caché.
- Cambiar muestra a 10.000: COUNTRY pasa a 3.314 y nulos a 6.686; volver a Auto recupera 323 y 677. La tabla sigue indicando las 191.254 filas completas.
- Abrir `/tmp/datolens-progressive-qa/pisa.parquet` mediante el selector nativo de macOS: segunda pestaña local con 4.911 variables y Auto de 1.000; mismas distribuciones iniciales. COUNTRY=724 produce las mismas 62.496 filas exactas y 323 seleccionadas de muestra. Buscar PV10CPRO después de limpiar el filtro carga también el histograma local.

Bundle principal compilado al terminar el trabajo compartido de Charts mediante `scripts/build-macos.sh`. Verificación propia `codesign --verify --deep --strict` exit 0. Ruta: `src-tauri/target/debug/bundle/macos/Datolens.app`. SHA-256 de `Contents/MacOS/datolens`: `5e675f500c33e922dbff3b9ab827a110493ca18b599e195a31096a54e03a5903`.

El proceso principal sigue ejecutando la versión anterior; cerrar y reabrir ese mismo bundle carga las mejoras. No se reinició ni se manipuló su sesión durante la QA.
