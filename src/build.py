#!/usr/bin/env python3
"""Concatenate src/ into one self-contained HTML file.

Usage: python3 src/build.py [output]   (default: index.html next to src/)
Files are joined in name order: 00_head.html first, then every *.js inside
one strict-mode IIFE. 30_ui.js closes the IIFE and the document.
"""
import os, sys
here = os.path.dirname(os.path.abspath(__file__))
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, '..', 'index.html')
names = sorted(n for n in os.listdir(here) if n.endswith('.js'))
parts = [open(os.path.join(here, '00_head.html'), encoding='utf-8').read(), "\n<script>\n(() => {\n"]
for n in names:
    parts.append(open(os.path.join(here, n), encoding='utf-8').read())
    parts.append("\n")
html = "".join(parts)
open(out, 'w', encoding='utf-8').write(html)
print(f"{out}: {len(html)} bytes from {len(names)} modules")
