#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
mkdir -p vendor/duckdb
archive=$(mktemp -t datolens-duckdb)
trap 'rm -f "$archive"' EXIT
curl -fL --retry 2 https://github.com/duckdb/duckdb/releases/download/v1.5.5/libduckdb-osx-universal.zip -o "$archive"
actual=$(shasum -a 256 "$archive" | cut -d ' ' -f 1)
[[ "$actual" = 7b5b8915cc382d0708636fe6385c0cdad5a61c9ff8ba2638b3e2141640783155 ]] || { print -u2 'DuckDB archive checksum mismatch'; exit 1; }
unzip -j -o "$archive" libduckdb.dylib duckdb.h -d vendor/duckdb
