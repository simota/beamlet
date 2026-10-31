// Shared helpers for the Beamlet pages that do not need the wasm module:
// receiver caps, camera capture and pixel-exact drawing.

// `payload`: bytes a frame carries with every tile read (`bos-lab
// layout`, STREAM_FORMAT.md §6.6).
export const MODES = [
  { name: 'stable', label: '安定', fps: 10, payload: 342 },
  { name: 'compact', label: '小画面', fps: 15, payload: 1026 },
  { name: 'standard', label: '標準', fps: 15, payload: 2832 },
  { name: 'fast', label: '高速', fps: 30, payload: 8496 },
  { name: 'fastest', label: '最速', fps: 60, payload: 9027 },
];

// Share of tiles a capture is assumed to lose (STREAM_FORMAT.md §11).
const TILE_LOSS = 0.2;
// How long one transfer may take: about as long as a person keeps a
// camera on a screen.
export const SEND_SECONDS = 300;
// Largest total the receiver takes: it drops any object over
// session.rs MAX_OBJECT, which is this plus room for the container.
const MAX_TOTAL = 64 * 1024 * 1024;

/// Bytes per second `mode` carries at the §11 tile loss, before the
/// RaptorQ repair overhead and the manifest.
export const modeRate = (mode) => mode.payload * mode.fps * (1 - TILE_LOSS);

/// The most one transfer in `mode` may carry: what it sends in
/// SEND_SECONDS, and no more than the receiver takes.
export const sendLimit = (mode) => Math.min(MAX_TOTAL, Math.floor(modeRate(mode) * SEND_SECONDS));

/// What a browser receiver can take (STREAM_FORMAT.md §5 caps), from what
/// its earlier receive runs measured (`measure`). With nothing measured:
/// ~30 fps capture, up to 2 bits per cell, grids up to the standard mode's
/// width. Fast mode's 3-bit colours and 256-cell grid are offered only
/// once a run has read them.
export function receiverCaps(measured) {
  return {
    fps: Math.max(30, measured.fps ?? 0),
    bpcMask: measured.bpc3 ? 0b111 : 0b011,
    maxCells: measured.bpc3 ? 256 : 192,
  };
}

// A run shorter than this says nothing about the rate the receiver keeps.
const MIN_RUN_MS = 5000;
// 3-bit captures that read, about a second at 30 fps, before a run judges
// the camera's colours either way.
const MIN_BPC3_CAPTURES = 30;
// Share of 3-bit tiles a run must read: fast mode's 20% tile-loss budget
// (STREAM_FORMAT.md §11).
const BPC3_READ = 0.8;

/// `measured` updated with one receive run: `ms` long, `captures` analysed,
/// and the tiles read (`ok`) and shown (`total`) over its `bpc3Captures`
/// captures that read a 3-bit frame. The latest run replaces what an
/// earlier one measured, so a camera that reads worse than it did loses
/// the faster mode on the next key code.
export function measure(measured, { ms, captures, bpc3Captures, ok, total }) {
  const next = { ...measured };
  if (ms >= MIN_RUN_MS) next.fps = Math.floor((captures * 1000) / ms);
  if (bpc3Captures >= MIN_BPC3_CAPTURES) next.bpc3 = ok >= BPC3_READ * total;
  return next;
}

export function openCamera(facingMode, fps) {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: fps } },
  });
}

/// Calls `onFrame(imageData)` for each camera frame until the returned
/// stop function is called. Frames arriving while `onFrame` runs are
/// dropped by the browser.
export async function captureFrames(stream, video, onFrame) {
  video.srcObject = stream;
  await video.play();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let running = true;
  const next = (cb) => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(cb) : requestAnimationFrame(cb));
  const step = () => {
    if (!running) return;
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    ctx.drawImage(video, 0, 0);
    onFrame(ctx.getImageData(0, 0, canvas.width, canvas.height));
    next(step);
  };
  next(step);
  return () => {
    running = false;
    stream.getTracks().forEach((t) => t.stop());
  };
}

/// Size `canvas` so a w×h image drawn into it uses an integer number of
/// physical pixels per image pixel, as large as fits in maxW×maxH CSS px.
/// Anything else blurs cell edges and creates moiré for the camera.
export function fitInteger(canvas, w, h, maxW, maxH) {
  const dpr = devicePixelRatio || 1;
  const scale = Math.max(1, Math.floor(Math.min((maxW * dpr) / w, (maxH * dpr) / h)));
  canvas.width = w * scale;
  canvas.height = h * scale;
  canvas.style.width = `${canvas.width / dpr}px`;
  canvas.style.height = `${canvas.height / dpr}px`;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/// Size `canvas` for the sender's frame (w×h, one image pixel per cell) as
/// large as fits in maxW×maxH CSS px. From 8 physical pixels per cell up,
/// the scale is not rounded down to an integer: drawn nearest-neighbour,
/// cells are then n or n + 1 pixels wide, so no cell edge is off by more
/// than half a pixel (1/16 of a cell), while rounding down would give up
/// to one pixel per cell (on a phone, 4–7% of the frame's side). Below
/// that, the uneven widths would show, so fitInteger's rule applies.
export function fitFrame(canvas, w, h, maxW, maxH) {
  const dpr = devicePixelRatio || 1;
  const fit = Math.min((maxW * dpr) / w, (maxH * dpr) / h);
  if (fit < 8) return fitInteger(canvas, w, h, maxW, maxH);
  canvas.width = Math.floor(w * fit);
  canvas.height = Math.floor(h * fit);
  canvas.style.width = `${canvas.width / dpr}px`;
  canvas.style.height = `${canvas.height / dpr}px`;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/// Draw a QR module matrix (1 = dark) with a 4-module quiet zone.
export function drawModules(canvas, modules, maxCss) {
  const side = Math.round(Math.sqrt(modules.length));
  const total = side + 8;
  const image = new ImageData(total, total);
  image.data.fill(255);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      if (modules[y * side + x]) {
        const i = ((y + 4) * total + x + 4) * 4;
        image.data[i] = image.data[i + 1] = image.data[i + 2] = 0;
      }
    }
  }
  const small = new OffscreenCanvas(total, total);
  small.getContext('2d').putImageData(image, 0, 0);
  fitInteger(canvas, total, total, maxCss, maxCss).drawImage(small, 0, 0, canvas.width, canvas.height);
}
