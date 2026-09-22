# DuckDB 1.5.5

Official binary: https://github.com/duckdb/duckdb/releases/download/v1.5.5/libduckdb-osx-universal.zip

Downloaded 2026-09-22. Archive SHA-256: `7b5b8915cc382d0708636fe6385c0cdad5a61c9ff8ba2638b3e2141640783155`.

Extracted universal library SHA-256: `b9027d18ef3e8d960568f77e946a83ca68009cb22d71cf7f94de842afdd094d8`.

Bundled into Datolens.app/Contents/Frameworks, linked using @rpath. No runtime downloads. Source/license: https://github.com/duckdb/duckdb/tree/v1.5.5 (MIT).

Recreate with scripts/prepare-duckdb.sh. This pinned prebuilt library avoids a large C++ source build on a host with limited disk space.
