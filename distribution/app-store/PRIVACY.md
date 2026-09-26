# App Privacy — borrador para revisión del titular

No se ha enviado ningún cuestionario a Apple. No asumir “Data Not Collected”.

La exploración local procesa archivos, vistas y resultados en el dispositivo.
La web pública no incorpora analítica, formularios ni cookies de publicidad.

Las funciones opcionales de Gemini/Jev/web envían prompts, datos seleccionados,
metadatos y/o muestras al proveedor. Para responder App Privacy hay que revisar
el tratamiento efectivo de cada proveedor en las cuentas/planes admitidos:
retención, uso para entrenamiento, identificación y finalidades. Elegir campos
en la UI no demuestra por sí solo que la divulgación sea opcional para Apple.

Posibles categorías a revisar: Other User Content, Search History si corresponde,
Identifiers/Usage Data según lo que realmente envíe o retenga el proveedor. No
marcarlas como hechos confirmados sin inventario y términos actuales.

Pruebas y revisión pendientes:

- inventario de todas las peticiones salientes de la versión de tienda;
- tipos, vinculación con usuario y retención de los servicios de IA;
- revisión de APIs con motivo obligatorio y SDKs terceros antes de preparar
  PrivacyInfo.xcprivacy (no añadir códigos de razón sin demostrar su uso);
- contacto de soporte/privacidad del titular, precio y condición DSA;
- el almacenamiento local/Keychain no implica tracking; no añadir tracking
  ni excepciones de sandbox para simplificar la distribución.

Fuentes: https://developer.apple.com/app-store/app-privacy-details/
y https://developer.apple.com/documentation/bundleresources/privacy-manifest-files
