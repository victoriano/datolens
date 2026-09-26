#!/bin/bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/../.." && pwd)"
pkg="$project_root/artifacts/distribution/Datolens-AppStore.pkg"
: "${APPLE_API_KEY_ID:?Set the App Store Connect API key ID; never the secret content}"
: "${APPLE_API_ISSUER:?Set the App Store Connect issuer ID}"
test -f "$pkg"
xcrun --find altool >/dev/null
pkgutil --check-signature "$pkg"
xcrun altool --validate-app --type macos --file "$pkg" --apiKey "$APPLE_API_KEY_ID" --apiIssuer "$APPLE_API_ISSUER"
xcrun altool --upload-app --type macos --file "$pkg" --apiKey "$APPLE_API_KEY_ID" --apiIssuer "$APPLE_API_ISSUER"
