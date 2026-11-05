# 用系统自带的 Lua 5.4 运行库（liblua5.4，Debian / Ubuntu 的 liblua5.4-0 包）跑模拟测试：
#   python3 roblox/tools/mock/run.py [测试脚本，默认 test.lua] [参数……]
# 不需要装 lua 命令行，只要有 liblua5.4.so.0。
# 跑 test.lua 时接着跑 test_match.lua（对战服务器的流程：duel 两个人到齐开打、timeout 对手没来），每个脚本一个全新的 Lua 环境（全新的「服务器」）。
# 测试脚本把结果写在全局 TEST_CODE（0 通过、1 有检查没通过、2 脚本出错）。
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
lib.lua_getglobal.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
lib.lua_tointegerx.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p]
lib.lua_tointegerx.restype = ctypes.c_longlong
lib.lua_close.argtypes = [ctypes.c_void_p]


def run(path, args):
    L = lib.luaL_newstate()
    lib.luaL_openlibs(L)
    boot = f'''
MOCK_DIR = [==[{here}]==]
SRC_DIR = [==[{src}]==]
TEST_ARGS = [==[{args}]==]
TEST_CODE = 0
local ok, err = xpcall(dofile, debug.traceback, [==[{path}]==])
if not ok then io.stdout:write("\\n测试脚本出错：" .. tostring(err) .. "\\n") TEST_CODE = 2 end
io.stdout:flush()
'''
    if lib.luaL_loadstring(L, boot.encode('utf-8')) != 0 or lib.lua_pcallk(L, 0, 0, 0, 0, None) != 0:
        print(lib.lua_tolstring(L, -1, None).decode('utf-8', 'replace'))
        return 2
    lib.lua_getglobal(L, b'TEST_CODE')
    code = int(lib.lua_tointegerx(L, -1, None))
    lib.lua_close(L)
    return code


codes = [run(script, ' '.join(sys.argv[2:]))]
if os.path.basename(script) == 'test.lua':
    extra = os.path.join(here, 'test_match.lua')
    if os.path.exists(extra):
        for a in ('duel', 'timeout'):
            sys.stdout.flush()
            codes.append(run(extra, a))
sys.exit(max(codes))
