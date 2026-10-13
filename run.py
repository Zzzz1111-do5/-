#!/usr/bin/env python3
"""CoinQuant 一键启动（Windows / macOS / Linux 通用，仅依赖 Python 标准库）。

用法：
    python run.py                # 启动并自动打开浏览器（默认端口 8000，被占用时自动顺延）
    python run.py --port 8001    # 指定端口
    python run.py --no-browser   # 不自动打开浏览器

首次运行会自动：创建虚拟环境 → 安装后端依赖 →（如缺少前端页面且已安装 Node.js）构建前端。
"""

import argparse
import hashlib
import json
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
MIN_PYTHON = (3, 12)  # numpy 2.5 / pandas 3.0 需要 Python 3.12+
DEFAULT_PORT = 8000
PORT_TRIES = 10


def say(msg: str) -> None:
    print(f"[CoinQuant] {msg}", flush=True)


def fail(zh: str, en: str) -> None:
    """报错并退出。英文行在前：部分英文 Windows 控制台无法显示中文。"""
    print(f"\n[CoinQuant] ERROR: {en}\n[CoinQuant] 错误：{zh}\n", flush=True)
    sys.exit(1)


def venv_python() -> Path:
    return VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def _quiet_call(cmd: list[str]) -> int:
    try:
        return subprocess.call(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        return 1


def ensure_backend() -> Path:
    py = venv_python()
    # 虚拟环境由旧版本 Python 创建，或原 Python 已被卸载/升级时，重建虚拟环境
    if py.exists() and _quiet_call([str(py), "-c", f"import sys; sys.exit(sys.version_info < {MIN_PYTHON!r})"]) != 0:
        say("检测到不可用的旧虚拟环境，正在重建… / Rebuilding the virtual environment…")
        shutil.rmtree(VENV, ignore_errors=True)
    if not py.exists():
        say("首次运行：正在创建 Python 虚拟环境… / Creating the virtual environment…")
        try:
            subprocess.check_call([sys.executable, "-m", "venv", str(VENV)])
        except subprocess.CalledProcessError:
            fail(
                "创建虚拟环境失败。Linux 用户请先安装 python3-venv（如 sudo apt install python3-venv）。",
                "could not create the virtual environment (on Linux, install python3-venv first).",
            )
    req = BACKEND / "requirements.txt"
    stamp = VENV / ".requirements.sha256"
    digest = hashlib.sha256(req.read_bytes()).hexdigest()
    if not stamp.exists() or stamp.read_text().strip() != digest:
        say("正在安装后端依赖（首次约需 1~3 分钟，请保持网络畅通）… / Installing dependencies…")
        if _quiet_call([str(py), "-m", "pip", "--version"]) != 0:
            subprocess.call([str(py), "-m", "ensurepip", "--upgrade"])  # 虚拟环境中缺少 pip 时补装
        try:
            subprocess.check_call([str(py), "-m", "pip", "install", "--disable-pip-version-check", "-r", str(req)])
        except subprocess.CalledProcessError:
            fail(
                "依赖安装失败，请查看上方的错误信息（常见原因：网络不通）。网络恢复后重新启动即可。",
                "failed to install dependencies - see the messages above (usually a network problem). Then start again.",
            )
        stamp.write_text(digest)
    return py


def ensure_frontend() -> None:
    if (FRONTEND / "dist" / "index.html").exists():
        return
    npm = shutil.which("npm")
    if not npm:
        fail(
            "缺少前端页面（frontend/dist）。\n"
            "  方法 1：使用已包含前端页面的发布包 coinquant-release.zip，解压后再启动；\n"
            "  方法 2：安装 Node.js 18+（https://nodejs.org）后重新启动，会自动构建前端。",
            "the web pages (frontend/dist) are missing. Use coinquant-release.zip, "
            "or install Node.js 18+ from https://nodejs.org and start again.",
        )
    say("正在构建前端页面（首次约需 1 分钟）… / Building the web pages…")
    try:
        subprocess.check_call([npm, "ci", "--no-audit", "--no-fund"], cwd=FRONTEND)
        subprocess.check_call([npm, "run", "build"], cwd=FRONTEND)
    except subprocess.CalledProcessError:
        fail("前端构建失败，请查看上方错误信息。", "building the web pages failed - see the messages above.")


_no_proxy = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def is_coinquant(port: int) -> bool:
    """该端口上是否已经运行着 CoinQuant。"""
    try:
        with _no_proxy.open(f"http://127.0.0.1:{port}/api/health", timeout=1.5) as r:
            return json.loads(r.read().decode()).get("app") == "coinquant"
    except (OSError, ValueError):
        return False


def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        if os.name != "nt":
            # 与 uvicorn 一致；否则刚停止后立即重启会因 TIME_WAIT 误判端口被占用
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


class LaunchLock:
    """同时打开多个启动窗口时，只允许一个进行安装和启动，其余等待（进程退出时系统自动释放）。"""

    def __init__(self) -> None:
        self.f = None

    def _try(self) -> bool:
        try:
            if os.name == "nt":
                import msvcrt

                self.f.seek(0)
                msvcrt.locking(self.f.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(self.f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            return False

    def acquire(self) -> None:
        self.f = open(BACKEND / ".launch.lock", "a+")
        waited = False
        while not self._try():
            if not waited:
                say("另一个窗口正在启动 CoinQuant，请稍候… / Another window is starting CoinQuant, please wait…")
                waited = True
            time.sleep(1)

    def release(self) -> None:
        if not self.f:
            return
        try:
            if os.name == "nt":
                import msvcrt

                self.f.seek(0)
                msvcrt.locking(self.f.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(self.f, fcntl.LOCK_UN)
        except OSError:
            pass
        self.f.close()
        self.f = None


def disable_quickedit():
    """Windows 经典控制台的“快速编辑”模式下，点击窗口会暂停所有输出，导致服务卡住；运行期间关闭它。"""
    if os.name != "nt":
        return None
    try:
        import ctypes
        from ctypes import wintypes

        k = ctypes.WinDLL("kernel32")
        k.GetStdHandle.restype = wintypes.HANDLE
        h = k.GetStdHandle(-10)  # STD_INPUT_HANDLE
        mode = wintypes.DWORD()
        if not k.GetConsoleMode(h, ctypes.byref(mode)):
            return None  # 不是控制台（如被重定向）
        enable_quick_edit, enable_extended_flags = 0x40, 0x80
        k.SetConsoleMode(h, (mode.value & ~enable_quick_edit) | enable_extended_flags)
        return k, h, mode.value
    except Exception:
        return None


def restore_console(state) -> None:
    if state:
        k, h, mode = state
        try:
            k.SetConsoleMode(h, mode)
        except Exception:
            pass


def open_existing(port: int, no_browser: bool) -> None:
    url = f"http://127.0.0.1:{port}"
    say(f"CoinQuant 已经在运行 / already running: {url}")
    if not no_browser:
        webbrowser.open(url)


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")  # 输出被重定向到非 UTF-8 编码时不因中文崩溃
        except (AttributeError, ValueError):
            pass

    parser = argparse.ArgumentParser(description="启动 CoinQuant 量化交易平台")
    parser.add_argument("--port", type=int, default=None, help=f"端口（默认 {DEFAULT_PORT}，被占用时自动顺延）")
    parser.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    args = parser.parse_args()

    if sys.version_info < MIN_PYTHON:
        need = f"{MIN_PYTHON[0]}.{MIN_PYTHON[1]}"
        fail(
            f"需要 Python {need} 或更高版本，当前为 {sys.version.split()[0]}。请到 https://www.python.org/downloads/ 安装最新版 Python。",
            f"Python {need}+ is required (found {sys.version.split()[0]}). Install the latest Python from https://www.python.org/downloads/",
        )

    explicit = args.port is not None or "PORT" in os.environ
    base = args.port if args.port is not None else int(os.environ.get("PORT", DEFAULT_PORT))
    candidates = [base] if explicit else list(range(base, base + PORT_TRIES))

    lock = LaunchLock()
    lock.acquire()
    console_state = None
    proc = None
    try:
        # 已有实例在运行时直接打开它，避免两个实例同时驱动同一批模拟交易机器人
        for p in candidates:
            if not port_free(p) and is_coinquant(p):
                return open_existing(p, args.no_browser)
        port = next((p for p in candidates if port_free(p)), None)
        if port is None:
            if explicit:
                fail(
                    f"端口 {base} 已被其他程序占用。请换一个端口，例如：bash start.sh --port {base + 1}（Windows：start.bat --port {base + 1}）",
                    f"port {base} is in use by another program. Try another one, e.g. --port {base + 1}",
                )
            fail(
                f"端口 {base}~{base + PORT_TRIES - 1} 都被占用了，请关闭占用端口的程序后重试。",
                f"ports {base}-{base + PORT_TRIES - 1} are all in use. Close the programs using them and try again.",
            )
        if port != base:
            say(f"端口 {base} 被占用，自动改用 {port} / port {base} is busy, using {port}")

        py = ensure_backend()
        ensure_frontend()

        # 被终止（SIGTERM）时也走 finally 清理子进程，避免残留后台服务
        signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
        console_state = disable_quickedit()
        say("正在启动服务… / Starting…")
        proc = subprocess.Popen(
            [str(py), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port), "--no-access-log"],
            cwd=BACKEND,
        )
        for _ in range(120):
            if proc.poll() is not None:
                fail("服务启动失败，请查看上方错误信息。", "the server failed to start - see the messages above.")
            if is_coinquant(port):
                break
            time.sleep(0.5)
        else:
            fail("服务启动超时，请查看上方错误信息。", "the server did not start in time - see the messages above.")
        lock.release()

        url = f"http://127.0.0.1:{port}"
        print(
            "\n"
            "  ==================================================================\n"
            f"   CoinQuant 已启动 / is running:  {url}\n"
            "   浏览器会自动打开；如果没有，请手动打开上面的地址\n"
            "   使用期间请保持本窗口打开（可以最小化）；关闭本窗口或按 Ctrl+C 即停止\n"
            "   Keep this window open while using CoinQuant. Close it or press Ctrl+C to stop.\n"
            "  ==================================================================\n",
            flush=True,
        )
        if not args.no_browser:
            webbrowser.open(url)
        proc.wait()
    except KeyboardInterrupt:
        pass
    finally:
        lock.release()
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
        restore_console(console_state)
        if proc is not None:
            say("已停止 / stopped.")


if __name__ == "__main__":
    main()
