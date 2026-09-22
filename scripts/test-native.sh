#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
export PATH="$HOME/.cargo/bin:$PATH"
export DYLD_LIBRARY_PATH="$PWD/vendor/duckdb${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
export CARGO_TARGET_DIR="$PWD/src-tauri/target"
export CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0
cargo test --manifest-path src-tauri/Cargo.toml --features tauri/custom-protocol --lib
cargo test --manifest-path src-tauri/crates/datolens-data/Cargo.toml
cargo test --manifest-path src-tauri/crates/datolens-enrichment/Cargo.toml
