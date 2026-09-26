#!/bin/bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/../.." && pwd)"
work="$project_root/artifacts/distribution"
source="$work/openssl-src"
build="$work/openssl-build"
prefix="$work/openssl-install"
mkdir -p "$work" "$build"
if [ ! -d "$source" ]; then
  git clone --depth 1 --branch openssl-3.6.4 https://github.com/openssl/openssl.git "$source"
fi
test "$(git -C "$source" describe --tags --exact-match)" = openssl-3.6.4
test "$(git -C "$source" remote get-url origin)" = https://github.com/openssl/openssl.git
test -z "$(git -C "$source" status --porcelain)"
cd "$build"
MACOSX_DEPLOYMENT_TARGET=12.0 "$source/Configure" darwin64-arm64-cc \
  no-shared no-tests no-module --prefix="$prefix" --libdir=lib \
  -mmacosx-version-min=12.0
MACOSX_DEPLOYMENT_TARGET=12.0 make -j 2 build_libs
make install_dev
echo "Static OpenSSL headers and libraries: $prefix"
