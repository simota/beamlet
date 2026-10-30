#!/usr/bin/env python3
import os
import sys

args = [
    "--headless=new" if a == "--headless=old" else a
    for a in sys.argv[1:]
    if a != "--remotion-shared-memory-capture"
]
chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
os.execv(chrome, [chrome, "--no-sandbox", "--disable-gpu", *args])
