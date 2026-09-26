# Apertura de archivos desde terminal y Finder

Fecha de validación: 25 de septiembre de 2026.

## Entregado

- El bundle declara asociaciones para CSV, XLSX, Parquet y SAV. macOS entrega
  esas aperturas a Tauri mediante `RunEvent::Opened`, tanto con la app cerrada
  como ya abierta.
- Cada lote conserva el orden, elimina duplicados, rechaza URLs remotas y
  formatos no admitidos, y se procesa en serie para crear una pestaña por
  fichero sin cargar el dataset completo en JavaScript.
- La utilidad nativa incluida en `Contents/MacOS/datolens-cli` acepta uno o
  varios paths, espacios, `--help`, `--version` y `--`. Usa Launch Services con
  el bundle ID estable `com.victoriano.datolens`; no arranca un segundo motor de
  datos ni elude App Sandbox.
- Ajustes muestra el estado del comando y una activación copiable. En esta
  instalación quedó activo:

  ```text
  /Users/victoriano/.local/bin/datolens
    -> /Applications/Datolens.app/Contents/MacOS/datolens-cli
  ```

- El empaquetado directo puede generar un PKG que instala el enlace
  `/usr/local/bin/datolens`. El publicador de la beta notarizada genera además
  el Cask Homebrew ligado al ZIP y SHA-256 exactos. No se publicó ningún paquete
  ni Cask en esta tarea.
- La candidata App Store incluye la utilidad como ejecutable hijo con App
  Sandbox heredado. La App Store no puede instalar enlaces en PATH; Ajustes
  ofrece la activación opt-in en `~/.local/bin`, que ya estaba en PATH en este
  Mac.

## Verificación automatizada

- `python3 scripts/test-cli.py`: **2 PASS**.
- Suite Rust raíz: **46 PASS**, incluidos lotes de apertura y CLI.
- Frontend: **121 PASS**, **2332 aserciones**.
- `bun run check`, `bun run build`, comprobaciones JSON/shell/Python y
  `git diff --check`: **PASS**.
- `scripts/test-macos-bundle.py`: **4 PASS**. El empaquetador comprueba que
  Tauri no haya alterado los bytes firmados de la utilidad.

## Verificación en la instalación real

Se construyó con `scripts/build-macos.sh`, se dejó pendiente mientras la app
estaba abierta, se cerró la instancia anterior y se instaló con
`scripts/build-macos.sh --install-pending`. `codesign --verify --deep --strict`
pasó sobre `/Applications/Datolens.app`.

La orden real:

```sh
datolens "distribution/app-store/fixtures/Housing - Demo.csv" \
  "website/public/samples/housing-demo.parquet"
```

abrió ambos archivos en la app instalada. La inspección nativa mostró las
pestañas `Housing - Demo.csv` y `housing-demo.parquet`; la última quedó activa
con **1.200 filas**. Ajustes mostró «Command activated» y el destino correcto.

## Verificación aislada con App Sandbox

Se volvió a firmar una copia aislada con bundle ID
`com.victoriano.datolens.cliqa`, App Sandbox ON y Hardened Runtime OFF. El
runtime endurecido solo se quitó porque el certificado local de QA carece de
Team ID para cargar DuckDB; la configuración de distribución lo conserva.

Launch Services abrió un CSV externo sin sidecar. Resultado observado:

- pestaña `datolens-cliqa-housing.csv`, **1.200 de 1.200 filas**, tabla y
  distribuciones visibles;
- `source-bookmarks.json` con el path canónico y permisos **0600**;
- `last-source.json` con `/private/tmp/datolens-cliqa-housing.csv`;
- después de cerrar y relanzar sin pasarle el fichero, la app recuperó el CSV
  y volvió a mostrar **1.200 filas** sin selector.

Esto valida el evento de apertura y la persistencia del permiso en una app
sandbox local. No sustituye una instalación final desde TestFlight/App Store.

## Límite encontrado

El fixture original tenía un `Housing - Demo.csv.datolens.json` hermano. El
permiso que Launch Services concede al documento no alcanza automáticamente a
ese fichero hermano; la capa de datos detecta que existe e intenta leerlo, lo
que produce `Operation not permitted`. El CSV sin sidecar abre correctamente y
su estado se guarda en el contenedor privado. La corrección del fallback de
sidecars pertenece a `datolens-data` y queda pendiente de coordinación con su
propietario; no se sobrescribió ese módulo desde Integración.

## Límites de distribución

- Implementado y probado: bundle local, comando activado, varios ficheros,
  asociaciones de documento y sandbox local con reapertura por bookmark.
- Preparado pero no publicado: PKG directo y Cask Homebrew.
- Pendiente: nueva firma/notarización de distribución y QA del binario exacto
  instalado por TestFlight/App Store.
