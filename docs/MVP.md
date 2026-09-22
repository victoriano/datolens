# MVP macOS — alcance y aceptación

## Producto acordado

Datolens abre ficheros CSV, XLSX y Parquet locales y muestra filas cuanto antes.
La velocidad se medirá; no prometer carga completa instantánea. XLSX puede
necesitar importación y Parquet debe beneficiarse de lecturas parciales.

Primera persona usuaria: Victoriano. Primer caso: explorar una tabla grande,
seleccionar registros mediante crossfilters y enriquecer varias columnas
dependientes sin tener que subir el archivo completo a un servicio.

## Incluido

1. Abrir archivo con selector macOS y drag-and-drop. XLSX: seleccionar hoja.
2. Tabla con páginas/virtualización, tipos, valores nulos, selección de celda,
   rango rectangular y filas; copiar valores sin perder precisión de IDs largos.
3. Sorting múltiple con prioridad arrastrable; orden/visibilidad/anchos de columnas.
4. Crossfilters numéricos, fechas y categorías, selección múltiple, limpieza de
   filtros, conteos y actualización coordinada de tabla y distribuciones.
5. Panel con orden, ocultación y fijación de variables. Uplift/TF-IDF y grupos
   pueden quedar después de la primera cadena
   funcional si obstaculizan la integración; documentar lo que se difiera.
6. Guardado automático versionado en fichero local y restauración al reabrir:
   orden, ocultas, anchos, sorting, filtros, panel y definiciones de enriquecimiento.
7. Gemini con clave introducida por el usuario, elección de modelo, prompt con
   referencias a columnas y salida con tipo/esquema validado.
8. Dependencias explícitas entre enriquecimientos; rechazar ciclos y esperar a
   que las entradas estén disponibles. Paralelizar únicamente tareas listas.
9. Ejecutar una celda, rango, selección filtrada, columna o todos los registros.
   Separar completar pendientes de regenerar. Mostrar el alcance antes de las
   llamadas; incluir requisitos/dependientes solo cuando se elija esa opción.
10. Estados por celda, errores recuperables, historial mínimo, invalidación de
    dependientes, cancelación/pausa y reanudación sin repetir éxitos guardados.
11. Exportar al menos CSV/Parquet con los enriquecimientos aplicados.
12. Bundle macOS local que arranque y pase el recorrido de aceptación.

## Fuera de esta entrega

Publicación en stores, firma con certificados de distribución, Windows validado,
cuentas, cobros, colaboración cloud, marketplace de plugins y funcionamiento
continuo con el Mac apagado. Preparar arquitectura multiplataforma sin afirmar
que Windows o la App Store están ya validados.

El nombre «Jev» del segundo proveedor no se ha identificado. Mantener una interfaz
de proveedor extensible; implementar Gemini real. No inventar su API ni sustituir
ese proveedor por otro sin indicación.

## Recorrido obligatorio

- Abrir fixtures de los tres formatos y comparar datos/tipos con valores conocidos.
- Filtrar por dos columnas; comprobar que conteos, tabla y gráficos concuerdan.
- Ordenar por dos claves; validar que el orden se aplica al dataset, no solo a
  la página visible. Desempatar con una identidad de fila estable.
- Ocultar/reordenar/redimensionar, cerrar la app y restaurar la misma vista.
- Crear A → B → C; ejecutar una celda de C con requisitos y otra cadena por rango.
- Cambiar A: marcar B/C desactualizados, conservando el histórico. Una respuesta
  antigua en vuelo no debe sobrescribir datos o prompts nuevos.
- Ordenar la tabla durante una ejecución: los resultados siguen en sus filas.
- Reiniciar tras interrupción: los éxitos persisten, estados en vuelo se recuperan
  sin afirmar garantías de exactly-once si el proveedor no las ofrece.
- Exportar y volver a abrir para comprobar columnas y resultados.
- Medir primera página, memoria y filtro/sort en fixture grande de al menos
  1 millón de filas y en uno mayor si el tiempo/disco lo permiten. Registrar
  hardware, tamaño y condiciones; separar lectura fría de caché.

Gemini se prueba con un proveedor simulado determinista y, si el usuario dispone
de una clave en la app, con un lote mínimo real. No pedir que la pegue en el chat.
