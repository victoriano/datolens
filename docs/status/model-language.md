# Idioma de las respuestas de IA

Las nuevas solicitudes de clasificación de variables, filtros en lenguaje natural,
colores y orden semántico envían `language` desde la preferencia activa de Ajustes.
Los prompts de Gemini y Jev usan ese idioma para sus explicaciones y etiquetas;
la clasificación Jev conserva los IDs cerrados internamente y presenta sus nombres
traducidos. El diseñador de columnas aplica la misma preferencia a nombres,
instrucciones, opciones, niveles y explicación, salvo que el usuario pida otro idioma.
El planificador de consultas del espacio de trabajo ya recibía esta preferencia.

Las llamadas que no incluyan `language` siguen usando español como valor de
compatibilidad. Las salidas ya guardadas no se traducen retroactivamente.

Verificación: `bun run check` pasó. El build macOS coordinado por integración
incluyó estos cambios; `scripts/build-macos.sh`, `codesign --verify --deep --strict`,
las 40 pruebas nativas `root --lib` y `tsc` pasaron. Evidencia de build:
[`credential-helper-main-build.txt`](../qa/credential-helper-main-build.txt).

QA nativa en el bundle principal: con Settings → English, Gemini real (`gemini-2.5-flash`)
devolvió en inglés el resumen y los motivos para los dos valores `false`/`true` de
Churn. No se enviaron filas. La propuesta se canceló, sin guardar colores. Véase
[`credential-helper-native.md`](../qa/credential-helper-native.md). Esta comprobación
cubre colores semánticos con Gemini; no clasificación de variables ni Jev HTTP.
