#!/usr/bin/env python3
"""Comprehensive technical & visual verification suite for rendered promo MP4s."""
import json
import subprocess
import sys
from pathlib import Path


def run(cmd: list[str]) -> str:
    res = subprocess.run(cmd, capture_output=True, text=True)
    return (res.stdout or "") + (res.stderr or "")


def main():
    if len(sys.argv) < 3:
        print("Usage: verify-render.py <video.mp4> <out_preview_dir>")
        sys.exit(1)
    mp4 = Path(sys.argv[1]).resolve()
    out_dir = Path(sys.argv[2]).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. ffprobe JSON metadata
    probe_raw = subprocess.check_output(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", str(mp4)],
        text=True,
    )
    probe = json.loads(probe_raw)
    if "format" in probe and "filename" in probe["format"]:
        probe["format"]["filename"] = mp4.name
    (out_dir / "ffprobe.json").write_text(json.dumps(probe, indent=2))

    # 2. Full decode error check + blackdetect + astats
    diag = run(
        [
            "ffmpeg",
            "-hide_banner",
            "-i",
            str(mp4),
            "-vf",
            "blackdetect=d=0.05:pix_th=0.015",
            "-af",
            "astats=metadata=1:reset=0,silencedetect=n=-55dB:d=1.8",
            "-f",
            "null",
            "-",
        ]
    )
    (out_dir / "diagnostics.txt").write_text(diag)

    # 3. Extract key timestamps covering Hook (0-3s), all 7 scenes, and transition boundaries
    timestamps = [
        ("01_hook_0.1s", 0.10),
        ("02_hook_1.0s", 1.00),
        ("03_hook_2.4s", 2.40),
        ("04_prob_4.8s", 4.80),
        ("05_sol_6.8s", 6.80),
        ("06_key_9.8s", 9.80),
        ("07_fp_12.2s", 12.20),
        ("08_tx_16.8s", 16.80),
        ("09_done_20.4s", 20.40),
        ("10_arch1_23.0s", 23.00),
        ("11_arch2_25.2s", 25.20),
        ("12_arch3_27.4s", 27.40),
        ("13_sec_32.2s", 32.20),
        ("14_cta_34.1s", 34.10),
        ("15_cta_36.2s", 36.20),
        ("16_end_37.8s", 37.80),
    ]
    for label, ts in timestamps:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-ss",
                f"{ts:.2f}",
                "-i",
                str(mp4),
                "-frames:v",
                "1",
                "-q:v",
                "2",
                str(out_dir / f"{label}.jpg"),
            ],
            check=True,
            capture_output=True,
        )

    # 4. Generate 4x4 overview contact sheet (every ~2.375s)
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(mp4),
            "-vf",
            "fps=16/38,scale=480:270,tile=4x4",
            "-frames:v",
            "1",
            "-q:v",
            "2",
            str(out_dir / "contact-sheet.jpg"),
        ],
        check=True,
        capture_output=True,
    )

    # 5. Generate 4x3 scene-cut transition sheet (frame before and frame at each of the 6 cuts)
    cut_frames = [209, 210, 479, 480, 839, 840, 1289, 1290, 1709, 1710, 2009, 2010]
    sel = "+".join(f"eq(n\\,{f})" for f in cut_frames)
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(mp4),
            "-vf",
            f"select='{sel}',scale=480:270,tile=4x3",
            "-fps_mode",
            "vfr",
            "-frames:v",
            "1",
            "-q:v",
            "2",
            str(out_dir / "transitions-sheet.jpg"),
        ],
        check=True,
        capture_output=True,
    )

    vstream = next(s for s in probe["streams"] if s["codec_type"] == "video")
    astream = next(s for s in probe["streams"] if s["codec_type"] == "audio")
    black_lines = [l for l in diag.splitlines() if "black_start" in l]
    peak_lines = [l for l in diag.splitlines() if "Peak level dB" in l or "RMS level dB" in l]

    print(
        json.dumps(
            {
                "file": str(mp4),
                "size_mb": round(mp4.stat().st_size / 1048576, 2),
                "duration": probe["format"]["duration"],
                "video": f"{vstream['codec_name']} {vstream['width']}x{vstream['height']} {vstream['r_frame_rate']} {vstream['pix_fmt']} ({vstream.get('color_space', '?')}/{vstream.get('color_primaries', '?')}/{vstream.get('color_transfer', '?')})",
                "audio": f"{astream['codec_name']} {astream['sample_rate']}Hz ch={astream['channels']}",
                "black_frames_detected": black_lines,
                "audio_stats": peak_lines[-4:],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
