import { MODES, captureFrames, fitFrame, openCamera } from './beamlet.js';
import { IMAGE_LEVELS, prepareFile } from './images.js';

// The sender's wasm runs in send-worker.js so that scanning and preparing
// large files never block this thread. Replies come back in request order,
// so each one resolves the oldest pending request; the first is 'ready'.
const worker = new Worker('send-worker.js', { type: 'module' });
const pending = [];
const workerReady = new Promise((resolve) => pending.push(resolve));
worker.onmessage = ({ data }) => pending.shift()(data);
worker.onerror = () => {
  $('scan-status').textContent = 'このブラウザでは送信の準備ができません（WebAssembly を読み込めませんでした）。';
  $('scan').disabled = true;
};
async function call(msg, transfer = []) {
  await workerReady;
  return new Promise((resolve) => {
    pending.push(resolve);
    worker.postMessage(msg, transfer);
  });
}

// Total per transfer (STREAM_FORMAT.md §3); the receiver drops objects
// larger than this, so a bigger send could never complete.
const MAX_TOTAL = 100 * 1024 * 1024;
let frameSize = [0, 0];

const $ = (id) => document.getElementById(id);
$('mode').append(...MODES.map((m, i) => new Option(`${m.label}（${m.fps} fps）`, i)));
$('mode').value = MODES.findIndex((m) => m.name === 'standard');

let scanned = false;

// The step to do next is the active one; finished steps show done.
function updateSteps() {
  const hasFiles = $('files').files.length > 0;
  $('step-files').dataset.state = hasFiles ? 'done' : 'active';
  $('step-scan').dataset.state = scanned ? 'done' : hasFiles ? 'active' : '';
  $('step-send').dataset.state = hasFiles && scanned ? 'active' : '';
}
updateSteps();

$('files').onchange = () => {
  const names = [...$('files').files].map((f) => f.name);
  $('chosen').textContent = names.length ? names.join('、') : '未選択';
  prepare();
};
$('images').onchange = () => prepare();
$('mode').onchange = () => prepare();
// Unlike the inputs above, this switch keeps the prepared session: the
// receiver goes on with the same key and keeps what it has received.
// #TODO(agent): UNVERIFIED — exercise this switch on the real send page (it needs a scanned key QR); only the wasm path is covered, by web/test/e2e.mjs.
$('stable-only').onchange = () => call({ type: 'fallbackOnly', on: $('stable-only').checked });

let stopScan = null;
function endScan(message) {
  stopScan?.();
  stopScan = null;
  $('video').hidden = true;
  $('cancel-scan').hidden = true;
  $('scan').disabled = false;
  $('scan-status').textContent = message;
}
$('cancel-scan').onclick = () => endScan('読み取りをやめました。');

$('scan').onclick = async () => {
  try {
    const stream = await openCamera($('facing').value, 30);
    $('video').hidden = false;
    $('scan').disabled = true;
    $('cancel-scan').hidden = false;
    $('scan-status').textContent = '受信側の QR コードを映してください…';
    // A phone screen shows the frame only a few centimetres wide; the
    // receiving camera then sees too few pixels per cell for the denser
    // grids, so phones keep to stable's coarse grid: compact (2 bits per
    // cell, stable frames mixed in for a camera that cannot tell its
    // colours apart) when the receiver takes it, stable otherwise.
    const smallScreen = Math.min(screen.width, screen.height) < 600;
    // One frame in the worker at a time; frames arriving meanwhile are skipped.
    let busy = false, found = false;
    stopScan = await captureFrames(stream, $('video'), async (image) => {
      if (busy || found) return;
      busy = true;
      const { mode } = await call({ type: 'scan', buffer: image.data.buffer, width: image.width, height: image.height, smallScreen }, [image.data.buffer]);
      busy = false;
      if (mode < 0 || found) return;
      found = true;
      $('mode').value = mode;
      scanned = true;
      endScan(smallScreen
        ? `読み取りました。この画面に合うモード（${MODES[mode].label}・${MODES[mode].fps} fps）を自動で選びました。このまま送信できます。`
        : `読み取りました。受信側に合わせて「${MODES[mode].label}」（${MODES[mode].fps} fps）を選びました。`);
      prepare();
    });
  } catch (e) {
    $('scan-status').textContent = `カメラを使えません: ${e.message}`;
  }
};

// Media and archives are already compressed; deflating them only costs time.
const compressible = (mime) => !/^(image|video|audio)\//.test(mime) && !/zip|gzip|compressed|x-7z|x-rar|pdf/.test(mime);

