// Browser receive-side lab: feeds canvas captures to the wasm decoder and
// scores them against the seeded ground truth (beamlet-stream/src/lab.rs).

const MODES = ['stable', 'compact', 'standard', 'fast', 'fastest'];
const $ = (id) => document.getElementById(id);
const { instance } = await WebAssembly.instantiateStreaming(fetch('pkg/beamlet.wasm'));
const wasm = instance.exports;

let tilesPerFrame = 0;

function init() {
  tilesPerFrame = wasm.lab_init(MODES.indexOf($('mode').value), Number($('seed').value), Number($('frames').value));
  if (tilesPerFrame < 0) throw new Error('invalid stream parameters');
}

// lab_input may grow wasm memory, which detaches earlier views of
// memory.buffer, so the view is taken only after the call.
function push(image) {
  const ptr = wasm.lab_input(image.data.length);
  new Uint8Array(wasm.memory.buffer, ptr, image.data.length).set(image.data);
  const t0 = performance.now();
  const ok = wasm.lab_push(image.width, image.height);
  const ms = performance.now() - t0;
  wasm.lab_record_time(ms);
  return { ok, ms };
}

function report(captureFps) {
  const ptr = wasm.lab_report(captureFps);
  return new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, ptr, wasm.lab_report_len()));
}

const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

async function synthetic() {
  init();
  const view = $('view');
  view.width = 1920;
  view.height = 1080;
  const ctx = view.getContext('2d', { willReadFrequently: true });
  const frame = document.createElement('canvas');
  const grabs = [], decodes = [];
  let ok = 0;
  for (let f = 0; f < 20; f++) {
    const ptr = wasm.lab_render(f, 5);
    const fw = wasm.lab_frame_width(), fh = wasm.lab_frame_height();
    frame.width = fw;
    frame.height = fh;
    frame.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(wasm.memory.buffer, ptr, fw * fh * 4).slice(), fw, fh), 0, 0);
    // A slight alternating tilt so every capture goes through resampling.
    ctx.fillStyle = '#606060';
    ctx.fillRect(0, 0, view.width, view.height);
    ctx.save();
    ctx.translate(view.width / 2, view.height / 2);
    ctx.rotate(f % 2 ? 0.03 : -0.03);
    ctx.drawImage(frame, -fw / 2, -fh / 2);
    ctx.restore();

    const t0 = performance.now();
    const image = ctx.getImageData(0, 0, view.width, view.height);
    grabs.push(performance.now() - t0);
    const r = push(image);
    decodes.push(r.ms);
    ok += Math.max(r.ok, 0);
    $('live').textContent = `synthetic ${f + 1}/20  decode ${r.ms.toFixed(1)} ms  tiles ${r.ok}/${tilesPerFrame}`;
    await new Promise(requestAnimationFrame);
  }
  $('out').textContent =
    `synthetic ${$('mode').value}, 1920x1080, 20 captures\n` +
    `tiles decodable   ${ok} / ${20 * tilesPerFrame}\n` +
    `getImageData      median ${median(grabs).toFixed(1)} ms\n` +
    `decode (wasm)     median ${median(decodes).toFixed(1)} ms\n`;
}

let session = null;

async function startCamera() {
  init();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: Number($('fps').value) } },
  });
  const video = $('video');
  video.srcObject = stream;
  await video.play();
  const s = stream.getVideoTracks()[0].getSettings();
  const view = $('view');
  const ctx = view.getContext('2d', { willReadFrequently: true });
  session = { stream, start: performance.now(), decoded: 0, settings: `${s.width}x${s.height} @ ${s.frameRate} fps` };
  $('camera').textContent = 'stop camera';

  // Decoding is synchronous, so frames that arrive while it runs are
  // dropped by the browser; the processed rate is the real throughput.
  const next = (cb) => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(cb) : requestAnimationFrame(cb));
  const step = () => {
    if (!session) return;
    if (view.width !== video.videoWidth || view.height !== video.videoHeight) {
      view.width = video.videoWidth;
      view.height = video.videoHeight;
    }
    ctx.drawImage(video, 0, 0);
    const r = push(ctx.getImageData(0, 0, view.width, view.height));
    session.decoded++;
    const secs = (performance.now() - session.start) / 1000;
    $('live').textContent =
      `camera ${session.settings}  processed ${(session.decoded / secs).toFixed(1)} fps  ` +
      `decode ${r.ms.toFixed(1)} ms  tiles ${r.ok < 0 ? 'not found' : `${r.ok}/${tilesPerFrame}`}`;
    next(step);
  };
  next(step);
}

function stopCamera() {
  const secs = (performance.now() - session.start) / 1000;
  session.stream.getTracks().forEach((t) => t.stop());
  $('out').textContent = `camera ${session.settings}\n` + report(session.decoded / secs);
  session = null;
  $('camera').textContent = 'start camera';
}

const guard = (fn) => () => fn().catch((e) => { $('out').textContent = String(e); });
$('synthetic').onclick = guard(synthetic);
$('camera').onclick = guard(async () => (session ? stopCamera() : startCamera()));
