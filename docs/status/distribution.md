# Landing y distribución — 23 de septiembre de 2026

## Web publicada

https://datolens.victoriano.me — ES/EN, HTTPS. Vercel `datolens`, deployment
`dpl_3L1gceZvmGYFkmUTEZApky14gTHP`. Cloudflare CNAME sin proxy y TXT específico;
sin alterar otros registros, webs ni la política SSL del dominio.

Copy trabajado con la skill de Lenny para analistas, periodistas de datos,
investigación, producto y operaciones. Promesa: abrir y entender archivos
complejos. Diseño editorial minimalista, animaciones de entrada/partículas,
demo interactiva con 1.200 filas sintéticas, filtros reales, captura nativa,
privacidad/ayuda/descarga. Fuentes locales, sin analítica ni formularios.

Verificado:

- Build y 173 comprobaciones estáticas PASS; ocho páginas, enlaces, idiomas,
  metadatos, JPEG social 1200×630, tamaño y SHA-256 de la descarga.
- UI producción: filtro Madrid 1.200→300, tabla conserva filtro, flechas cambian
  vista/foco, captura nativa 2880×1800, idiomas y descarga correctos. Sin errores
  ni warnings de consola en la sesión comprobada.
- Layout 1440/390/320 px sin desbordamiento móvil; movimiento reducido detiene
  autoplay. Overrides temporales restaurados.
- Página pública de descarga comprobada después de publicar la beta notarizada:
  ZIP 25,1 MB, botón al archivo correcto, aviso de firma y pasos de instalación.
- HTTP y checksum: `artifacts/distribution/production-notarized-http.json`.

## Descarga notarizada publicada

0.1.0 (2), ARM64, mínimo declarado macOS 12. Archivo inmutable:
`Datolens-0.1.0-2-apple-silicon.zip`, 26.283.944 bytes.
SHA-256: `ef359e6dd4046cf6fcb1cfdbf15a5d9d179d8bbe245339db45b12362ad3d3f5d`.

Firmada con Developer ID Application: Victoriano Izquierdo (`CW546NZ5HC`),
Hardened Runtime activado, notarizada por Apple y ticket stapled. Firma estricta,
`stapler validate` y Gatekeeper (`source=Notarized Developer ID`) PASS en ambos
Macs. Firma/notarización vía Xcode 26.6 en `home-macbook`, usando la cuenta ya
existente. No se transfirieron claves privadas ni se desactivaron protecciones.

La web ofrece esta descarga; el DMG anterior de desarrollo queda sustituido.
Proveniencia: `distribution/macos/notarized-provenance.json`. El actualizador
`publish-notarized-beta.py` verifica el ZIP extraído y todas las condiciones
anteriores antes de cambiar el manifest. El bundle original y su proceso 10964
se han preservado; no se reinstaló ni reinició la app principal del usuario.

## Cambios necesarios para distribución

- Integración implementó bookmarks con scope de seguridad y persistencia atómica
  privada. QA: abrir CSV, Madrid 300/1.200, salir y reabrir conservando filtro PASS.
- Integración corrigió exportación: staging privado y publicación atómica sin
  sobrescribir destinos; suite raíz 25 PASS y TypeScript PASS.
- El httpfs oficial separado no admitía firma estricta. Se compiló DuckDB 1.5.5
  con httpfs integrado y OpenSSL 3.6.4 estático, deployment target macOS 12, sin
  dependencias Homebrew/usuario. No se desactivó la validación de extensiones.
- Cambio mínimo autorizado por integración en `datolens-data/src/remote.rs`:
  cargar el módulo integrado cuando su modo es STATICALLY_LINKED; conservar la
  carga normal de la extensión empaquetada en otros builds. Regresiones de la
  ruta anterior 6 PASS; biblioteca nueva 56 pruebas PASS / 3 ignoradas y prueba
  explícita de carga integrada PASS. Proveniencia y logs bajo artifacts.
- 495 secciones de licencias recopiladas; ninguna licencia pendiente de localizar
  en el recibo de colección. `distribution/ThirdPartyNotices.txt` se incluye en
  los archives. Los scripts no modifican bibliotecas vendorizadas originales.

