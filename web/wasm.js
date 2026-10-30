// The wasm module and the buffer conventions of its exports
// (beamlet-stream/wasm/src/app.rs).

const { instance } = await WebAssembly.instantiateStreaming(fetch('pkg/beamlet.wasm'));
export const wasm = instance.exports;

// app_input may grow wasm memory, which detaches earlier views of
// memory.buffer, so the view is taken only after the call.
export function putInput(bytes) {
  const ptr = wasm.app_input(bytes.length);
  new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);
}

// Exports that return bytes all write one output buffer: read each result
// before calling the next such export.
export function output(ptr) {
  return new Uint8Array(wasm.memory.buffer, ptr, wasm.app_out_len()).slice();
}

export function putRandomSecret() {
  putInput(crypto.getRandomValues(new Uint8Array(32)));
}

export const text = (bytes) => new TextDecoder().decode(bytes);
