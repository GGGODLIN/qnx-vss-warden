#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
: "${WASI_SDK_PATH:?Set WASI_SDK_PATH to the extracted official WebAssembly/wasi-sdk directory}"
cd "$repo_root"
node --experimental-strip-types scripts/generate-presets.ts
"$WASI_SDK_PATH/bin/clang" -std=c11 -O2 -Wall -Wextra -Wl,-z,stack-size=2097152 \
  src/c/vss_warden_core.c src/c/vss_warden_cli.c -lm -o runtime/vss-warden.wasm
