# web

The web version of Beamlet: sending (`send.html`), receiving (`receive.html`), and `lab.html` for measuring the receiver's analysis speed. Processing runs in wasm (`beamlet-stream/wasm`), and no network is used.

The UI is in Japanese; labels are quoted below as they appear on screen, with an English gloss.

## Build and run

```sh
./web/build.sh                                      # outputs the wasm to web/pkg/beamlet.wasm (requires the wasm32-unknown-unknown target)
python3 -m http.server 8765 --bind 127.0.0.1 -d web # open http://127.0.0.1:8765/lab.html
```

- The wasm is the `beamlet-stream/wasm` crate. It exports C ABI functions directly without wasm-bindgen and has no imports. The page supplies the randomness used for keys via `crypto.getRandomValues`
- `node web/test/e2e.mjs` exercises the wasm API end to end without a browser (reading the key QR → sending 2 files → receiving and verifying)
- The command above is reachable only from the same Mac (it binds to `127.0.0.1`). Two windows side by side on one Mac are enough to walk through the send and receive screens
- To open it from another device (such as a phone), serve it over HTTPS on the LAN. The camera (`getUserMedia`) is available only in a secure context, so `http://<Mac's IP>` does not work. Example: `npx http-server web -S -C cert.pem -K key.pem -a 0.0.0.0` with a certificate made by mkcert or similar (this procedure has not been tested)

## Usage

1. Open `receive.html` on the receiving device. It shows the key QR code and a confirmation code
2. Open `send.html` on the sending device, choose files, and read the receiver's QR code with the camera (「やめる」 "Cancel" stops reading). Once files and key are both present, preparation starts automatically and the mode is chosen to match the receiver (a web receiver goes up to standard mode). From a phone (short side of the screen under 600 CSS px), the mode is chosen only among the coarse-grid modes a PC camera can read (128 × 72 cells, same as stable): "compact" (4 colors, 15 fps) if the receiver can capture at 30 fps and handle 4 colors, otherwise "stable" (black and white, 10 fps). The chosen mode is shown right after reading. Mode and display size can be changed under 「詳細設定」 "Advanced settings"
3. Check that the confirmation code matches the receiver's and press 「送信を始める」 "Start sending". Frames play full screen
4. On the receiver, press 「カメラで受信を始める」 "Start receiving with camera" and point it at the sender's screen. Save links appear for each file as it arrives. Receiving can be paused and resumed, and received data is kept. When finished, 「新しく受信する」 "Receive again" starts over with a new key

The sender has no way to know when the transfer is complete, so once the receiver shows 「すべて受信しました」 "All received", tap the sender's screen to stop it.

The compact-mode stream mixes in black-and-white stable-mode frames from its second cycle through the files on, so cameras that cannot tell compact's 4 colors apart (dark, out of focus, color bleeding, and so on) still complete the transfer if left running. The mix ratio and its rationale are in docs/STREAM_FORMAT.md §6.6. A 300 KB image completes in about 31 seconds with a camera that can read compact frames, and about 2 minutes 47 seconds with one that cannot (simulation in §11 of the same document). Such a camera receives nothing during the first cycle, so after its first 30 captures of compact frames (about a second) the receiver shows 「送信側の色を読み取れていません」 "The sender's colors cannot be read" with what to do: tap the sender's screen to stop, turn on 「安定だけで送る」 "Send stable only" (shown for compact mode), and press 「送信を始める」 "Start sending" again. Every frame is then black and white (the same image in about 1 and a half minutes), and the receiver keeps what it has received. Changing the mode under 「詳細設定」 "Advanced settings" instead starts a new session, which the receiver cannot take over.

Frames on the sending screen are drawn to fill the screen's width or height. On a portrait screen they are rotated 90° to run along the long side, and a cell is not rounded down even when it does not fit a whole number of pixels (docs/STREAM_FORMAT.md §6.5).

Images can be compressed at one of three levels — 「高画質」 "High" (2048 px on the long side), 「標準」 "Standard" (1280 px) or 「軽量」 "Light" (800 px) — re-encoded as WebP, or JPEG if WebP is unavailable (re-encoding removes location and other metadata), or sent as 「原寸」 "Original size". The file list shows each file's size before and after. Either way, an 80 px thumbnail (about 1.5–2 KB) goes into the manifest, so the receiver shows a preview before the full image arrives. Formats the browser cannot read (such as HEIC outside Safari) are sent as is.

The receiver's analysis runs in a Web Worker (receive-worker.js). From the second frame on, it tracks the previous position (the receive screen shows 「追跡」 "Tracking"). While a frame of the transfer is in view, electric arcs crackle around it in the preview, harder as the transfer gets further, and the transfer ends in a flash with two fire trails. They are drawn by another Worker (spark-worker.js) on an OffscreenCanvas, so they take no time from the capture; browsers without OffscreenCanvas show no effect, and with reduced motion the frame gets a still outline instead. The sender also reads the key QR, prepares the transfer, and generates frames in a Worker (send-worker.js). One transfer is limited to 100 MB in total.

As a PWA, it can be added to the home screen and used offline. Once opened, the Service Worker (sw.js) caches the pages and the wasm; afterwards it fetches the latest files when online and opens from the cache when offline. When a page starts loading a new file, add it to `SHELL` in sw.js as well.

## lab.html

| Button | Description |
|---|---|
| synthetic benchmark | Renders a frame in wasm, pastes it slightly tilted onto a 1920×1080 canvas, and analyzes it via `getImageData` → wasm. Reports the median of 20 runs |
| start camera / stop camera | Analyzes the camera feed frame by frame in wasm. Stopping prints a report in the same format as `bos-lab analyze`. The effective payload is per real time |

To measure with a camera, play the `player.html` from `bos-lab render` on another screen and set mode, seed, and frames to match its `manifest.txt`.

Analysis runs synchronously on the main thread. The browser drops camera frames that arrive during analysis, so the displayed processed fps is the speed actually achieved.

## Measurements

| Environment | Standard | Fast | Fastest | Notes |
|---|---|---|---|---|
| Node 22 (V8), Mac | 27 ms | 40 ms | 50 ms | lab: pixel-aligned image pasted at 1920×1080, including verification against the ground truth |
| Node 22 (V8), Mac, `rx_push` | 10.5 ms | | | Receive session, 1280×720, tracking |
| Node 22 (V8), Mac, `rx_push` | 13.9 ms | | | Receive session, 1920×1080, tracking; copying the capture into wasm adds 0.2 ms |
| Chrome (extension debugger attached), Mac, Worker | 64 ms | | | Receive session, 1280×720, tracking. wasm optimizations may be disabled under the debugger, so this is not a normal browser figure |

Browser and phone figures have not been measured yet. While receiving, `receive.html` shows the average time per stage (capture grab, copy into wasm, analysis), the processed fps, and new symbols per second. Making analysis faster only shortens a transfer when the processed fps is below the sender's display fps (15 for standard and compact).
