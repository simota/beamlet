#!/usr/bin/env python3
"""Compress full-bitrate master MP4 into repository/README-friendly Full HD 30fps MP4 (<10 MB)
and generate an inline animated WebP preview (<5 MB) for GitHub README rendering.
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SOURCE_DIR = Path(__file__).resolve().parent.parent
PROMO_DIR = SOURCE_DIR.parent


def main():
    in_mp4 = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else (PROMO_DIR / "final-promo.mp4").resolve()
    out_mp4 = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else (PROMO_DIR / "final-promo.mp4").resolve()
    out_webp = PROMO_DIR / "previews/promo-preview.webp"
    out_webp.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp_path = Path(tmp.name)

    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(in_mp4),
                "-vf",
                "fps=30,format=yuv420p",
                "-c:v",
                "libx264",
                "-preset",
                "veryslow",
                "-profile:v",
                "high",
                "-crf",
                "28",
                "-x264-params",
                "colorprim=bt709:transfer=bt709:colormatrix=bt709",
                "-colorspace",
                "bt709",
                "-color_primaries",
                "bt709",
                "-color_trc",
                "bt709",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-ar",
                "48000",
                "-movflags",
                "+faststart",
                str(tmp_path),
            ],
            check=True,
        )
        shutil.move(str(tmp_path), str(out_mp4))
    finally:
        if tmp_path.exists():
            tmp_path.unlink()

    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(out_mp4),
            "-vf",
            "fps=10,scale=864:486:flags=lanczos",
            "-c:v",
            "libwebp_anim",
            "-lossless",
            "0",
            "-compression_level",
            "4",
            "-q:v",
            "55",
            "-loop",
            "0",
            "-an",
            str(out_webp),
        ],
        check=True,
    )

    print(
        f"Compressed MP4: {out_mp4} ({out_mp4.stat().st_size / (1024*1024):.2f} MiB)\n"
        f"Animated WebP : {out_webp} ({out_webp.stat().st_size / (1024*1024):.2f} MiB)"
    )


if __name__ == "__main__":
    main()
