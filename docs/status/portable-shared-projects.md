# Proyectos portátiles en carpetas sincronizadas

Implementado para CSV, XLSX, SAV y Parquet locales. Al guardar, Datolens escribe
`archivo.ext.datolens.json` junto al original. Las versiones inmutables y los
resultados materializados se guardan en `archivo.ext.datolens/revisions/` y
`archivo.ext.datolens/results/`. Para compartir el proyecto deben sincronizarse
el archivo original, el JSON y el directorio auxiliar completo. Las credenciales,
el historial de ejecuciones y la caché DuckDB permanecen en cada Mac.

La identidad portátil utiliza SHA-256 del archivo original y la hoja elegida.
La ruta y la fecha de modificación pueden diferir entre ordenadores. Si cambia
el contenido, se rechaza el proyecto para evitar aplicar filtros o resultados
a otro dataset. La vista incluye filtros, gráficos, metadatos, colores y
preferencias visuales del proyecto. Idioma y tema son locales; las claves siguen
en Keychain.

Los resultados IA terminados se publican como un Parquet inmutable verificado
por SHA-256. Abrir el archivo con una caché vacía restaura columnas, definiciones
y valores desde el proyecto compartido. Si falta todavía el Parquet, la apertura
indica que hay que esperar a la sincronización; no presenta celdas vacías como
si fueran el resultado final. Un fallo de publicación se muestra en el estado
de la ejecución.

Cada guardado crea una revisión. Una instancia abierta no sobrescribe una
revisión que haya llegado mientras tanto. La interfaz consulta las revisiones
cada 15 segundos y permite elegir una versión, incluso cuando difieren sus
columnas de resultados. La elección conserva las versiones anteriores; no hace
una mezcla automática de celdas o filtros. Evitar editar simultáneamente el
mismo proyecto sigue siendo la opción más sencilla.

Verificación: pruebas del crate de datos con copia a otra ruta y caché nueva,
integridad del archivo, resultados y definiciones, ramas concurrentes,
esquemas distintos y rechazo de sobrescritura; prueba de servicio nativo que
restaura definiciones y valores; comprobación TypeScript y pruebas de vista.
Estas pruebas no sustituyen la validación de sincronización Dropbox real entre
dos Macs ni una prueba de la app instalada tras reiniciarla.

Limitaciones: si la carpeta no permite escribir los auxiliares, Datolens guarda
una copia recuperable solo en este Mac y lo avisa. Los trabajos en curso y el
historial de ejecuciones no se sincronizan. Dropbox puede tardar en entregar
el JSON y los Parquet; Datolens no controla ni acelera ese transporte.
La distribución actual firmada para desarrollo no tiene App Sandbox; una futura
distribución sandboxed necesitará autorización explícita para la carpeta completa
antes de escribir los archivos auxiliares junto al original.
