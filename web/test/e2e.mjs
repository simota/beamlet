// End-to-end check of the wasm exports the pages use, in Node (same V8 as
// Chrome): key code QR → rqrr scan → send two files → frames → receive,
// once from a PC-sized sender (standard) and once from a phone-sized one
// (compact, switched to stable frames alone partway through).
// Run: ./web/build.sh && node web/test/e2e.mjs

import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { measure, receiverCaps } from '../beamlet.js';

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
  scan(output(w.rx_key_qr(30, 0b011, 192)));
  return new TextDecoder().decode(output(w.rx_fingerprint()));
}

/// The sender scans the key code with QR module matrix `modules`;
/// returns the mode index it chose.
function scanMode(modules) {
  const side = Math.sqrt(modules.length);
  const qr = new Uint8Array((side + 8) ** 2);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) qr[(y + 4) * (side + 8) + x + 4] = modules[y * side + x];
  const shot = camera(qr, side + 8, side + 8, 8, false);
  putInput(shot.data);
  return w.tx_scan(shot.width, shot.height);
}

function scan(modules) {
  assert.equal(scanMode(modules), 2, 'a browser receiver (30 fps, ≤2 bpc, 192 cells) takes standard mode');
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
    // The receive page draws round the sender frame at these corners.
    const corners = new Float32Array(output(w.rx_frame_corners()).buffer);
    assert.equal(corners.length, 8);
    for (let i = 0; i < 8; i += 2) {
      assert.ok(corners[i] > -2 && corners[i] < cap.width + 2 && corners[i + 1] > -2 && corners[i + 1] < cap.height + 2, `frame ${shown}: corner in the capture`);
    }
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

// The receive page's worker (receive-worker.js), driven as receive.js
// drives it, on its own wasm instance: what the page gets back per frame.
const replies = [];
globalThis.self = globalThis;
globalThis.postMessage = (msg) => replies.push(msg);
globalThis.fetch = async (url) => new Response(await readFile(new URL(`../${url}`, import.meta.url)), { headers: { 'content-type': 'application/wasm' } });
await import('../receive-worker.js');
assert.equal(replies.shift().type, 'ready');
self.onmessage({ data: { type: 'init', caps: { fps: 30, bpcMask: 0b011, maxCells: 192 } } });
const key = replies.shift();
scan(key.modules);
start(files, w.tx_mode(0), key.fingerprint);
{
  const fw = w.tx_frame_width(), fh = w.tx_frame_height(), got = new Map();
  let r;
  for (let shown = 0; shown < 200 && !r?.status.complete; shown++) {
    const cap = camera(output(w.tx_frame()), fw, fh, 5, true);
    self.onmessage({ data: { type: 'frame', buffer: cap.data.buffer, width: cap.width, height: cap.height } });
    r = replies.shift();
    assert.equal(r.type, 'result');
    assert.ok(r.synced, `worker frame ${shown} not synced`);
    // The frame sits 40 px in from the capture's corners (camera()).
    const want = [40, 40, cap.width - 40, 40, cap.width - 40, cap.height - 40, 40, cap.height - 40];
    assert.equal(r.corners?.length, 8, `worker frame ${shown}: four corners`);
    r.corners.forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 2, `worker frame ${shown}: corner ${r.corners} against ${want}`));
    for (const f of r.files) got.set(f.oid, f.data);
  }
  assert.ok(r.status.complete, 'the worker completes the transfer');
  for (const [i, f] of files.entries()) assert.deepEqual(got.get(r.status.files[i].oid), f.data);
  console.log('ok: receive-worker.js reports the frame corners and delivers both files');
}

// Measured caps (receive.js): nothing measured offers what pair() offers;
// a run too short, or with too few 3-bit captures, settles nothing; one
// that kept 60 fps and read fast mode's colours makes the next key code
// take fast mode, whose frames the receiver reports as 3-bit.
{
  assert.deepEqual(receiverCaps({}), { fps: 30, bpcMask: 0b011, maxCells: 192 });
  assert.deepEqual(measure({ fps: 70, bpc3: true }, { ms: 4000, captures: 400, bpc3Captures: 10, ok: 0, total: 480 }), { fps: 70, bpc3: true });
  const kept = measure({}, { ms: 10000, captures: 655, bpc3Captures: 300, ok: 12000, total: 14400 });
  assert.deepEqual(kept, { fps: 65, bpc3: true });
  assert.deepEqual(measure(kept, { ms: 10000, captures: 400, bpc3Captures: 300, ok: 11000, total: 14400 }), { fps: 40, bpc3: false }, 'a worse run takes fast mode back');
  const caps = receiverCaps(kept);
  assert.deepEqual(caps, { fps: 65, bpcMask: 0b111, maxCells: 256 });

  putInput(random(32));
  w.rx_new();
  assert.equal(scanMode(output(w.rx_key_qr(caps.fps, caps.bpcMask, caps.maxCells))), 3, 'measured caps take fast mode');
  const rxFp = new TextDecoder().decode(output(w.rx_fingerprint()));
  start(files, 3, rxFp);
  const fw = w.tx_frame_width(), fh = w.tx_frame_height();
  let status;
  for (let shown = 0; shown < 200 && !status?.complete; shown++) {
    const cap = camera(output(w.tx_frame()), fw, fh, 5, true);
    putInput(cap.data);
    assert.ok((w.rx_push(cap.width, cap.height) >> 25) & 1, `fast frame ${shown} not synced`);
    status = JSON.parse(new TextDecoder().decode(output(w.rx_status())));
    assert.equal(status.bpc, 3, `fast frame ${shown} is reported as 3-bit`);
  }
  assert.ok(status.complete, 'the fast transfer completes');
  console.log('ok: measured caps take fast mode, read as 3-bit frames');
}
