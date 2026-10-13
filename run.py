#!/usr/bin/env python3
"""CoinQuant 一键启动（Windows / macOS / Linux 通用，仅依赖 Python 标准库）。

用法：
    python run.py                # 启动并自动打开浏览器
    python run.py --port 8001    # 换一个端口
    python run.py --no-browser   # 不自动打开浏览器

首次运行会自动：创建虚拟环境 → 安装后端依赖 →（如缺少前端页面且已安装 Node.js）构建前端。
"""

import argparse
import hashlib
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
VENV = BACKEND / ".venv"
MIN_PYTHON = (3, 11)


def say(msg: str) -> None:
    print(f"[CoinQuant] {msg}", flush=True)


def fail(msg: str) -> None:
    print(f"\n[CoinQuant] 错误：{msg}\n", flush=True)
    sys.exit(1)


def venv_python() -> Path:
    return VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def ensure_backend() -> Path:
    py = venv_python()
    if not py.exists():
        say("首次运行：正在创建 Python 虚拟环境…")
        try:
            subprocess.check_call([sys.executable, "-m", "venv", str(VENV)])
        except subprocess.CalledProcessError:
            fail("创建虚拟环境失败。Linux 用户请先安装 python3-venv（如 sudo apt install python3-venv）。")
    req = BACKEND / "requirements.txt"
    stamp = VENV / ".requirements.sha256"
    digest = hashlib.sha256(req.read_bytes()).hexdigest()
    if not stamp.exists() or stamp.read_text().strip() != digest:
        say("正在安装后端依赖（首次约需 1~3 分钟，请保持网络畅通）…")
        if subprocess.call([str(py), "-m", "pip", "--version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) != 0:
            subprocess.call([str(py), "-m", "ensurepip", "--upgrade"])  # 虚拟环境中缺少 pip 时补装
        try:
            subprocess.check_call([str(py), "-m", "pip", "install", "--disable-pip-version-check", "-r", str(req)])
        except subprocess.CalledProcessError:
            fail("依赖安装失败，请检查网络后重新运行。")
        stamp.write_text(digest)
    return py


def ensure_frontend() -> None:
    if (FRONTEND / "dist" / "index.html").exists():
        return
    npm = shutil.which("npm")
    if not npm:
        fail(
            "缺少前端页面（frontend/dist）。\n"
            "  方法 1：下载已包含前端页面的发布包（coinquant-release.zip），解压后再运行；\n"
            "  方法 2：安装 Node.js 18+（https://nodejs.org）后重新运行，脚本会自动构建前端。"
        )
    say("正在构建前端页面（首次约需 1 分钟）…")
    try:
        subprocess.check_call([npm, "ci", "--no-audit", "--no-fund"], cwd=FRONTEND)
        subprocess.check_call([npm, "run", "build"], cwd=FRONTEND)
    except subprocess.CalledProcessError:
        fail("前端构建失败，请查看上方错误信息。")


_no_proxy = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def is_healthy(port: int) -> bool:
    try:
        with _no_proxy.open(f"http://127.0.0.1:{port}/api/health", timeout=1) as r:
            return r.status == 200
    except OSError:
        return False


def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def main() -> None:
    parser = argparse.ArgumentParser(description="启动 CoinQuant 量化交易平台")
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "8000")))
    parser.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    args = parser.parse_args()

    if sys.version_info < MIN_PYTHON:
        fail(
            f"需要 Python {MIN_PYTHON[0]}.{MIN_PYTHON[1]} 或更高版本，当前为 {sys.version.split()[0]}。\n"
            "  请到 https://www.python.org/downloads/ 下载安装最新版 Python。"
        )

    url = f"http://127.0.0.1:{args.port}"
    if not port_free(args.port):
        if is_healthy(args.port):
            say(f"CoinQuant 已经在运行：{url}")
            if not args.no_browser:
                webbrowser.open(url)
            return
        fail(f"端口 {args.port} 已被其他程序占用，请换一个端口：python run.py --port {args.port + 1}")

    py = ensure_backend()
    ensure_frontend()

    # 被终止（SIGTERM）时也走 finally 清理子进程，避免残留后台服务
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))

    say("正在启动服务…")
    proc = subprocess.Popen(
        [str(py), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(args.port)],
        cwd=BACKEND,
    )
    try:
        for _ in range(120):
            if proc.poll() is not None:
                fail("服务启动失败，请查看上方错误信息。")
            if is_healthy(args.port):
                break
            time.sleep(0.5)
        else:
            fail("服务启动超时，请查看上方错误信息。")
        print(
            "\n"
            "  ==============================================\n"
            f"   CoinQuant 已启动：{url}\n"
            "   在浏览器中打开上面的地址即可使用\n"
            "   关闭本窗口或按 Ctrl+C 即可停止\n"
            "  ==============================================\n",
            flush=True,
        )
        if not args.no_browser:
            webbrowser.open(url)
        proc.wait()
    except KeyboardInterrupt:
        pass
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
        say("已停止。")


if __name__ == "__main__":
    main()
