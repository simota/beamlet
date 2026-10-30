#!/bin/sh
# Build the wasm module the pages load from web/pkg/.
set -eu
cd "$(dirname "$0")/.."
cargo build -p beamlet-stream-wasm --release --target wasm32-unknown-unknown
mkdir -p web/pkg
cp target/wasm32-unknown-unknown/release/beamlet_stream_wasm.wasm web/pkg/beamlet.wasm
