import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.env.BEAMLET_REPO_ROOT ?? path.resolve(__dirname, '../../../..');
const WASM_PATH = path.join(REPO_ROOT, 'web/pkg/beamlet.wasm');
const PUBLIC_ASSETS = path.resolve(__dirname, '../public/assets');
const PROMO_ASSETS = path.resolve(__dirname, '../../assets');

function writeRgbaPng(rgba, width, height, scale) {
  const outW = width * scale;
  const outH = height * scale;
  const png = new PNG({ width: outW, height: outH });
  for (let y = 0; y < outH; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < outW; x++) {
      const sx = Math.floor(x / scale);
      const si = (sy * width + sx) * 4;
      const di = (y * outW + x) * 4;
      png.data[di] = rgba[si];
      png.data[di + 1] = rgba[si + 1];
      png.data[di + 2] = rgba[si + 2];
      png.data[di + 3] = rgba[si + 3];
    }
  }
  return PNG.sync.write(png);
}

function rotate90(src, w, h) {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const di = (x * h + (h - 1 - y)) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
  return out;
}

function deterministicBytes(len, seed) {
  const out = new Uint8Array(len);
  let s = seed >>> 0;
  for (let i = 0; i < len; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = (s >>> 16) & 0xff;
  }
  return out;
}

async function main() {
  await mkdir(path.join(PUBLIC_ASSETS, 'bos'), { recursive: true });
  await mkdir(path.join(PROMO_ASSETS, 'bos'), { recursive: true });

  const wasmBytes = await readFile(WASM_PATH);
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  const w = instance.exports;

  const putInput = (data) => {
    const ptr = w.app_input(data.length);
    new Uint8Array(w.memory.buffer, ptr, data.length).set(data);
  };
  const output = (ptr) => new Uint8Array(w.memory.buffer, ptr, w.app_out_len()).slice();

  // 1. Generate deterministic Receiver Key QR + 6-digit Fingerprint
  putInput(deterministicBytes(32, 0xbea41e71));
  w.rx_new();
  const modules = output(w.rx_key_qr(30, 0b011, 192));
  const side = Math.round(Math.sqrt(modules.length));
  const totalSide = side + 8;
  const qrRgba = new Uint8Array(totalSide * totalSide * 4).fill(255);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      if (modules[y * side + x]) {
        const idx = ((y + 4) * totalSide + (x + 4)) * 4;
        qrRgba[idx] = 0;
        qrRgba[idx + 1] = 0;
        qrRgba[idx + 2] = 0;
      }
    }
  }
  const rxFp = new TextDecoder().decode(output(w.rx_fingerprint()));
  const qrPng = writeRgbaPng(qrRgba, totalSide, totalSide, 12);
  await writeFile(path.join(PUBLIC_ASSETS, 'bos/key-qr.png'), qrPng);
  await writeFile(path.join(PROMO_ASSETS, 'bos/key-qr.png'), qrPng);

  // Scan the QR into tx state
  const camW = totalSide * 8 + 80;
  const camH = totalSide * 8 + 80;
  const camShot = new Uint8Array(camW * camH * 4).fill(96);
  for (let y = 0; y < totalSide * 8; y++) {
    for (let x = 0; x < totalSide * 8; x++) {
      const sy = Math.floor(y / 8);
      const sx = Math.floor(x / 8);
      const si = (sy * totalSide + sx) * 4;
      const di = ((y + 40) * camW + (x + 40)) * 4;
      camShot[di] = qrRgba[si];
      camShot[di + 1] = qrRgba[si + 1];
      camShot[di + 2] = qrRgba[si + 2];
      camShot[di + 3] = 255;
    }
  }
  putInput(camShot);
  const scannedMode = w.tx_scan(camW, camH);

  // Helper to export N frames for a given mode index (1 = compact, 2 = standard, 3 = fast)
  async function exportModeFrames(modeIdx, modeName, count, scale, alsoRotated = false) {
    w.tx_clear_files();
    const demoFiles = [
      {
        name: 'fuji-dusk.webp',
        mime: 'image/webp',
        data: deterministicBytes(48000, 0x12345678),
        thumb: deterministicBytes(1200, 0x87654321),
        compress: 0,
      },
      {
        name: 'deploy-keys.json',
        mime: 'application/json',
        data: new TextEncoder().encode(JSON.stringify({ env: 'airgap-prod', version: 1 }).repeat(120)),
        compress: 1,
      },
    ];
    for (const f of demoFiles) {
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
    putInput(deterministicBytes(32, 0x5eed0000 + modeIdx));
    const rc = w.tx_start(modeIdx, 42);
    if (rc !== 0) throw new Error(`tx_start failed for mode ${modeIdx}: ${rc}`);
    const txFp = new TextDecoder().decode(output(w.tx_fingerprint()));
    const fw = w.tx_frame_width();
    const fh = w.tx_frame_height();
    const framesRaw = [];

    for (let i = 0; i < count; i++) {
      const rgba = output(w.tx_frame());
      framesRaw.push(rgba);
      const fname = `bos-${modeName}-${String(i).padStart(2, '0')}.png`;
      const pngBuf = writeRgbaPng(rgba, fw, fh, scale);
      await writeFile(path.join(PUBLIC_ASSETS, 'bos', fname), pngBuf);
      if (i < 4) await writeFile(path.join(PROMO_ASSETS, 'bos', fname), pngBuf);

      if (alsoRotated) {
        const rot = rotate90(rgba, fw, fh);
        const rname = `bos-${modeName}-rot-${String(i).padStart(2, '0')}.png`;
        const rBuf = writeRgbaPng(rot, fh, fw, scale);
        await writeFile(path.join(PUBLIC_ASSETS, 'bos', rname), rBuf);
        if (i < 2) await writeFile(path.join(PROMO_ASSETS, 'bos', rname), rBuf);
      }
    }
    return { txFp, fw, fh, framesRaw };
  }

  const stableRes = await exportModeFrames(0, 'stable', 4, 6, false);
  const compactRes = await exportModeFrames(1, 'compact', 12, 6, true);
  const standardRes = await exportModeFrames(2, 'standard', 12, 6, false);
  const fastRes = await exportModeFrames(3, 'fast', 6, 4, false);

  // Create a rolling-shutter torn composite from standard frame 0 (top 54%) + frame 1 (bottom 46%)
  {
    const { fw, fh, framesRaw } = standardRes;
    const f0 = framesRaw[0];
    const f1 = framesRaw[1];
    const splitY = Math.floor(fh * 0.54);
    const torn = new Uint8Array(f0.length);
    const splitByte = splitY * fw * 4;
    torn.set(f0.subarray(0, splitByte), 0);
    torn.set(f1.subarray(splitByte), splitByte);
    const tornPng = writeRgbaPng(torn, fw, fh, 6);
    await writeFile(path.join(PUBLIC_ASSETS, 'bos/bos-standard-torn.png'), tornPng);
    await writeFile(path.join(PROMO_ASSETS, 'bos/bos-standard-torn.png'), tornPng);
  }

  const meta = {
    fingerprint: rxFp,
    scannedMode,
    qrModulesSide: side,
    stableSize: [stableRes.fw, stableRes.fh],
    compactSize: [compactRes.fw, compactRes.fh],
    standardSize: [standardRes.fw, standardRes.fh],
    fastSize: [fastRes.fw, fastRes.fh],
  };
  await writeFile(path.join(PUBLIC_ASSETS, 'bos/meta.json'), JSON.stringify(meta, null, 2));
  await writeFile(path.join(PROMO_ASSETS, 'bos/meta.json'), JSON.stringify(meta, null, 2));
  console.log('Generated authentic BOS1 assets:', meta);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
