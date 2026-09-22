# Arquitectura y coordinación

## Límites

- React/TypeScript representa páginas y agregados; no conserva millones de filas.
- Tauri/Rust administra archivos, DuckDB nativo, Keychain y tareas persistentes.
- `datolens-data` es un crate independiente de Tauri: importa/consulta/perfila,
  mantiene identidad estable y guarda metadatos/resultados.
- `datolens-enrichment` es un crate independiente de Tauri: DAG, proveedores,
  ejecución/cancelación/reintentos y persistencia de trabajos. La integración
  proporciona acceso a filas/resultados mediante una interfaz explícita.
- El shell registra commands y conecta los dos crates y la UI.

El contrato inicial está en `src/contracts/desktop-api.ts`. El coordinador es su
único escritor. Los workers pueden proponer cambios en su recibo, pero deben
avanzar con servicios internos y fixtures sin esperar innecesariamente.

## Almacenamiento

Fuente original intacta. Un fichero de proyecto `.datolens.json` versionado
contiene fuente, vista y definiciones. Una base local del proyecto contiene
resultados, historial y trabajos. Escrituras de JSON atómicas. Resolver origen
movido/esquema cambiado sin aplicar silenciosamente metadatos a otro dataset.
Si la carpeta de origen no es escribible, usar datos de aplicación y permitir
guardar el proyecto en una carpeta elegida.

No generar una huella completa de gigabytes para mostrar la primera página.
Establecer identidad estable de dataset/fila y detectar cambios usando metadatos
y comprobaciones incrementales. XLSX requiere hoja/rango en la referencia.

La selección para enriquecer se congela por IDs de registro y de enriquecimiento,
no por índices visuales. Cambiar orden/ocultación no cambia las dependencias.
Las respuestas se aplican solo a la revisión de entradas/prompt que las lanzó.

## Implementación del explorador

Los componentes propios están en `src/features/explorer/` y los cálculos SQL en
el crate de datos. Mantener una sola ruta de consulta compartida; no crear dos
motores de filtrado divergentes.

Los filtros estructurados usados por tabla y gráficos deben compartir semántica.
El contrato inicial propone perfiles/distribuciones nativos y evita exponer SQL
arbitrario a ficheros de proyecto. Mantener los cálculos SQL y sus pruebas aunque
cambie el transporte. El presupuesto de memoria debe ser nativo. No incorporar
dependencias de servicios cloud al camino local.

## Arranque de los threads

1. Integración prepara shell Tauri/React, manifests, adaptadores y stubs explícitos
   para trabajar sin bloquear el frontend. Los stubs de datos nunca se presentan
   como una entrega funcional.
2. Datos implementa su crate con pruebas independientes y comunica su API Rust.
3. Explorador implementa componentes controlados por `DesktopApi` y fixtures.
4. Enriquecimientos implementa crate, proveedor Gemini y componentes propios.
5. Integración conecta los servicios, elimina mocks del camino real, compila
   y ejecuta la app macOS y el recorrido en `MVP.md`.

Cada worker actualiza `docs/status/<área>.md`: implementado, comandos y resultado
de verificación, API pública, dependencias solicitadas y pendientes. Notificar al
coordinador por mensaje de thread al terminar o cambiar una interfaz. No esperar
el final de todos para comunicar bloqueos concretos.
