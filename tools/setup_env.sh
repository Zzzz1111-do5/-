#!/bin/sh
# One-time environment setup: Python 3.11 venv with Blender 4.2 LTS (bpy module) and image libraries.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3.11 -m venv "$ROOT/.venv"
"$ROOT/.venv/bin/python" -m pip install --upgrade pip
"$ROOT/.venv/bin/python" -m pip install -r "$ROOT/requirements.txt"
"$ROOT/.venv/bin/python" -c "import bpy; print('bpy', bpy.app.version_string)"
