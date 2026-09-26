#!/bin/bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/../.." && pwd)"
source_bundle="$project_root/src-tauri/target/debug/bundle/macos/Datolens.app"
output="$project_root/website/public/downloads"
stage="$(mktemp -d "${TMPDIR:-/tmp}/datolens-beta.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
test -d "$source_bundle"
codesign --verify --deep --strict "$source_bundle"
mkdir -p "$output" "$stage/Datolens Beta"
ditto "$source_bundle" "$stage/Datolens Beta/Datolens.app"
codesign --verify --deep --strict "$stage/Datolens Beta/Datolens.app"
ln -s /Applications "$stage/Datolens Beta/Applications"
cp "$project_root/distribution/macos/BETA-README.txt" "$stage/Datolens Beta/READ ME — LEEME.txt"
filename="Datolens-0.1.0-beta.20260923-apple-silicon.dmg"
if [ -f "$output/$filename" ]; then
  echo "Refusing to overwrite a versioned download: $filename" >&2
  exit 1
fi
hdiutil create -volname 'Datolens Beta' -srcfolder "$stage/Datolens Beta" -ov -format UDZO "$output/$filename"
hdiutil verify "$output/$filename"
cd "$output"
shasum -a 256 "$filename" > SHA256SUMS.txt
python3 - "$project_root" "$filename" <<'PY'
import pathlib,json,sys,hashlib,plistlib,datetime
root=pathlib.Path(sys.argv[1]); name=sys.argv[2];dmg=root/'website/public/downloads'/name
release=json.loads((root/'website/release.json').read_text())
release.update(sizeLabel=f'{dmg.stat().st_size/1024/1024:.1f} MB',bytes=dmg.stat().st_size,sha256=hashlib.sha256(dmg.read_bytes()).hexdigest())
(root/'website/release.json').write_text(json.dumps(release,indent=2)+'\n')
bundle=root/'src-tauri/target/debug/bundle/macos/Datolens.app'
binary=bundle/'Contents/MacOS/datolens'
record={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'bundleId':plistlib.loads((bundle/'Contents/Info.plist').read_bytes())['CFBundleIdentifier'],'binarySha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'binaryMtime':binary.stat().st_mtime,'signing':'Datolens Local Development Signing','notarized':False,'release':release}
(root/'distribution/macos/beta-provenance.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(release,indent=2))
PY
