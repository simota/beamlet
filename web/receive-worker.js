// Receive-side decoding off the main thread. The page posts one camera
// frame at a time and waits for the reply, so frames that arrive while a
// frame is being decoded are skipped instead of queueing up.
//
// The wasm import below awaits at top level; messages posted before it
// settles never reach the handler, so the page waits for 'ready' first.

import { output, putInput, putRandomSecret, text, wasm } from './wasm.js';

const delivered = new Set();
const previewed = new Set();

self.onmessage = ({ data: msg }) => {
  switch (msg.type) {
    case 'init': {
      putRandomSecret();
      wasm.rx_new();
      const modules = output(wasm.rx_key_qr(msg.caps.fps, msg.caps.bpcMask, msg.caps.maxCells));
      const fingerprint = text(output(wasm.rx_fingerprint()));
      self.postMessage({ type: 'key', modules, fingerprint });
      break;
    }
    case 'frame': {
      // Copying into wasm memory and analysing are timed apart, so the
      // page can tell which stage limits the frame rate.
      const t0 = performance.now();
      putInput(new Uint8Array(msg.buffer));
      const t1 = performance.now();
      const r = wasm.rx_push(msg.width, msg.height);
      const copyMs = t1 - t0, analyzeMs = performance.now() - t1;
      const symbolsNew = wasm.rx_symbols_new();
      const status = JSON.parse(text(output(wasm.rx_status())));
      // Each verified file is sent once, its buffer transferred.
      const files = [];
      const thumbs = [];
      for (const f of status.files ?? []) {
        if (!previewed.has(f.oid)) {
          previewed.add(f.oid);
          const ptr = wasm.rx_thumbnail(f.oid);
          if (ptr) thumbs.push({ oid: f.oid, data: output(ptr) });
        }
        if (f.state === 'done' && !delivered.has(f.oid)) {
          delivered.add(f.oid);
          files.push({ oid: f.oid, data: output(wasm.rx_file(f.oid)) });
        }
      }
      self.postMessage(
        {
          type: 'result',
          ok: r & 0xfff,
          total: (r >> 12) & 0xfff,
          detected: Boolean((r >> 24) & 1),
          synced: Boolean((r >> 25) & 1),
          tracked: Boolean((r >> 26) & 1),
          copyMs,
          analyzeMs,
          symbolsNew,
          status,
          files,
          thumbs,
          buffer: msg.buffer,
        },
        [msg.buffer, ...files.map((f) => f.data.buffer), ...thumbs.map((t) => t.data.buffer)],
      );
      break;
    }
  }
};

self.postMessage({ type: 'ready' });