// Preparation starts by itself once files and the receiver's key are both
// in hand, and again whenever an input it depends on changes. Each run
// takes a generation number; a run overtaken by a newer one discards its
// result, so the screen always reflects the latest inputs.
let generation = 0;
const bytes = (n) => (n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
async function prepare() {
  const gen = ++generation;
  updateSteps();
  $('send').disabled = true;
  $('fp-line').hidden = true;
  $('stable-line').hidden = true;
  if (!$('files').files.length || !scanned) {
    $('prepared').replaceChildren();
    const hasFiles = $('files').files.length > 0;
    $('send-status').textContent = hasFiles
      ? '受信側の QR コードを読むと準備が始まります。'
      : scanned
        ? 'ファイルを選ぶと準備が始まります。'
        : 'ファイルを選び、受信側の QR コードを読むと準備が始まります。';
    return;
  }
  $('send-status').textContent = '準備しています…';
  const level = IMAGE_LEVELS[$('images').value] ?? null;
  const files = [], lines = [];
  let total = 0;
  for (const file of $('files').files) {
    const f = await prepareFile(file, level);
    if (gen !== generation) return;
    files.push({ name: f.name, mime: f.mime, data: f.data.buffer, thumb: f.thumb.buffer, compress: compressible(f.mime) });
    total += f.data.length;
    const li = document.createElement('li');
    li.textContent = `${f.name}: ${bytes(file.size)} → ${bytes(f.data.length)}${f.note ? ` — ${f.note}` : ''}`;
    lines.push(li);
  }
  $('prepared').replaceChildren(...lines);
  if (total > MAX_TOTAL) {
    $('send-status').textContent = `合計 ${(total / 1048576).toFixed(1)} MB は上限の 100 MB を超えています。ファイルを減らしてください。`;
    return;
  }
  const r = await call({ type: 'start', files, mode: Number($('mode').value), fallbackOnly: $('stable-only').checked }, files.flatMap((f) => [f.data, f.thumb]));
  if (gen !== generation) return;
  if (r.rc !== 0) {
    scanned = false;
    updateSteps();
    $('send-status').textContent = '受信側の QR コードを使えませんでした。もう一度読み取ってください。';
    return;
  }
  frameSize = [r.width, r.height];
  $('fingerprint').textContent = r.fingerprint;
  $('fp-line').hidden = false;
  $('stable-line').hidden = !r.fallback;
  $('send-status').textContent = `送るデータは合計 ${(total / 1024).toFixed(1)} KB です。`;
  $('send').disabled = false;
  $('send').focus();
}

$('send').onclick = async () => {
  const mode = MODES[Number($('mode').value)];
  const [w, h] = frameSize;
  const small = new OffscreenCanvas(w, h);
  const smallCtx = small.getContext('2d');
  $('setup').hidden = true;
  $('stage').hidden = false;
  try { await document.documentElement.requestFullscreen?.(); } catch {}
  let wakeLock = null;
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  const size = Number($('size').value);
  // On a portrait screen the landscape frame is drawn turned 90°, so it
  // spans the screen's long side (about twice as large); the receiver
  // finds frames at any rotation. fitFrame then fills the side that binds
  // instead of stopping at the last whole pixel per cell.
  let rotated = false;
  const fit = () => {
    rotated = innerHeight > innerWidth && w > h;
    return rotated
      ? fitFrame($('frame'), h, w, innerWidth * size, innerHeight * size)
      : fitFrame($('frame'), w, h, innerWidth * size, innerHeight * size);
  };
  let ctx = fit();
  const onResize = () => { ctx = fit(); };
  addEventListener('resize', onResize);

  // The worker renders the next frame while this one is on screen.
  let next = null;
  const fetchFrame = () => call({ type: 'frame' }).then((r) => { next = new ImageData(new Uint8ClampedArray(r.buffer), w, h); });
  fetchFrame();

  let running = true, shown = -1, displayed = 0;
  const start = performance.now();
  const tick = (now) => {
    if (!running) return;
    const idx = Math.floor(((now - start) * mode.fps) / 1000);
    if (idx !== shown && next) {
      shown = idx;
      displayed++;
      smallCtx.putImageData(next, 0, 0);
      next = null;
      fetchFrame();
      const { width: cw, height: ch } = $('frame');
      if (rotated) {
        ctx.setTransform(0, 1, -1, 0, cw, 0);
        ctx.drawImage(small, 0, 0, ch, cw);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      } else {
        ctx.drawImage(small, 0, 0, cw, ch);
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  $('stage').onclick = () => {
    running = false;
    wakeLock?.release();
    removeEventListener('resize', onResize);
    document.fullscreenElement && document.exitFullscreen();
    $('stage').hidden = true;
    $('setup').hidden = false;
    const stableHint = !$('stable-line').hidden && !$('stable-only').checked ? '受信側の進みが止まっていたら、「安定だけで送る」をオンにしてから押してください。' : '';
    $('send-status').textContent = `${displayed} フレーム表示しました。受信側で完了していなければ、もう一度「送信を始める」を押してください。${stableHint}`;
    $('send').focus();
  };
};
