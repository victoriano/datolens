#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
export PATH="$HOME/.cargo/bin:$PATH"
if [[ ! -f vendor/duckdb/libduckdb.dylib ]]; then
  print -u2 'Missing pinned DuckDB library; run scripts/prepare-duckdb.sh first.'
  exit 1
fi
bun tauri build --debug --bundles app

bundle="$PWD/src-tauri/target/debug/bundle/macos/Datolens.app"
codesign --force --sign - --timestamp=none "$bundle/Contents/Frameworks/libduckdb.dylib"
codesign --force --sign - --timestamp=none "$bundle"
codesign --verify --deep --strict "$bundle"
