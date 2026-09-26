#!/bin/bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$project_root"
python3 distribution/app-store/prepare.py --generate

# This is an evidence gate, not a request for user approval. Only a real native
# sandbox test may produce this receipt. Required shape:
# {"passed":true,"sourceSha256":"...","checks":["source-reopen","sidecar",
# "export","duckdb-httpfs","keychain"],"evidence":"absolute path to receipt"}
python3 - <<'PY'
import pathlib,json,hashlib,sys
root=pathlib.Path.cwd();p=root/'artifacts/distribution/app-store-sandbox-qa.json'
if not p.exists():sys.exit('Missing real App Sandbox QA receipt; see distribution/app-store/README.md.')
q=json.loads(p.read_text());h=hashlib.sha256()
paths=sorted([p for base in ('src','src-tauri/src','src-tauri/crates') for p in (root/base).rglob('*') if p.is_file() and p.suffix in ('.rs','.ts','.tsx','.css') and 'target' not in p.parts])
for f in paths:h.update(str(f.relative_to(root)).encode());h.update(f.read_bytes())
required={'source-reopen','sidecar','export','duckdb-httpfs','keychain'}
if not q.get('passed') or q.get('sourceSha256')!=h.hexdigest() or not required.issubset(q.get('checks',[])) or not pathlib.Path(q.get('evidence','')).is_file():
 sys.exit('App Sandbox QA is incomplete or stale for this source tree.')
PY

export CARGO_TARGET_DIR="$project_root/artifacts/distribution/app-store-target"
bun tauri build --bundles app --target aarch64-apple-darwin --config distribution/generated/tauri.appstore.conf.json
app="$CARGO_TARGET_DIR/aarch64-apple-darwin/release/bundle/macos/Datolens.app"
codesign --force --sign "$DATOLENS_APP_SIGN_IDENTITY" --options runtime --timestamp \
  --entitlements native/cli/Sandbox.entitlements "$app/Contents/MacOS/datolens-cli"
codesign --force --sign "$DATOLENS_APP_SIGN_IDENTITY" --options runtime --timestamp \
  --entitlements distribution/generated/Entitlements.plist "$app"
codesign --verify --deep --strict "$app"
codesign -d --entitlements :- "$app"
pkg="$project_root/artifacts/distribution/Datolens-AppStore.pkg"
xcrun productbuild --sign "$DATOLENS_INSTALLER_IDENTITY" --component "$app" /Applications "$pkg"
pkgutil --check-signature "$pkg"
echo "Signed App Store package: $pkg"
