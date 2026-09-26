# Exportación a destinos elegidos en App Sandbox

Corrección de Integración para distribución, 23 de septiembre de 2026.

## Fallo reproducido y solución

La QA con sandbox abrió y restauró el CSV y su filtro (Madrid, 300/1.200 filas).
Exportar falló en `/private/tmp/.tmp…`: el selector de guardar concede el destino
exacto, mientras DataStore preparaba su temporal en la carpeta vecina.

`src-tauri/src/file_export.rs` integra una publicación segura sin cambiar el
crate de datos ni pedir acceso a toda la carpeta:

1. Comprueba que no exista el destino, incluso si es un symlink colgante.
2. Genera el archivo completo dentro de un directorio temporal privado bajo
   AppData/projects. DataStore conserva filtros, orden y proyección, y sus
   temporales también quedan dentro de ese directorio.
3. Sincroniza el contenido completo y publica con persist_noclobber de tempfile:
   en macOS usa renameatx_np con RENAME_EXCL; el fallback de enlace duro también
   es indivisible y no sobrescribe. No se copia un cuerpo parcial al destino.
4. Si el destino está en otro volumen, pide a Foundation un directorio temporal
   de reemplazo en ese volumen, tomando como referencia su padre existente;
   copia allí el archivo completo, sincroniza y publica sin sobrescribir.
   Si no puede prepararlo o publicar, devuelve un error y conserva el destino.

El paso de otro volumen usa
[NSItemReplacementDirectory](https://developer.apple.com/documentation/foundation/filemanager/url(for:in:appropriatefor:create:)).
Las pruebas detectaron que pasar un nombre final todavía inexistente a esa API
podía crear un placeholder vacío. La implementación final nunca pasa ese nombre:
usa exclusivamente el padre existente y tiene una prueba de regresión.

La ruta es compartida por CSV/Parquet de tabla y CSV/SVG/PNG de gráficos. Los
gráficos dejan de escribir/truncar directamente el destino. Se rechaza siempre
un archivo ya existente y se pide un nombre nuevo, conservando la protección
que ya tenía el export de datasets. Esta comprobación también se aplica de
forma atómica si otro proceso crea el destino durante la generación.

Los temporales son privados y RAII los limpia al terminar o fallar. No se
amplían entitlements ni se altera el original. Se reutilizan objc2 y
objc2-foundation ya presentes en el lockfile para la API de Foundation.

## Verificación

- Suite raíz **25 PASS** (6 nuevas), `docs/qa/sandbox-export-tests.txt`.
- Pruebas nuevas: error tras escribir un fragmento; escritor concurrente;
  publicación completa y limpieza; conservación de archivo/symlink; directorio
  de reemplazo sin placeholder, privado y en el mismo volumen; export/reapertura
  CSV y Parquet con filtros, orden, proyección e IDs >2^53 exactos.
- TypeScript PASS, `docs/qa/sandbox-export-typecheck.txt`; diff-check PASS.
- Los tests anteriores ejecutan Foundation y DuckDB reales fuera del bundle.
  La QA nativa posterior de CSV y Parquet dentro del sandbox se detalla abajo.
  No se ha registrado un recorrido nativo de exportación de gráficos en este corte.
- El código contempla volúmenes distintos, pero no se ha probado un disco
  externo real; si el sistema no permite el temporal apropiado, falla sin copiar
  ni truncar el destino. No se afirma compatibilidad comprobada con proveedores
  de archivos en nube.

Fuente congelada y Cargo habitual libre. No se tocó el bloque load_httpfs del
propietario de distribución, sus artefactos, la web ni la instancia principal.

## Confirmación nativa posterior de distribución

Exportar con NSSavePanel a `/tmp` y reabrir el resultado fuera del proceso:
**CSV y Parquet PASS**, ambos con exactamente 300 filas y todas de Madrid.
El hash del CSV original coincide con el fixture: no se modificó.

Evidencia leída: `artifacts/distribution/sandbox-functional-receipt.json`.
Recorridos: `sandbox-export-fixed.txt` y `sandbox-parquet-export-fixed.txt`.

Esta QA usó App Sandbox activado, firma local de desarrollo y Hardened Runtime
desactivado exclusivamente en una copia QA aislada. No equivale a validación
de distribución Apple: la variante hardened abortó por el Team ID del certificado
local. La candidata de distribución conserva Hardened Runtime activado.

Siguen pendientes la firma Apple real con Hardened Runtime, el volumen externo,
el Keychain bajo el perfil real de App Store y los proveedores IA reales. No se
cambia código ni se levantan protecciones como consecuencia de este recibo.
