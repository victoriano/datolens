# Datolens — Mac App Store

23-09-2026: instalador firmado por Apple y perfil de distribución creados; **no subido ni enviado a revisión**. La descarga directa es una beta firmada y notarizada. Notarización y App Review son procesos diferentes.

## Bloqueo actual

Xcode intentó subir 0.1.0 (2), con la cuenta existente del equipo `CW546NZ5HC`. La fase `IDEDistributionFetchAppRecordStep` devolvió:

```text
IDEDistribution.DistributionAppRecordProviderError.missingApp(bundleId: "com.victoriano.datolens")
```

Hay que iniciar sesión en App Store Connect y crear la ficha macOS con ese Bundle ID. La pestaña está conservada para el titular. No se ha eludido el login ni el segundo factor. El Llavero local bloqueado del otro Mac no impide la firma cloud, que ya funcionó; no hace falta transferir claves privadas ni comprar otra suscripción.

## Material preparado

- Identificador registrado y perfil `Mac Team Store Provisioning Profile: com.victoriano.datolens`, equipo `CW546NZ5HC`.
- `artifacts/distribution/Datolens-AppStore-0.1.0-2.pkg`, firmado con `3rd Party Mac Developer Installer`. La app interna está firmada con `Apple Distribution`.
- Bundle extraído con firma estricta verificada; recursos legibles para todos; Hardened Runtime y App Sandbox activados. Entitlements: archivos seleccionados lectura/escritura, bookmarks de ámbito app y cliente de red. Sin `disable-library-validation`.
- Textos ES/EN en `metadata/`, seis capturas nativas en `screenshots/`, fixture sintético y `review-notes.txt`. Revisar las capturas contra la candidata definitiva antes de entregarlas.
- Categoría propuesta: Productivity / Developer Tools. Marketing, soporte y privacidad: `https://datolens.victoriano.me`, `/support` y `/privacy`.
- Avisos de licencias en `../ThirdPartyNotices.txt`, incluidos en los archives.

## Validación y límites

Integración implementó security-scoped bookmarks y exportación mediante staging privado y publicación atómica sin sobrescribir destinos. Suite raíz: 25 PASS. DuckDB 1.5.5 con httpfs integrado y OpenSSL estático para macOS 12: 56 pruebas de datos PASS (3 ignoradas) y prueba específica de httpfs integrado PASS. La ruta antigua con extensión separada conserva 6 pruebas PASS.

QA nativa aislada con sandbox y firma local: abrir CSV de 1.200 filas, filtrar Madrid (300), guardar/reabrir con filtro, exportar CSV y Parquet de 300 filas, exportar PNG de 1706×940 y abrir Parquet HTTPS de 1.200×7, PASS. Origen intacto. Recibo: `artifacts/distribution/sandbox-functional-receipt.json`.

Ese recibo se obtuvo con Hardened Runtime desactivado solo en la copia QA, porque el certificado local no tenía Team ID para cargar la biblioteca. La candidata de distribución conserva Hardened Runtime. Se obtuvieron después firmas Apple reales y notarización para la descarga. No convertir el recibo anterior en una validación completa del binario de la tienda.

Pendientes antes de producción: instalación y QA final desde TestFlight, Keychain con perfil real, exportación a volumen externo y revisión de privacidad y APIs con motivo obligatorio. No se probaron Gemini/Jev con credenciales de otros proyectos ni se fabricó un recibo `app-store-sandbox-qa.json`.

## Firma cloud y siguiente subida

`home-macbook` tiene Xcode 26.6 y cuenta autenticada. Archivos remotos temporales en `/tmp/datolens-distribution-20260923/`; finales conservados localmente. Logs en `artifacts/distribution/`.

```sh
# En este proyecto, para una nueva candidata ya compilada y verificada:
python3 distribution/macos/prepare-xcode-archive.py app-store \
  --app /ruta/Datolens.app --team CW546NZ5HC --build NUMERO_NUEVO
```

El preparador genera un archive ad-hoc. Copiarlo y los ExportOptions al Mac con Xcode, donde se obtiene la firma real:

```sh
xcodebuild -exportArchive -archivePath /ruta/Datolens.xcarchive \
  -exportPath /ruta/export -exportOptionsPlist /ruta/app-store-export.plist \
  -allowProvisioningUpdates
# Después de crear la ficha en App Store Connect:
xcodebuild -exportArchive -archivePath /ruta/Datolens.xcarchive \
  -exportPath /ruta/upload -exportOptionsPlist /ruta/app-store-upload.plist \
  -allowProvisioningUpdates
```

Subir el build no lo envía automáticamente a App Review. Completar TestFlight; después seleccionar el build y revisar textos/capturas, privacidad, edad, precio, disponibilidad y DSA/trader status con los datos reales del titular. No se han inventado datos legales ni marcado “Data Not Collected”: ver `PRIVACY.md`. No usar el badge hasta disponer de ficha pública.

`prepare.py`, `build-and-package.sh` y `upload.sh` conservan una ruta alternativa con certificados/perfil locales. Sus avisos de certificados ausentes no invalidan la firma cloud verificada. No guardar claves ni perfiles en Git.

## Fuentes oficiales consultadas el 23-09-2026

- https://v2.tauri.app/distribute/app-store/
- https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/
- https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/
- https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox
- https://developer.apple.com/app-store/app-privacy-details/
- https://developer.apple.com/app-store/review/guidelines/#beta-testing
