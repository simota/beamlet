// The sender's wasm, off the main thread: key-code scanning per camera
// frame, session preparation (encryption and RaptorQ encoding of every
// file) and frame generation. Replies are posted in request order.
//
// The wasm import below awaits at top level; messages posted before it
// settles never reach the handler, so the page waits for 'ready' first.

import { output, putInput, putRandomSecret, text, wasm } from './wasm.js';

const enc = new TextEncoder();

self.onmessage = ({ data: msg }) => {
  switch (msg.type) {
    case 'scan': {
      putInput(new Uint8Array(msg.buffer));
      const read = wasm.tx_scan(msg.width, msg.height) >= 0;
      self.postMessage({ type: 'scan', mode: read ? wasm.tx_mode(msg.smallScreen ? 1 : 0) : -1 });
      break;
    }
    case 'start': {
      wasm.tx_clear_files();
      for (const f of msg.files) {
        putInput(enc.encode(f.name));
        wasm.tx_file_name();
        putInput(enc.encode(f.mime));
        wasm.tx_file_mime();
        if (f.thumb.byteLength) {
          putInput(new Uint8Array(f.thumb));
          wasm.tx_file_thumb();
        }
        putInput(new Uint8Array(f.data));
        wasm.tx_file_data(f.compress ? 1 : 0);
      }
      putRandomSecret();
      const rc = wasm.tx_start(msg.mode, crypto.getRandomValues(new Uint32Array(1))[0]);
      self.postMessage(
        rc === 0
          ? {
              type: 'started',
              rc,
              fingerprint: text(output(wasm.tx_fingerprint())),
              width: wasm.tx_frame_width(),
              height: wasm.tx_frame_height(),
              fallback: wasm.tx_fallback_only(msg.fallbackOnly ? 1 : 0) === 1,
            }
          : { type: 'started', rc },
      );
      break;
    }
    case 'fallbackOnly': {
      self.postMessage({ type: 'fallbackOnly', fallback: wasm.tx_fallback_only(msg.on ? 1 : 0) === 1 });
      break;
    }
    case 'frame': {
      const rgba = output(wasm.tx_frame());
      self.postMessage({ type: 'frame', buffer: rgba.buffer }, [rgba.buffer]);
      break;
    }
  }
};

self.postMessage({ type: 'ready' });
