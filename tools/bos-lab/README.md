# bos-lab

Offline measurement tool for BOS1 (`docs/STREAM_FORMAT.md`). It generates test frames to show on a screen, analyzes video recorded with a camera, and measures cell error rate, tile loss, and effective throughput. It does not include RaptorQ, encryption, or the app.

Run it from the repository root (the Cargo workspace). Detection and rendering live in the `beamlet-stream` crate; this tool is the CLI and synthetic camera on top of it.

```sh
cargo build --release -p bos-lab   # requires ffmpeg / ffprobe on PATH; the binary is target/release/bos-lab
cargo test --workspace             # verify the analysis pipeline with the synthetic camera
```

## Commands

| Command | Description |
|---|---|
| `bos-lab layout` | Prints the data-cell ratio, tile count, and theoretical throughput for each mode's actual layout |
| `bos-lab render --out DIR --mode M [--mp4]` | Writes `DIR/frames/*.png` (1 cell = 1 px), `manifest.txt`, and `player.html`. With `--mp4`, also writes `stream.mp4` |
| `bos-lab analyze --manifest DIR/manifest.txt --capture FILE [--csv OUT] [--metric rgb\|ycc]` | Analyzes a recorded video (any format ffmpeg can read) or a PNG |
| `bos-lab sim --mode M [--cell-px N] [--captures N] [--dump DIR]` | Exercises the analysis with a synthetic camera (tilt, 180° rotation, blur, noise, color shift, barrel distortion, tearing) |

Stream parameters start from `--mode stable|compact|standard|fast|fastest` and can be overridden with `--grid WxH --bpc N --parity F --fps N --palette NAME --seed N --frames N`. Palettes: `bw` for bpc1, `kwrc` / `kwby` for bpc2, and `rgb8` for bpc3.

## Capture procedure

1. `bos-lab render --out tools/bos-lab/out/standard --mode standard` (use a separate output directory for each condition you compare; `out/` is ignored by git)
2. Open `tools/bos-lab/out/standard/player.html` on the sending screen
   - Mac: open it directly in a browser
   - iPhone / Android: run `python3 -m http.server -d tools/bos-lab/out/standard` on the Mac and open it from the same LAN
   - Set the screen brightness to maximum; tapping starts full-screen playback. Override the display fps with `?fps=30`. If `skipped` in the lower left keeps increasing, the display cannot keep up with the fps
3. Record for at least 10 seconds with the receiving camera, at a distance where the frame fills 70–90% of the view; hand-held is fine. Note the capture fps (30 / 60 / 120) and resolution
   - To measure by receiving directly in a browser, use `web/lab.html` instead of step 4 (`web/README.md`)
4. Copy the video to the Mac and run `bos-lab analyze --manifest tools/bos-lab/out/standard/manifest.txt --capture IMG_0001.MOV --csv run.csv`
   - Trim the parts at the start and end where the camera is not pointed at the screen, because effective throughput is divided by the length of the whole video

`stream.mp4` is a fallback when `player.html` cannot be used. It is compressed as YUV 4:2:0 with `crf 8`. Analyzing the video directly without going through a camera, all tiles were readable in all 4 modes (4 px cells for the fastest mode). However, this bypasses the playback device's decoder and color processing.

## Reading the output

| Field | Meaning |
|---|---|
| tiles decodable | Fraction of tiles correctable by bounded-distance decoding of RS(255, k). Judged by the number of byte errors against the ground truth (the RS decoder itself is not run) |
| cell error rate | Error rate of cell color classification (modulation quality only) |
| torn captures | Number of captured images that contained tiles from two or more displayed frames (tearing caused by the rolling shutter) |
| effective payload | Deduplicated readable tiles × net bytes per tile ÷ video length |
| analysis time | Analysis time per frame on this Mac. Not the same as speed on real devices |

## Simplifications compared with BOS1

- Timing patterns are not drawn. Alignment uses only the four corner markers and the alignment markers
- The header band only reserves its area and is filled with random data. It is not read
- Which frame a captured image belongs to is identified by matching against the ground truth, not from the header

## Notes

- Stable mode (bpc1) has only 3 tiles per frame. Each tile spans roughly 16 rows, so a tear loses a third of the frame at once
- With pixel-aligned random data, patterns identical to the finder's center line appear frequently, so the ratio scan alone cannot tell them from real finders. Detection is confirmed by template-matching all four corner markers
