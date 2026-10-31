import { drawModules, measure, openCamera, receiverCaps } from './beamlet.js';

// What this browser's earlier receive runs measured; the key code offers
// the caps they support (receiverCaps).
const MEASURED = 'beamlet.receiver-measured';
const measured = () => JSON.parse(localStorage.getItem(MEASURED) ?? '{}');
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

// The sender's colours do not read on this camera, but its black-and-white
// frames would; the sender can switch to them without starting over.
// #TODO(agent): UNVERIFIED — see this advice on the real receive page with a camera that cannot read compact; only the wasm flag is covered, by session.rs tests and web/test/e2e.mjs.
const FALLBACK_HINT = '送信側の色を読み取れていません。送信側の画面をタップして止め、「安定だけで送る」をオンにしてから送信を再開してください。受信済みのデータは残ります。';

function showPhase(r, elapsed) {
  if (r.status.files) overall = progress(r.status.files);
  if (r.status.complete) {
    setPhase('すべて受信しました', '下の一覧から各ファイルを保存してください。', 100);
  } else if (r.synced && r.status.fallback_advised) {
    setPhase(r.status.files ? `受信中 ${overall}%` : '受信中 — 色を読み取れていません', FALLBACK_HINT, r.status.files ? overall : null);
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

// The electric effect round the sender's frame in the viewfinder. It is
// drawn by spark-worker.js on an OffscreenCanvas; this page only maps the
// frame's corners from capture pixels onto the preview, so the capture
// loop keeps the main thread. Without OffscreenCanvas there is no effect.
const spark = (() => {
  const canvas = $('spark');
  if (!canvas.transferControlToOffscreen) {
    canvas.hidden = true;
    return null;
  }
  const w = new Worker('spark-worker.js', { type: 'module' });
  const offscreen = canvas.transferControlToOffscreen();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  w.postMessage({ type: 'init', canvas: offscreen, reduced: motion.matches }, [offscreen]);
  motion.addEventListener('change', () => w.postMessage({ type: 'reduced', reduced: motion.matches }));
  let box = { width: 0, height: 0 }, dpr = 1;
  new ResizeObserver(([entry]) => {
    box = entry.contentRect;
    dpr = devicePixelRatio || 1;
    w.postMessage({ type: 'size', width: Math.round(box.width * dpr), height: Math.round(box.height * dpr), dpr });
  }).observe($('video'));
  return {
    /// `corners` in pixels of a cw×ch capture (or null), placed where the
    /// preview shows them: the video is fitted into its box (object-fit:
    /// contain), so the capture is scaled and centred the same way.
    frame(corners, cw, ch, level, fresh) {
      let mapped = null;
      if (corners && cw && ch) {
        const s = Math.min(box.width / cw, box.height / ch);
        const ox = (box.width - cw * s) / 2, oy = (box.height - ch * s) / 2;
        mapped = [0, 2, 4, 6].map((i) => [(ox + corners[i] * s) * dpr, (oy + corners[i + 1] * s) * dpr]);
      }
      w.postMessage({ type: 'frame', corners: mapped, level, fresh });
    },
    jump: () => w.postMessage({ type: 'jump' }),
    clear: () => w.postMessage({ type: 'clear' }),
  };
})();

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
  // Per-stage time summed over this camera run, and symbols that advanced
  // the transfer: which stage limits the rate, and how fast data arrives.
  let grabMs = 0, copyMs = 0, analyzeMs = 0, symbols = 0;
  // Captures that read a 3-bit frame, and their tiles read and shown.
  let bpc3Captures = 0, bpc3Ok = 0, bpc3Total = 0;
  const started = performance.now();
  const next = (cb) => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(cb) : requestAnimationFrame(cb));

  worker.onmessage = ({ data: r }) => {
    busy = false;
    decoded++;
    copyMs += r.copyMs;
    analyzeMs += r.analyzeMs;
    symbols += r.symbolsNew;
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
      if (r.status.bpc === 3) {
        bpc3Captures++;
        bpc3Ok += r.ok;
        bpc3Total += r.total;
      }
    }
    $('step-receive').dataset.state = r.status.complete ? 'done' : r.synced ? 'synced' : r.detected ? 'foreign' : 'searching';
    showPhase(r, now - started);
    spark?.frame(r.corners, canvas.width, canvas.height, overall / 100, r.symbolsNew > 0);
    const avg = (ms) => (ms / decoded).toFixed(1);
    $('status').textContent =
      `${r.synced ? `${r.ok}/${r.total} タイル${r.tracked ? '（追跡）' : ''}、` : ''}カメラ ${canvas.width}×${canvas.height}、` +
      `処理 ${rate.toFixed(1)} fps（取得 ${avg(grabMs)}・コピー ${avg(copyMs)}・解析 ${avg(analyzeMs)} ms）、` +
      `新規 ${((symbols * 1000) / (now - started)).toFixed(0)} シンボル/秒`;
    if (r.status.complete) {
      spark?.jump();
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
      const t0 = performance.now();
      ctx.drawImage(video, 0, 0, cw, ch);
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      grabMs += performance.now() - t0;
      busy = true;
      worker.postMessage({ type: 'frame', buffer: data.buffer, width, height }, [data.buffer]);
    }
    next(step);
  };
  next(step);
  stop = () => {
    running = false;
    stream.getTracks().forEach((t) => t.stop());
    // #TODO(agent): UNVERIFIED — on a real camera, check that a run sent in hand-picked fast mode stores bpc3 and the next key code takes fast.
    const run = { ms: performance.now() - started, captures: decoded, bpc3Captures, ok: bpc3Ok, total: bpc3Total };
    localStorage.setItem(MEASURED, JSON.stringify(measure(measured(), run)));
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
    worker.postMessage({ type: 'init', caps: receiverCaps(measured()) });
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
    spark?.clear();
    $('step-receive').dataset.state = 'stopped';
    setPhase('停止しました', '「受信を再開する」で続きから受信できます。受信済みのデータは残っています。', overall);
    $('status').textContent = '';
    $('stop').textContent = '受信を再開する';
  } else {
    start();
  }
};
