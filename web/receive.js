import { drawModules, openCamera } from './beamlet.js';

// What a browser receiver can take (STREAM_FORMAT.md §5 caps): ~30 fps
// capture, up to 2 bits per cell, grids up to the standard mode's width.
const CAPS = { fps: 30, bpcMask: 0b011, maxCells: 192 };
const $ = (id) => document.getElementById(id);

const worker = new Worker('receive-worker.js', { type: 'module' });
const links = new Map();
const previews = new Map();
let stop = null;

// One row per file, created once. A row is rewritten only when its state
// or progress changes, and its image elements are made once and moved
// back in, so a decoded frame costs no DOM work for unchanged files.
const rows = new Map();

function image(src, className) {
  const img = document.createElement('img');
  img.src = src;
  if (className) img.className = className;
  return img;
}

function showFiles(status) {
  if (!status.files) return;
  for (const f of status.files) {
    let row = rows.get(f.oid);
    if (!row) {
      row = { li: document.createElement('li'), key: '', preview: null, full: null };
      row.li.className = 'file';
      rows.set(f.oid, row);
      $('files').append(row.li);
    }
    const pct = f.needed ? Math.min(99, Math.floor((100 * f.received) / f.needed)) : 0;
    const ready = f.state === 'done' && links.has(f.oid);
    const key = `${f.state}|${pct}|${ready}|${previews.has(f.oid)}`;
    if (row.key === key) continue;
    row.key = key;

    const { li } = row;
    li.dataset.state = f.state;
    const label = `${f.name}（${(f.size / 1024).toFixed(1)} KB）`;
    if (ready) {
      const a = document.createElement('a');
      a.href = links.get(f.oid);
      a.download = f.name;
      a.textContent = `${label} を保存`;
      if (f.mime.startsWith('image/')) row.full ??= image(links.get(f.oid));
      li.replaceChildren(a, ...(row.full ? [row.full] : []));
    } else if (f.state === 'failed') {
      li.replaceChildren(`${label} — 検証に失敗しました`);
    } else {
      li.style.setProperty('--p', pct);
      if (previews.has(f.oid)) row.preview ??= image(previews.get(f.oid), 'preview');
      li.replaceChildren(`${label} — ${pct}%`, ...(row.preview ? [row.preview] : []));
    }
  }
}

// The headline above the viewfinder: what is happening, what to do about
// it, and how far the whole transfer has got. Kept across stop/resume, as
// the session and its received data are.
let tiles = 0, everSynced = false, overall = 0;
// After this long without ever finding the sender, the hint gets specific.
const SEARCH_PATIENCE_MS = 6000;

function setPhase(label, hint, pct) {
  if ($('phase-label').textContent !== label) $('phase-label').textContent = label;
  if ($('phase-hint').textContent !== hint) $('phase-hint').textContent = hint;
  const meter = $('meter');
  if (pct === null) {
    meter.dataset.indeterminate = '';
    meter.removeAttribute('aria-valuenow');
  } else {
    delete meter.dataset.indeterminate;
    meter.style.setProperty('--p', pct);
    meter.setAttribute('aria-valuenow', pct);
  }
}

/// Size-weighted share of all files received, failed files left out.
function progress(files) {
  let total = 0, got = 0;
  for (const f of files) {
    if (f.state === 'failed') continue;
    const w = Math.max(1, f.size);
    total += w;
    got += f.state === 'done' ? w : f.needed ? (w * Math.min(f.received, f.needed)) / f.needed : 0;
  }
  return total ? Math.min(99, Math.floor((100 * got) / total)) : 0;
}

function showPhase(r, elapsed) {
  if (r.status.files) overall = progress(r.status.files);
  if (r.status.complete) {
    setPhase('すべて受信しました', '下の一覧から各ファイルを保存してください。', 100);
  } else if (r.synced && r.status.files) {
    setPhase(`受信中 ${overall}%`, 'このまま送信側の画面を映し続けてください。', overall);
  } else if (r.synced) {
    setPhase('受信中 — ファイル一覧を待っています', `データを受け取っています（${tiles} タイル）。このまま映し続けてください。`, null);
  } else if (r.detected) {
    setPhase('別の送信の画面が映っています', '送信側でこの画面の QR コードを読み直し、確認番号が一致することを確かめてください。', overall);
  } else if (everSynced) {
    setPhase('送信側の画面を見失いました', '送信側の画面全体（4 隅のマーカー）が枠に収まるように戻してください。受信済みのデータは残っています。', overall);
  } else {
    setPhase(
      '送信側の画面を探しています',
      elapsed > SEARCH_PATIENCE_MS
        ? 'まだ見つかりません。送信側の画面全体が映る距離に調整し、送信側の画面を明るくするか、送信側で表示を小さくしてください。'
        : '送信側の画面全体（4 隅のマーカー）がカメラに映るようにしてください。',
      0,
    );
  }
}

