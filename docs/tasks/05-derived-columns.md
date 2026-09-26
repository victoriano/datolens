# Columnas derivadas SQL — coordinación 23 de septiembre

Petición recibida en la tarea de Enriquecimientos: detectar cálculos locales en
el mismo chat, proponer una fórmula DuckDB con vista previa y crear la columna
tras confirmación. La autorización del usuario consta en esa tarea.

## Propiedad cedida a Enriquecimientos

- Módulos nuevos `src/contracts/derived-columns.ts`,
  `src-tauri/src/derived_columns.rs`,
  `src-tauri/crates/datolens-data/src/derived.rs` y `tests/derived.rs`.
- Adiciones acotadas para exportar el módulo y exponer métodos en data
  `src/lib.rs` y `src/store.rs`, preservando SAV, casts y gráficos.
- Solo firmas/imports, adaptadores invoke y registros nuevos de derivadas en
  `src/contracts/desktop-api.ts`, `src/platform/desktop.ts` y
  `src-tauri/src/lib.rs`.
- Su compositor y motor de enriquecimiento siguen bajo su propiedad habitual.

Integración mantiene App.tsx, integración final y lockfiles/dependencias raíz.
ExplorerApp.tsx tiene otras tareas activas: usar los callbacks actuales o enviar
un parche mínimo antes de editarlo. `onDefinitionsChange` y `onResultsChange`
ya pasan a `onDataChanged`, que recupera Dataset y reconcilia la vista.

## Contrato y verificación

- Comunicar tipos/API y dependencias antes de modificar contratos compartidos.
- Expresión escalar validada, no SQL arbitrario ni acceso a archivos, red o
  extensiones mediante una fórmula. No confiar en SQL generado por el modelo.
- Vista previa acotada sin escrituras; creación explícita confirmada en UI.
- Evaluación nativa; el dataset completo no pasa por JavaScript.
- Verificar persistencia y reapertura, tipos, dependencias y cambios de entradas.
- La evaluación SQL local no requiere credenciales ni inferencia por fila.
- Sin compilación Cargo común, build principal o CUA hasta coordinar turno.

Las tareas activas de estadísticas, Open in Plot, filtros y significant variables
han sido consultadas para resolver cualquier solapamiento. Esta nota no cede sus
archivos ni implica que la implementación esté terminada.

## Relevo con workspace/joins

La tarea `01a0ccff-beff-7db2-80bf-4900749bbc9a` tiene App.tsx y módulos nuevos
de workspace. Enriquecimientos conserva el turno actual de hooks IPC/data;
workspace prepara sus hooks como parche hasta recibir el relevo explícito.
Ambas tareas deben acordar la representación de derivadas al hacer joins y
la conservación de metadatos. Significant Variables tiene un build compartido
finalizado y su pase de ExplorerApp; tiene el primer turno CUA nativo, seguido
por Open in Plot. Este último interrumpe su propia compilación release para
usar el bundle debug conjunto y evitar targets duplicados. Los hooks nuevos
de derivados/workspace no requieren modificar los bloques actuales de Explorer.

Significant ha terminado QA y cedido CUA a Open in Plot. El próximo turno
Cargo común queda reservado a workspace para pruebas nativas tras recibir el
relevo de hooks/data de Enriquecimientos. No incluye reconstruir el bundle
abierto ni usar CUA; esos pasos requieren terminar el turno visual en curso.

Relevo confirmado: Enriquecimientos terminó los tres registros/invokes y
`Partial<DerivedColumnsApi>`, junto a los hooks de DataStore/sidecar. Workspace
puede aplicar sus hooks y ejecutar las pruebas nativas en el target común.
Enriquecimientos continúa UI y pruebas aisladas. El bundle y CUA siguen
esperando el cierre del turno visual de Open in Plot.
