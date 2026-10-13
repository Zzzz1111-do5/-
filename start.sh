#!/usr/bin/env bash
# CoinQuant 一键启动（macOS / Linux）：在终端中运行  bash start.sh
cd "$(dirname "$0")" || exit 1
darwin=0
[ "$(uname -s)" = "Darwin" ] && darwin=1
for c in python3.13 python3.14 python3.15 python3.12 python3 python; do
  p=$(command -v "$c" 2>/dev/null) || continue
  # macOS 自带的 /usr/bin/python3 在未安装开发者工具时只是占位程序（会弹出安装窗口），且版本过旧
  if [ "$darwin" = 1 ] && [ "$p" = /usr/bin/python3 ] && ! xcode-select -p >/dev/null 2>&1; then
    continue
  fi
  if "$p" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' >/dev/null 2>&1; then
    exec "$p" run.py "$@"
  fi
done
echo
echo "[CoinQuant] 未找到 Python 3.12 或更高版本 / Python 3.12+ was not found."
echo "  macOS：到 https://www.python.org/downloads/ 下载安装最新版 Python，然后重新运行 bash start.sh"
echo "  Linux：用系统包管理器安装 python3.12 或更高版本"
exit 1
