#!/usr/bin/env python3
"""Create side-by-side visual comparison grids across PDCA cycles (e.g., v1 vs v2 vs v3 vs final)."""
import subprocess
import sys
from pathlib import Path


def main():
    # Usage: make-comparison-strip.py <out.jpg> <frame_name.jpg> <dir1> <dir2> [<dir3> ...]
    out_jpg = Path(sys.argv[1]).resolve()
    out_jpg.parent.mkdir(parents=True, exist_ok=True)
    frame_name = sys.argv[2]
    dirs = [Path(d).resolve() for d in sys.argv[3:]]
    inputs = []
    for d in dirs:
        inputs.extend(["-i", str(d / frame_name)])
    n = len(dirs)
    filter_parts = []
    for i in range(n):
        pad_part = ",pad=648:360:0:0:color=#3ef2ff" if i < n - 1 else ""
        filter_parts.append(f"[{i}:v]scale=640:360{pad_part}[v{i}]")
    stack_in = "".join(f"[v{i}]" for i in range(n))
    filt = ";".join(filter_parts) + f";{stack_in}hstack=inputs={n}[out]"
    subprocess.run(
        ["ffmpeg", "-y", *inputs, "-filter_complex", filt, "-map", "[out]", "-q:v", "2", str(out_jpg)],
        check=True,
        capture_output=True,
    )
    print(f"Wrote comparison strip: {out_jpg}")


if __name__ == "__main__":
    main()
