# 用系统自带的 Lua 5.4 运行库（liblua5.4，Debian / Ubuntu 的 liblua5.4-0 包）跑模拟测试：
#   python3 roblox/tools/mock/run.py [测试脚本，默认 test.lua]
# 不需要装 lua 命令行，只要有 liblua5.4.so.0。
import ctypes, ctypes.util, os, sys

here = os.path.dirname(os.path.abspath(__file__))
src = os.path.normpath(os.path.join(here, '..', '..', 'src'))
script = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(here, 'test.lua')

name = ctypes.util.find_library('lua5.4') or 'liblua5.4.so.0'
lib = ctypes.CDLL(name)
lib.luaL_newstate.restype = ctypes.c_void_p
lib.luaL_openlibs.argtypes = [ctypes.c_void_p]
lib.luaL_loadstring.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
lib.luaL_loadstring.restype = ctypes.c_int
lib.lua_pcallk.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ssize_t, ctypes.c_void_p]
lib.lua_pcallk.restype = ctypes.c_int
lib.lua_tolstring.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p]
lib.lua_tolstring.restype = ctypes.c_char_p

L = lib.luaL_newstate()
lib.luaL_openlibs(L)
boot = f'''
MOCK_DIR = [==[{here}]==]
SRC_DIR = [==[{src}]==]
TEST_ARGS = [==[{" ".join(sys.argv[2:])}]==]
local ok, err = xpcall(dofile, debug.traceback, [==[{script}]==])
if not ok then io.stdout:write("\\n测试脚本出错：" .. tostring(err) .. "\\n") os.exit(2) end
'''
if lib.luaL_loadstring(L, boot.encode('utf-8')) != 0 or lib.lua_pcallk(L, 0, 0, 0, 0, None) != 0:
    print(lib.lua_tolstring(L, -1, None).decode('utf-8', 'replace'))
    sys.exit(2)
