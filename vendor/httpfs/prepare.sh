#!/bin/sh
set -eu
cd "$(dirname "$0")"
archive=$(mktemp)
extension=$(mktemp)
trap 'rm -f "$archive" "$extension"' EXIT
curl -fL --retry 2 'https://extensions.duckdb.org/v1.5.5/osx_arm64/httpfs.duckdb_extension.gz' -o "$archive"
actual=$(shasum -a 256 "$archive" | cut -d ' ' -f 1)
[ "$actual" = '758acc0b0c4fbf09506f387ff6f52826b1038b7b6849ded39928d2f992945230' ] || exit 1
gzip -dc "$archive" > "$extension"
actual=$(shasum -a 256 "$extension" | cut -d ' ' -f 1)
[ "$actual" = '10514b4ef19f80bf4ec4bf90c124f5d34625f2606263b40ae8ec7979905bb779' ] || exit 1
mkdir -p osx_arm64
mv "$extension" osx_arm64/httpfs.duckdb_extension
