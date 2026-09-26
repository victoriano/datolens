# Consultas en lenguaje natural — 2026-09-23

## Verificación automática

- `bun run check`: PASS.
- Test Rust `workspace_planner::tests`: PASS. Contexto sin valores privados, rutas ni dataset IDs; acepta consulta agregada y rechaza columnas/tablas inexistentes, lectura externa, múltiples sentencias y DELETE. Log: `workspace-natural-tests.txt`.
- `scripts/build-macos.sh`: PASS; compilación frontend y Rust, bundle debug y firma verificada. Log: `workspace-natural-build.txt`. Aviso de rpath duplicado no bloqueante.

## UI con fixture, sin red ni credenciales reales

Preview de desarrollo `src/features/workspace/preview.html` en puerto1424, cerrado tras QA.

- Sin clave: foco inicial en lenguaje natural, opción de añadir API key y preparación deshabilitada.
- Guardado simulado activa la conexión; propuesta muestra nombre/explicación y SQL plegada.
- Edición opcional de SQL de `total > 10` a `total > 20`; resultado simulado recibe exactamente SQL editada.
- Cambiar descripción invalida la propuesta y requiere prepararla de nuevo.
- SQL manual disponible sin clave; no se invoca proveedor.

## App nativa principal

Reiniciada desde `src-tauri/target/debug/bundle/macos/Datolens.app` tras el build firmado.

- Barra muestra Create dataset; diálogo abre descripción en lenguaje natural con foco correcto.
- Dos fuentes visibles, solo dataset activo seleccionado inicialmente.
- Gemini connected detectado mediante comprobación de existencia de clave; no se solicitó el secreto ni se pulsó Prepare query.
- Write SQL manually abre View and edit SQL con `SELECT * FROM t2 LIMIT 1000`, nombre editable y Create dataset.
- Diálogo cerrado sin ejecutar consulta sobre datos del usuario.
- Estado conservado: dos pestañas originales, victorianoi_followings.csv activa, filtro location Madrid, 101 de1502 filas,14 columnas, English/System.
- El bundle también muestra las opciones de columnas aportadas por la tarea correspondiente; se le cede CUA para su QA independiente.

## Alcance

Se verificaron backend con fixtures, UI simulada y apertura/configuración visible en app nativa. No se verificó generación contra Gemini real, no se consumió saldo de API y no se modificaron claves. La prueba de creación nativa de datasets y JOIN sigue documentada en el corte previo `workspace-native.md`.
