#!/usr/bin/env python3
"""Deterministic 60fps 1080p renderer for the Remotion React promo source code
using esbuild + Playwright pipe transport + FFmpeg H.264/AAC mastering.
"""
import asyncio
import mimetypes
import subprocess
import sys
import time
from pathlib import Path
from playwright.async_api import async_playwright

SOURCE_DIR = Path(__file__).resolve().parent.parent
PUBLIC_DIR = SOURCE_DIR / "public"
BUNDLE_JS = SOURCE_DIR / ".bundle-promo.js"
CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TOTAL_FRAMES = 2280
FPS = 60
WORKERS = 6

mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("image/png", ".png")
mimetypes.add_type("image/jpeg", ".jpg")
mimetypes.add_type("application/javascript", ".js")

HTML_SHELL = """<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; -webkit-font-smoothing: antialiased; }
  html, body { margin: 0; padding: 0; width: 1920px; height: 1080px; overflow: hidden; background: #05070d; }
</style>
</head>
<body>
<div id="root"></div>
<script src="http://localhost:9876/__bundle.js"></script>
</body>
</html>
"""


def build_bundle():
    subprocess.run(
        [
            str(SOURCE_DIR / "node_modules/.bin/esbuild"),
            str(SOURCE_DIR / "src/headless-harness.tsx"),
            "--bundle",
            "--format=iife",
            "--platform=browser",
            "--target=chrome120",
            f"--alias:remotion={SOURCE_DIR / 'src/remotion-pipe-runtime.tsx'}",
            f"--outfile={BUNDLE_JS}",
        ],
        check=True,
    )


async def render_video(out_mp4: Path):
    t0 = time.time()
    build_bundle()
    bundle_bytes = BUNDLE_JS.read_bytes()

    # Collect all image assets under public/ to preload 100% into Chromium decoded cache
    asset_files: dict[str, tuple[str, bytes]] = {}
    preload_urls: list[str] = []
    for f in sorted(PUBLIC_DIR.rglob("*")):
        if f.is_file() and f.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".svg"}:
            rel = f.relative_to(PUBLIC_DIR).as_posix()
            ctype, _ = mimetypes.guess_type(str(f))
            asset_files[rel] = (ctype or "application/octet-stream", f.read_bytes())
            preload_urls.append(f"http://localhost:9876/{rel}")

    async def handle_route(route):
        url = route.request.url
        rel = url.split("http://localhost:9876/", 1)[1].split("?", 1)[0]
        if rel in ("", "index.html"):
            await route.fulfill(status=200, content_type="text/html; charset=utf-8", body=HTML_SHELL)
        elif rel == "__bundle.js":
            await route.fulfill(status=200, content_type="application/javascript", body=bundle_bytes)
        elif rel in asset_files:
            ctype, data = asset_files[rel]
            await route.fulfill(status=200, content_type=ctype, body=data)
        else:
            await route.fulfill(status=404, body="Not found")

    out_mp4.parent.mkdir(parents=True, exist_ok=True)
    audio_wav = PUBLIC_DIR / "assets/soundtrack.wav"

    ffmpeg_proc = subprocess.Popen(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "image2pipe",
            "-vcodec",
            "mjpeg",
            "-framerate",
            str(FPS),
            "-i",
            "pipe:0",
            "-i",
            str(audio_wav),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-vf",
            "scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-profile:v",
            "high",
            "-crf",
            "16",
            "-x264-params",
            "colorprim=bt709:transfer=bt709:colormatrix=bt709",
            "-pix_fmt",
            "yuv420p",
            "-colorspace",
            "bt709",
            "-color_primaries",
            "bt709",
            "-color_trc",
            "bt709",
            "-r",
            str(FPS),
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            "48000",
            "-shortest",
            "-movflags",
            "+faststart",
            str(out_mp4),
        ],
        stdin=subprocess.PIPE,
    )

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=CHROME_BIN,
            headless=True,
            args=["--no-sandbox", "--disable-gpu", "--disable-crash-reporter", "--no-first-run"],
        )
        context = await browser.new_context(viewport={"width": 1920, "height": 1080}, device_scale_factor=1, locale="ja-JP")
        await context.route("http://localhost:9876/**", handle_route)

        pages = []
        for _ in range(WORKERS):
            pg = await context.new_page()
            await pg.goto("http://localhost:9876/index.html", wait_until="load")
            await pg.evaluate("(urls) => window.__preloadAssets(urls)", preload_urls)
            pages.append(pg)

        async def grab_frame(pg, f_idx: int) -> bytes:
            await pg.evaluate("(f) => window.__setFrame(f)", f_idx)
            return await pg.screenshot(type="jpeg", quality=96)

        for base in range(0, TOTAL_FRAMES, WORKERS):
            batch_indices = [f for f in range(base, min(TOTAL_FRAMES, base + WORKERS))]
            shots = await asyncio.gather(*(grab_frame(pages[i], f) for i, f in enumerate(batch_indices)))
            for jpg in shots:
                ffmpeg_proc.stdin.write(jpg)
            if base % 300 == 0:
                print(f"Rendered {base}/{TOTAL_FRAMES} frames ({time.time() - t0:.1f}s)...", flush=True)

        await context.close()
        await browser.close()

    ffmpeg_proc.stdin.close()
    rc = ffmpeg_proc.wait()
    if rc != 0:
        raise RuntimeError(f"FFmpeg exited with code {rc}")
    print(f"Successfully rendered {out_mp4} in {time.time() - t0:.1f}s!")


def main():
    out = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else (SOURCE_DIR.parent / "renders/v1.mp4").resolve()
    asyncio.run(render_video(out))


if __name__ == "__main__":
    main()
