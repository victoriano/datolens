#!/bin/bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/../.." && pwd)"
: "${DATOLENS_DEVELOPER_ID:?Set the installed Developer ID Application signing identity}"
: "${DATOLENS_NOTARY_PROFILE:?Set the existing notarytool Keychain profile name}"
case "$DATOLENS_DEVELOPER_ID" in
  'Developer ID Application: '*) ;;
  *) echo 'Developer ID Application is required for notarized direct downloads.' >&2; exit 1;;
esac
source_bundle="${1:?Pass a tested release .app bundle}"
test -d "$source_bundle"
python3 - "$source_bundle" <<'PY'
import pathlib,sys
if list(pathlib.Path(sys.argv[1]).rglob('*.duckdb_extension')):
    sys.exit('Standalone DuckDB extensions fail Apple signing. Use the verified built-in-httpfs distribution build first.')
PY
stage="$(mktemp -d "${TMPDIR:-/tmp}/datolens-notary.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
ditto "$source_bundle" "$stage/Datolens.app"
chmod -R a+rX "$stage/Datolens.app"
codesign --force --options runtime --timestamp --sign "$DATOLENS_DEVELOPER_ID" "$stage/Datolens.app/Contents/Frameworks/libduckdb.dylib"
codesign --force --options runtime --timestamp --sign "$DATOLENS_DEVELOPER_ID" "$stage/Datolens.app/Contents/MacOS/datolens-credentials"
codesign --force --options runtime --timestamp --sign "$DATOLENS_DEVELOPER_ID" "$stage/Datolens.app/Contents/MacOS/datolens-cli"
codesign --force --options runtime --timestamp --sign "$DATOLENS_DEVELOPER_ID" "$stage/Datolens.app"
codesign --verify --deep --strict "$stage/Datolens.app"
ditto -c -k --keepParent "$stage/Datolens.app" "$stage/Datolens.zip"
xcrun notarytool submit "$stage/Datolens.zip" --keychain-profile "$DATOLENS_NOTARY_PROFILE" --wait --output-format json > "$stage/notary-result.json"
python3 - "$stage/notary-result.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
if d.get('status')!='Accepted':sys.exit('Notarization not accepted; inspect Apple notary logs using the submission ID.')
print('Apple notarization accepted:',d.get('id'))
PY
xcrun stapler staple "$stage/Datolens.app"
xcrun stapler validate "$stage/Datolens.app"
spctl --assess --type execute --verbose=2 "$stage/Datolens.app"
mkdir -p "$project_root/artifacts/distribution/notarized"
ditto "$stage/Datolens.app" "$project_root/artifacts/distribution/notarized/Datolens.app"
echo 'Notarized app prepared. Smoke-test this exact signed build, package it and update the website release manifest.'
