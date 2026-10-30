// End-to-end check of the wasm exports the pages use, in Node (same V8 as
// Chrome): key code QR → rqrr scan → send two files → frames → receive,
// once from a PC-sized sender (standard) and once from a phone-sized one
// (compact, switched to stable frames alone partway through).
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

/// A new receiver shows its key code and the sender scans it. Returns the
/// receiver's fingerprint.
function pair() {
  putInput(random(32));
  w.rx_new();
  const modules = output(w.rx_key_qr(30, 0b011, 192));
  const side = Math.sqrt(modules.length);
  const qr = new Uint8Array((side + 8) ** 2);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) qr[(y + 4) * (side + 8) + x + 4] = modules[y * side + x];
  const shot = camera(qr, side + 8, side + 8, 8, false);
  putInput(shot.data);
  assert.equal(w.tx_scan(shot.width, shot.height), 2, 'a browser receiver (30 fps, ≤2 bpc, 192 cells) takes standard mode');
  return new TextDecoder().decode(output(w.rx_fingerprint()));
}

/// Hand `files` to the sender and start it in `mode`.
function start(files, mode, rxFp) {
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
}

/// Turn a w×h RGBA image 90° clockwise, as a portrait phone shows the frame.
function rotate90(src, w, h) {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set(src.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (x * h + (h - 1 - y)) * 4);
  return out;
}

/// Stream frames into the receiver, dropping a quarter of them and showing
/// every third one rotated, until it has `files`. `onFrame(frame, shown)`
/// sees each frame as drawn. Returns the frames shown.
function transfer(files, limit, onFrame = () => {}) {
  const fw = w.tx_frame_width(), fh = w.tx_frame_height();
  let status, symbols = 0;
  for (let shown = 0; shown < limit; shown++) {
    const frame = output(w.tx_frame());
    onFrame(frame, shown);
    if (shown % 4 === 3) continue;
    const cap = shown % 3 === 1 ? camera(rotate90(frame, fw, fh), fh, fw, 5, true) : camera(frame, fw, fh, 5, true);
    putInput(cap.data);
    const r = w.rx_push(cap.width, cap.height);
    assert.ok((r >> 25) & 1, `frame ${shown} not synced`);
    const fresh = w.rx_symbols_new();
    assert.ok(fresh <= (r & 0xfff), 'new symbols never exceed tiles read');
    symbols += fresh;
    status = JSON.parse(new TextDecoder().decode(output(w.rx_status())));
    assert.equal(status.fallback_advised, false, `frame ${shown}: a camera that reads every colour is not told to switch`);
    if (!status.complete) continue;
    assert.ok(symbols > 0, 'new symbols are counted');
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
    return shown + 1;
  }
  assert.fail(`transfer did not complete within ${limit} frames`);
}

/// Whether an RGBA frame shows any colour other than greys.
function colourful(frame) {
  for (let i = 0; i < frame.length; i += 4) if (frame[i] !== frame[i + 1] || frame[i + 1] !== frame[i + 2]) return true;
  return false;
}

const files = [
  { name: 'メモ.txt', mime: 'text/plain', data: new TextEncoder().encode('beamlet '.repeat(2000)), compress: 1 },
  { name: 'photo.jpg', mime: 'image/jpeg', data: random(30000), compress: 0, thumb: random(800) },
];

// A PC-sized sender gets standard mode, which has no stable frames to switch to.
let rxFp = pair();
assert.equal(w.tx_mode(0), 2, 'a PC-sized sender gets standard mode');
start(files, w.tx_mode(0), rxFp);
assert.equal(w.tx_fallback_only(0), 0, 'standard has no stable frames to send alone');
transfer(files, 200);

// A phone-sized sender gets compact, with no stable frames in its first
// pass. Partway through it switches to stable frames alone, as for a
// camera that cannot tell compact's colours apart; the receiver keeps the
// same session and what it has already received.
rxFp = pair();
assert.equal(w.tx_mode(1), 1, 'a phone-sized sender gets compact mode');
start(files, w.tx_mode(1), rxFp);
assert.equal(w.tx_fallback_only(0), 1, 'compact has stable frames to send alone');
const SWITCH_AT = 30;
const shown = transfer(files, 1000, (frame, shown) => {
  if (shown < SWITCH_AT) {
    assert.ok(colourful(frame), `frame ${shown} of the first pass is drawn in compact`);
    if (shown === SWITCH_AT - 1) assert.equal(w.tx_fallback_only(1), 1);
  } else {
    assert.ok(!colourful(frame), `frame ${shown} after the switch is black and white`);
  }
});
assert.ok(shown > SWITCH_AT, 'the transfer went on past the switch');
