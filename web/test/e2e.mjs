// End-to-end check of the wasm exports the pages use, in Node (same V8 as
// Chrome): key code QR → rqrr scan → send two files → frames → receive.
// Run: ./web/build.sh && node web/test/e2e.mjs

import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const bytes = await readFile(new URL('../pkg/beamlet.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(bytes, {});
const w = instance.exports;

const putInput = (data) => {
  const ptr = w.app_input(data.length);
  new Uint8Array(w.memory.buffer, ptr, data.length).set(data);
};
const output = (ptr) => new Uint8Array(w.memory.buffer, ptr, w.app_out_len()).slice();
const random = (n) => crypto.getRandomValues(new Uint8Array(n));

/// Nearest-neighbour upscale of a 1-bit or RGBA image into an RGBA canvas
/// with a grey border, as a camera would roughly see it.
function camera(src, sw, sh, scale, rgba) {
  const W = sw * scale + 80, H = sh * scale + 80, out = new Uint8Array(W * H * 4).fill(96);
  for (let y = 0; y < sh * scale; y++) {
    for (let x = 0; x < sw * scale; x++) {
      const s = Math.floor(y / scale) * sw + Math.floor(x / scale), o = ((y + 40) * W + x + 40) * 4;
      if (rgba) out.set(src.subarray(s * 4, s * 4 + 3), o);
      else out.fill(src[s] ? 0 : 255, o, o + 3);
      out[o + 3] = 255;
    }
  }
  return { data: out, width: W, height: H };
}

// Receiver shows its key code.
putInput(random(32));
w.rx_new();
const modules = output(w.rx_key_qr(30, 0b011, 192));
const side = Math.sqrt(modules.length);
const qr = new Uint8Array((side + 8) ** 2);
for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) qr[(y + 4) * (side + 8) + x + 4] = modules[y * side + x];
const rxFp = new TextDecoder().decode(output(w.rx_fingerprint()));

// Sender scans it and picks the receiver's mode.
const shot = camera(qr, side + 8, side + 8, 8, false);
putInput(shot.data);
assert.equal(w.tx_scan(shot.width, shot.height), 2, 'a browser receiver (30 fps, ≤2 bpc, 192 cells) takes standard mode');
const mode = w.tx_mode(0);
assert.equal(mode, 2, 'a PC-sized sender gets standard mode');
assert.equal(w.tx_mode(1), 1, 'a phone-sized sender gets compact mode');

const files = [
  { name: 'メモ.txt', mime: 'text/plain', data: new TextEncoder().encode('beamlet '.repeat(2000)), compress: 1 },
  { name: 'photo.jpg', mime: 'image/jpeg', data: random(30000), compress: 0, thumb: random(800) },
];
w.tx_clear_files();
for (const f of files) {
  putInput(new TextEncoder().encode(f.name));
  w.tx_file_name();
  putInput(new TextEncoder().encode(f.mime));
  w.tx_file_mime();
  if (f.thumb) {
    putInput(f.thumb);
    w.tx_file_thumb();
  }
  putInput(f.data);
  w.tx_file_data(f.compress);
}
putInput(random(32));
assert.equal(w.tx_start(mode, 7), 0);
assert.equal(new TextDecoder().decode(output(w.tx_fingerprint())), rxFp, 'both screens show the same fingerprint');

/// Turn a w×h RGBA image 90° clockwise, as a portrait phone shows the frame.
function rotate90(src, w, h) {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set(src.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (x * h + (h - 1 - y)) * 4);
  return out;
}

// Stream frames into the receiver, dropping a quarter of them and showing
// every third one rotated.
const fw = w.tx_frame_width(), fh = w.tx_frame_height();
let shown = 0, status;
for (; shown < 200; shown++) {
  const frame = output(w.tx_frame());
  if (shown % 4 === 3) continue;
  const cap = shown % 3 === 1 ? camera(rotate90(frame, fw, fh), fh, fw, 5, true) : camera(frame, fw, fh, 5, true);
  putInput(cap.data);
  const r = w.rx_push(cap.width, cap.height);
  assert.ok((r >> 25) & 1, `frame ${shown} not synced`);
  status = JSON.parse(new TextDecoder().decode(output(w.rx_status())));
  if (status.complete) break;
}
assert.ok(status.complete, 'transfer completes');
for (const [i, f] of files.entries()) {
  const entry = status.files[i];
  assert.equal(entry.name, f.name);
  assert.equal(entry.state, 'done');
  assert.deepEqual(output(w.rx_file(entry.oid)), f.data);
  const thumb = w.rx_thumbnail(entry.oid);
  if (f.thumb) assert.deepEqual(output(thumb), f.thumb);
  else assert.equal(thumb, 0, 'no thumbnail was sent');
}
console.log(`ok: ${files.length} files in ${shown + 1} frames (${fw}x${fh} cells incl. quiet zone)`);