## Alcance de la QA nativa

Con App Sandbox activado en una app aislada, firma local y Hardened Runtime
**desactivado solo en esa copia QA**:

- Abrir/reabrir CSV, sidecar en contenedor y filtro persistido: PASS.
- NSSavePanel exporta CSV y Parquet nuevos: ambos contienen 300 filas Madrid;
  el hash del origen coincide con el fixture, sin modificación: PASS.
- PNG del scatter 1706×940, inspeccionado: PASS.
- Parquet HTTPS público de 1.200 filas y 7 variables abre en nativo con httpfs
  integrado; cache mostrada 0 MB: PASS.
- Recibo: `artifacts/distribution/sandbox-functional-receipt.json` y AX asociados.

El certificado local sin Team ID válido impedía cargar la librería en la primera
candidata hardened; no se debilitó el build de distribución. La firma cloud de
Apple resolvió la firma de las bibliotecas. La prueba interactiva posterior con
las copias firmadas no quedó completada: la descarga restauraba una sesión local
existente y la herramienta no proporcionó una ventana controlable de la variante
sandbox firmada. Los procesos propios de QA se detuvieron; la sesión original se
preservó. No presentar esto como PASS de la instalación de App Store.

Pendientes: instalación/QA con el perfil real desde TestFlight, Keychain, export
entre volúmenes y versiones antiguas de macOS. Gemini/Jev reales no se probaron;
no se usaron credenciales de otros proyectos. No hay benchmarks de archivos
masivos ni se prometen límites de tamaño no verificados.

## Mac App Store — paquete firmado, subida bloqueada por ficha ausente

Instalador `artifacts/distribution/Datolens-AppStore-0.1.0-2.pkg` firmado con
`3rd Party Mac Developer Installer`. App extraída: `Apple Distribution`, equipo
`CW546NZ5HC`, firma estricta PASS, Hardened Runtime/App Sandbox activos, archivos
legibles. Perfil `Mac Team Store Provisioning Profile: com.victoriano.datolens`.

Xcode intentó subirlo, pero la comprobación de ficha devolvió:

```text
IDEDistribution.DistributionAppRecordProviderError.missingApp(bundleId: "com.victoriano.datolens")
```

No existe aún la ficha que necesita esta carga. App Store Connect solicita
iniciar sesión en el navegador; pestaña conservada para el usuario. Se solicitó
ese acceso. La pregunta anterior sobre desbloquear el Llavero queda superada:
la cuenta cloud ya permitió firmar y notarizar sin esa clave local.

Textos ES/EN, capturas reales, notas de revisión, muestra y documentación de
privacidad disponibles en `distribution/app-store/`. Falta crear la ficha,
completar privacidad/edad/precio/disponibilidad/DSA con datos reales del titular,
revisar APIs de motivos obligatorios, subir a TestFlight y terminar QA; después
solicitar App Review. No se inventaron datos legales, una aprobación, una ficha
pública o un recibo completo de sandbox. Ver `distribution/app-store/README.md`.

Sin commits, pushes, repositorios remotos nuevos ni cambios en repos externos.

## 2026-09-23 — Galería con capturas reales

Sustituida la demo HTML de la landing por capturas reales de Tabla, Explorar y
Gráficos, en español e inglés. Las seis imágenes son copias sin modificar de
`distribution/app-store/screenshots/`; muestran datos sintéticos de vivienda.
La galería mantiene transiciones, pausa, navegación por teclado y enlaces a
las imágenes completas. El CTA ahora dice «Ver el producto» / «See the product».

Verificación: build de 8 páginas y 183 comprobaciones correctas. En navegador,
cambio a Explorar y navegación por teclado a Gráficos correctos. En producción,
las tres imágenes inglesas cargan a 2880 × 1800 y la portada española contiene
la nueva galería. Publicado en https://datolens.victoriano.me mediante despliegue
`dpl_HKyNKntVtaaspRNKFJ2xeYPtpozv`. Recibo:
`artifacts/distribution/website-real-screenshots-deploy.log`.
