#!/usr/bin/env python3
"""Capture pixel-accurate Retina screenshots of the actual Beamlet Web UI (web/)
using Playwright route interception (no TCP socket required).
"""
import json
import os
import mimetypes
from pathlib import Path
from playwright.sync_api import sync_playwright

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_WEB = Path(os.environ.get("BEAMLET_REPO_WEB", SCRIPT_DIR.parent.parent.parent.parent / "web"))
PUBLIC_ASSETS = SCRIPT_DIR.parent / "public" / "assets"
PROMO_ASSETS = SCRIPT_DIR.parent.parent / "assets"

mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/manifest+json", ".webmanifest")


def serve_web(route):
    url = route.request.url
    rel = url.split("http://localhost:8765/", 1)[1].split("?", 1)[0]
    if rel == "" or rel.endswith("/"):
        rel += "index.html"
    if rel.startswith("__promo/"):
        target = (PUBLIC_ASSETS / rel.removeprefix("__promo/")).resolve()
        root = PUBLIC_ASSETS.resolve()
    else:
        target = (REPO_WEB / rel).resolve()
        root = REPO_WEB.resolve()
    if not str(target).startswith(str(root)) or not target.is_file():
        route.fulfill(status=404, body="Not found")
        return
    ctype, _ = mimetypes.guess_type(str(target))
    route.fulfill(
        status=200,
        headers={"Content-Type": ctype or "application/octet-stream"},
        body=target.read_bytes(),
    )


