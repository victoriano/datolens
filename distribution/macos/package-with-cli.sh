#!/bin/bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/../.." && pwd)"
: "${DATOLENS_INSTALLER_IDENTITY:?Set the Developer ID Installer signing identity}"
source_app="${1:?Pass the exact notarized Datolens.app}"
output_pkg="${2:?Pass a new output .pkg path}"
test -d "$source_app"
test ! -e "$output_pkg"
codesign --verify --deep --strict "$source_app"
xcrun stapler validate "$source_app"
test -x "$source_app/Contents/MacOS/datolens-cli"
stage="$(mktemp -d "${TMPDIR:-/tmp}/datolens-pkg.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/Applications" "$stage/usr/local/bin"
ditto "$source_app" "$stage/Applications/Datolens.app"
ln -s /Applications/Datolens.app/Contents/MacOS/datolens-cli "$stage/usr/local/bin/datolens"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$source_app/Contents/Info.plist")"
pkgbuild --root "$stage" --install-location / --identifier com.victoriano.datolens.direct \
  --version "$version" --sign "$DATOLENS_INSTALLER_IDENTITY" "$output_pkg"
pkgutil --check-signature "$output_pkg"
echo "Signed direct-download package with CLI: $output_pkg"