// Captures are scaled so their long side is at most this many pixels: a
// camera that delivers 4K would otherwise quadruple every frame's copies.
const MAX_CAPTURE = 1920;

async function startCamera() {
  const stream = await openCamera('environment', 60);
  const video = $('video');
  video.srcObject = stream;
  await video.play();
  $('step-key').hidden = true;
  $('step-receive').hidden = false;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let running = true, busy = false, decoded = 0;
  const started = performance.now();
  const next = (cb) => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(cb) : requestAnimationFrame(cb));

  worker.onmessage = ({ data: r }) => {
    busy = false;
    decoded++;
    for (const t of r.thumbs) previews.set(t.oid, URL.createObjectURL(new Blob([t.data], { type: 'image/jpeg' })));
    for (const f of r.files) {
      const meta = r.status.files.find((x) => x.oid === f.oid);
      links.set(f.oid, URL.createObjectURL(new Blob([f.data], { type: meta.mime })));
    }
    const now = performance.now();
    const rate = (decoded * 1000) / (now - started);
    showFiles(r.status);
    // A frame already in the worker can answer after the user stopped; it
    // still delivers data, but must not overwrite the stopped status.
    if (!running && !r.status.complete) return;
    if (r.synced) {
      tiles += r.ok;
      everSynced = true;
    }
    $('step-receive').dataset.state = r.status.complete ? 'done' : r.synced ? 'synced' : r.detected ? 'foreign' : 'searching';
    showPhase(r, now - started);
    $('status').textContent = r.synced
      ? `${r.ok}/${r.total} タイル、解析 ${r.ms.toFixed(0)} ms${r.tracked ? '（追跡）' : ''}、${rate.toFixed(1)} fps`
      : `カメラ ${canvas.width}×${canvas.height}、${rate.toFixed(1)} fps`;
    if (r.status.complete) {
      stop?.();
      $('stop').hidden = true;
      $('again').hidden = false;
      $('again').focus();
    }
  };

  const step = () => {
    if (!running) return;
    if (!busy) {
      const scale = Math.min(1, MAX_CAPTURE / Math.max(video.videoWidth, video.videoHeight));
      const cw = Math.round(video.videoWidth * scale), ch = Math.round(video.videoHeight * scale);
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      ctx.drawImage(video, 0, 0, cw, ch);
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      busy = true;
      worker.postMessage({ type: 'frame', buffer: data.buffer, width, height }, [data.buffer]);
    }
    next(step);
  };
  next(step);
  stop = () => {
    running = false;
    stream.getTracks().forEach((t) => t.stop());
    stop = null;
  };
  $('stop').textContent = '受信をやめる';
}

worker.onerror = () => {
  $('key-status').textContent = 'このブラウザでは受信の準備ができません（WebAssembly を読み込めませんでした）。';
  $('start').disabled = true;
};

worker.onmessage = ({ data: msg }) => {
  if (msg.type === 'ready') {
    worker.postMessage({ type: 'init', caps: CAPS });
  } else if (msg.type === 'key') {
    // Fit the code inside the panel: its content box less the plate's padding.
    const panel = $('step-key');
    const pad = (el) => parseFloat(getComputedStyle(el).paddingLeft) + parseFloat(getComputedStyle(el).paddingRight);
    const room = panel.clientWidth - pad(panel) - pad(document.querySelector('.plate'));
    drawModules($('qr'), msg.modules, Math.min(320, room));
    $('fingerprint').textContent = msg.fingerprint;
    $('fingerprint-rx').textContent = msg.fingerprint;
  }
};

const start = () => startCamera().catch((e) => {
  $('key-status').textContent = `カメラを使えません: ${e.message}`;
  $('status').textContent = `カメラを使えません: ${e.message}`;
});
$('start').onclick = start;

// Stopping keeps the session and everything received; the same button
// resumes with a fresh camera stream.
$('stop').onclick = () => {
  if (stop) {
    stop();
    $('step-receive').dataset.state = 'stopped';
    setPhase('停止しました', '「受信を再開する」で続きから受信できます。受信済みのデータは残っています。', overall);
    $('status').textContent = '';
    $('stop').textContent = '受信を再開する';
  } else {
    start();
  }
};