def main():
    (PUBLIC_ASSETS / "ui").mkdir(parents=True, exist_ok=True)
    (PROMO_ASSETS / "ui").mkdir(parents=True, exist_ok=True)
    meta = json.loads((PUBLIC_ASSETS / "bos" / "meta.json").read_text())
    fp = meta["fingerprint"]

    with sync_playwright() as p:
        chrome_path = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
        browser = p.chromium.launch(
            executable_path=str(chrome_path),
            headless=True,
            args=["--no-sandbox", "--disable-gpu", "--disable-crash-reporter", "--no-first-run"],
        )

        # 1. Landing page (Desktop 1040x680 @ 2x)
        ctx = browser.new_context(viewport={"width": 1040, "height": 680}, device_scale_factor=2, locale="ja-JP")
        ctx.route("http://localhost:8765/**", serve_web)
        page = ctx.new_page()
        page.goto("http://localhost:8765/index.html", wait_until="domcontentloaded")
        page.wait_for_timeout(900)
        for dst in [PUBLIC_ASSETS / "ui/landing.png", PROMO_ASSETS / "ui/landing.png"]:
            page.screenshot(path=str(dst))

        # 2. Receive page — Step 1 Key QR + 6-digit Fingerprint
        page.goto("http://localhost:8765/receive.html", wait_until="domcontentloaded")
        page.wait_for_timeout(400)
        page.evaluate(
            """([fp]) => new Promise((resolve) => {
                document.getElementById('fingerprint').textContent = fp;
                document.getElementById('fingerprint-rx').textContent = fp;
                const img = new Image();
                img.onload = () => {
                    const c = document.getElementById('qr');
                    c.width = 296;
                    c.height = 296;
                    c.style.width = '240px';
                    c.style.height = '240px';
                    const ctx = c.getContext('2d');
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(img, 0, 0, 296, 296);
                    resolve();
                };
                img.src = '/__promo/bos/key-qr.png';
            })""",
            [fp],
        )
        page.wait_for_timeout(150)
        for dst in [PUBLIC_ASSETS / "ui/receive-key.png", PROMO_ASSETS / "ui/receive-key.png"]:
            page.screenshot(path=str(dst))

        # 3. Receive page — Step 2 Active Synced Reception with Instant Scanline Preview
        page.set_viewport_size({"width": 920, "height": 860})
        page.evaluate(
            """([fp]) => new Promise((resolve) => {
                document.getElementById('step-key').hidden = true;
                const sr = document.getElementById('step-receive');
                sr.hidden = false;
                sr.dataset.state = 'synced';
                const vf = sr.querySelector('.viewfinder');
                const vid = document.getElementById('video');
                vid.style.display = 'none';
                const cam = document.createElement('img');
                cam.src = '/__promo/bos/bos-compact-00.png';
                cam.style.cssText = 'display:block;width:100%;max-height:240px;object-fit:contain;margin:0;padding:18px;background:#0a0e16;image-rendering:pixelated;';
                vf.appendChild(cam);
                document.getElementById('fingerprint-rx').textContent = fp;
                document.getElementById('status').textContent = '受信中 — 8/9 タイル、解析 11 ms（追跡）、15.0 fps';
                const ul = document.getElementById('files');
                ul.innerHTML = '';
                const li1 = document.createElement('li');
                li1.className = 'file';
                li1.dataset.state = 'receiving';
                li1.style.setProperty('--p', 58);
                li1.textContent = 'fuji-dusk.webp（304.2 KB） — 58%';
                const prev = document.createElement('img');
                prev.className = 'preview';
                prev.src = '/__promo/sample-photo.jpg';
                prev.style.maxHeight = '145px';
                li1.appendChild(prev);

                const li2 = document.createElement('li');
                li2.className = 'file';
                li2.dataset.state = 'done';
                const a2 = document.createElement('a');
                a2.href = '#';
                a2.textContent = 'deploy-keys.json（4.8 KB） を保存';
                li2.appendChild(a2);
                ul.append(li2, li1);
                prev.onload = () => resolve();
            })""",
            [fp],
        )
        page.wait_for_timeout(150)
        for dst in [PUBLIC_ASSETS / "ui/receive-syncing.png", PROMO_ASSETS / "ui/receive-syncing.png"]:
            page.screenshot(path=str(dst))

        # 4. Receive page — Step 2 Completed State
        page.evaluate(
            """() => new Promise((resolve) => {
                const sr = document.getElementById('step-receive');
                sr.dataset.state = 'done';
                document.getElementById('status').textContent = 'すべて受信しました。保存リンクから各ファイルを保存してください。';
                document.getElementById('stop').hidden = true;
                document.getElementById('again').hidden = false;
                const ul = document.getElementById('files');
                const items = ul.querySelectorAll('li.file');
                const liPhoto = items[1];
                liPhoto.dataset.state = 'done';
                liPhoto.innerHTML = '';
                const a = document.createElement('a');
                a.href = '#';
                a.textContent = 'fuji-dusk.webp（304.2 KB） を保存';
                const full = document.createElement('img');
                full.src = '/__promo/sample-photo.jpg';
                full.style.maxHeight = '155px';
                liPhoto.append(a, full);
                full.onload = () => resolve();
            })"""
        )
        page.wait_for_timeout(150)
        for dst in [PUBLIC_ASSETS / "ui/receive-done.png", PROMO_ASSETS / "ui/receive-done.png"]:
            page.screenshot(path=str(dst))
        ctx.close()

        # 5. Send page — Mobile Phone Viewport (412x860 @ 3x)
        mctx = browser.new_context(viewport={"width": 412, "height": 860}, device_scale_factor=3, locale="ja-JP")
        mctx.route("http://localhost:8765/**", serve_web)
        mpage = mctx.new_page()
        mpage.goto("http://localhost:8765/send.html", wait_until="domcontentloaded")
        mpage.wait_for_timeout(350)
        mpage.evaluate(
            """([fp]) => {
                document.getElementById('step-files').dataset.state = 'done';
                document.getElementById('chosen').textContent = 'deploy-keys.json、fuji-dusk.jpg';
                const prep = document.getElementById('prepared');
                prep.innerHTML = '<li>deploy-keys.json: 4.8 KB（元 4.8 KB）</li><li>fuji-dusk.webp: 304.2 KB（元 3420.0 KB） — 共有用に変換（位置情報を削除）</li>';
                document.getElementById('step-scan').dataset.state = 'done';
                document.getElementById('scan-status').textContent = '読み取りました。この画面に合うモード（小画面・15 fps）を自動で選びました。';
                document.getElementById('mode').value = '1';
                document.getElementById('step-send').dataset.state = 'active';
                document.getElementById('fingerprint').textContent = fp;
                document.getElementById('fp-line').hidden = false;
                document.getElementById('send').disabled = false;
                document.getElementById('send-status').textContent = '送るデータは合計 309.0 KB です。';
            }""",
            [fp],
        )
        mpage.wait_for_timeout(150)
        for dst in [PUBLIC_ASSETS / "ui/send-ready-mobile.png", PROMO_ASSETS / "ui/send-ready-mobile.png"]:
            mpage.screenshot(path=str(dst))
        mctx.close()

        browser.close()
    print("Captured all real Beamlet UI screenshots successfully!")


if __name__ == "__main__":
    main()
