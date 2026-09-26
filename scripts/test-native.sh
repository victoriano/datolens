#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
export PATH="$HOME/.cargo/bin:$PATH"
# Match tauri.conf.json so native dependencies can be reused between tests/builds.
export MACOSX_DEPLOYMENT_TARGET=12.0
export DYLD_LIBRARY_PATH="$PWD/vendor/duckdb${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
export CARGO_TARGET_DIR="$PWD/src-tauri/target"
export CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0
python3 scripts/build-cli.py
python3 scripts/test-cli.py
cargo test --manifest-path src-tauri/Cargo.toml --features tauri/custom-protocol --lib
cargo test --manifest-path src-tauri/crates/datolens-data/Cargo.toml
cargo test --manifest-path src-tauri/crates/datolens-enrichment/Cargo.toml
