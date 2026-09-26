# QA nativa de datasets y joins

Estado: PASS en la app real **Datolens Integration QA.app**, identificador `com.victoriano.datolens.integrationqa`, el 23 de septiembre de 2026. Bundle conjunto compilado y firmado por Integración. Interacciones mediante CUA. La instancia principal no se ha tocado.

Fixtures locales sintéticos en `fixtures/generated/workspace/`:
- `customers.csv`: Ana/Madrid, Luis/Sevilla, Marta/Madrid.
- `orders.csv`: Ana 12 + 8, Marta 15.
- `ventas.xlsx`: hojas Clientes y Pedidos con los mismos datos.

Recorrido ejecutado:
1. PASS: CSV de clientes y CSV de pedidos abiertos simultáneamente; recuentos 3 y 3. La pestaña previa de enriquecimientos se conserva.
2. PASS: filtro Madrid deja 2 de 3 clientes. Pedidos sigue mostrando 3 de 3. Volver a clientes recupera filtro y dos filas.
3. PASS: abrir XLSX añade automáticamente Clientes y Pedidos sin selector modal. Ambas hojas se visitan; 3 filas cada una. Clientes se filtra por Madrid y Pedidos permanece sin filtro.
4. PASS: seleccionar únicamente Clientes (`t4`) y Pedidos (`t5`) en el editor, ejecutar LEFT JOIN con agregación y nombre «Totales por cliente». Resultado visible: Ana 20, Luis NULL, Marta 15. Incluye Luis aunque la vista de Clientes tenga filtro Madrid.
5. PASS: nueva pestaña `Totales por cliente.parquet`, 3 filas y 2 columnas, con tabla y distribuciones. Archivo persistente en `Application Support/com.victoriano.datolens.integrationqa/projects/query-results/1790147392776598000-0/`.
6. PASS: Cmd+Q y nueva apertura del mismo identificador QA recuperan todas las pestañas restantes y el resultado activo con 20/NULL/15. Visitar Clientes después del reinicio recupera Madrid y 2 de 3 filas.
7. PASS: cerrar `orders.csv` antes del reinicio elimina solo su pestaña. No reaparece al reabrir. Clientes, Pedidos, customers.csv y el resultado siguen disponibles. Se deja QA abierta en el resultado para el siguiente turno de pruebas.

Consulta ejecutada:
```sql
SELECT c.name, SUM(o.total) AS total
FROM t4 c LEFT JOIN t5 o ON c.id = o.customer_id
GROUP BY c.name
ORDER BY c.name
```

Inspección visual: pestañas compactas integradas con la barra nativa; nombre de hoja y libro diferenciados, pestaña activa subrayada, editor modal con fuentes, schema desplegable, nombre y SQL. Sin solapamientos observados a 1440×900. No se hicieron llamadas a Gemini en esta prueba.
