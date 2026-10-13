#!/usr/bin/env bash
# CoinQuant 一键启动（macOS / Linux）：在终端中运行  ./start.sh  或  bash start.sh
cd "$(dirname "$0")" || exit 1
for c in python3.13 python3.12 python3.11 python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; then
    exec "$c" run.py "$@"
  fi
done
echo
echo "[CoinQuant] 未找到 Python 3.11 或更高版本。"
echo "  macOS：到 https://www.python.org/downloads/ 下载安装最新版 Python，然后重新运行本脚本。"
echo "  Linux：用系统包管理器安装 python3.11 及以上版本。"
exit 1
