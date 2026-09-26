#!/bin/bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/../.." && pwd)"
work="$project_root/artifacts/distribution"
source="$work/duckdb-src"
build="$work/duckdb-build"
mkdir -p "$work"
if [ ! -d "$source" ]; then
  git clone --depth 1 --branch v1.5.5 https://github.com/duckdb/duckdb.git "$source"
fi
test "$(git -C "$source" describe --tags --exact-match)" = v1.5.5
test "$(git -C "$source" remote get-url origin)" = https://github.com/duckdb/duckdb.git
test -z "$(git -C "$source" status --porcelain)"
openssl_prefix="$work/openssl-install"
if [ ! -f "$openssl_prefix/lib/libssl.a" ] || [ ! -f "$openssl_prefix/lib/libcrypto.a" ]; then
  bash "$project_root/distribution/macos/build-openssl.sh"
fi
test -f "$openssl_prefix/lib/libssl.a"
test -f "$openssl_prefix/lib/libcrypto.a"
uvx --from cmake==4.4.3 cmake -S "$source" -B "$build" \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_DEPLOYMENT_TARGET=12.0 \
  -DCMAKE_OSX_ARCHITECTURES=arm64 '-DBUILD_EXTENSIONS=httpfs;json;icu' \
  -DBUILD_UNITTESTS=OFF -DBUILD_SHELL=OFF -DBUILD_BENCHMARKS=OFF \
  -DENABLE_EXTENSION_AUTOLOADING=OFF -DENABLE_EXTENSION_AUTOINSTALL=OFF \
  -DOPENSSL_USE_STATIC_LIBS=TRUE \
  "-DOPENSSL_SSL_LIBRARY=$openssl_prefix/lib/libssl.a" \
  "-DOPENSSL_CRYPTO_LIBRARY=$openssl_prefix/lib/libcrypto.a" \
  "-DOPENSSL_INCLUDE_DIR=$openssl_prefix/include"
uvx --from cmake==4.4.3 cmake --build "$build" --target duckdb -j 2
library="$build/src/libduckdb.dylib"
test -f "$library"
python3 - "$library" <<'PY'
import re,subprocess,sys
linked=subprocess.check_output(['otool','-L',sys.argv[1]],text=True)
if re.search(r'^\s+/(?:opt/homebrew|usr/local|Users)/',linked,re.M):
    sys.exit('Refusing a distribution library with non-system absolute dependencies.')
print(linked)
PY
echo "Built-in-httpfs candidate: $library. Native QA and Apple signing still required."
