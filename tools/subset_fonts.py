#!/usr/bin/env python3
"""把界面字体裁剪成随游戏打包的 woff2（fonts/），不再从 Google Fonts 加载（国内打不开，桌面版离线也要能用）。

用法：python3 tools/subset_fonts.py [源字体缓存目录]
  依赖：pip install fonttools brotli
  源字体不在缓存目录里时自动下载（google/fonts 与 notofonts/noto-cjk 仓库，均为 SIL OFL 1.1 许可）。

收录的字：游戏源码（index.html、js/*.js）里出现的全部字符 + ASCII + GB2312 一级常用汉字（3755 字，
覆盖以后新加的文字和玩家输入）。改了界面文字、用到生僻字时重新运行一次即可；缺的字会落到系统字体（微软雅黑等）。
"""
import glob
import os
import sys
import urllib.request

from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'fonts')
GF = 'https://raw.githubusercontent.com/google/fonts/main/ofl/'
NOTO = 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/'
# 输出文件名: (源文件名, 下载地址, 是否中文字体)
FONTS = {
    'NotoSansSC-Regular.woff2': ('NotoSansSC-Regular.otf', NOTO + 'SubsetOTF/SC/NotoSansSC-Regular.otf', True),
    'NotoSansSC-Bold.woff2': ('NotoSansSC-Bold.otf', NOTO + 'SubsetOTF/SC/NotoSansSC-Bold.otf', True),
    'IBMPlexMono-Regular.woff2': ('IBMPlexMono-Regular.ttf', GF + 'ibmplexmono/IBMPlexMono-Regular.ttf', False),
    'IBMPlexMono-SemiBold.woff2': ('IBMPlexMono-SemiBold.ttf', GF + 'ibmplexmono/IBMPlexMono-SemiBold.ttf', False),
    'Silkscreen-Regular.woff2': ('Silkscreen-Regular.ttf', GF + 'silkscreen/Silkscreen-Regular.ttf', False),
}
LICENSES = {
    'OFL-NotoSansSC.txt': NOTO + 'LICENSE',
    'OFL-IBMPlexMono.txt': GF + 'ibmplexmono/OFL.txt',
    'OFL-Silkscreen.txt': GF + 'silkscreen/OFL.txt',
}


def fetch(url, path):
    if not os.path.exists(path):
        print('下载', url)
        urllib.request.urlretrieve(url, path)
    return path


def game_chars():
    s = set()
    for f in [os.path.join(ROOT, 'index.html')] + glob.glob(os.path.join(ROOT, 'js', '*.js')):
        with open(f, encoding='utf-8') as fh:
            s |= set(fh.read())
    return s


def gb2312_level1():
    out = set()
    for hi in range(0xB0, 0xD8):
        for lo in range(0xA1, 0xFF):
            try:
                out.add(bytes([hi, lo]).decode('gb2312'))
            except UnicodeDecodeError:
                pass
    return out


def main():
    cache = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '.fontcache')
    os.makedirs(cache, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    used = game_chars()
    ascii_ = {chr(c) for c in range(0x20, 0x7F)}
    cjk = used | ascii_ | gb2312_level1() | set('，。、；：？！“”‘’（）《》【】「」…—～·')
    latin = {c for c in used | ascii_ if ord(c) < 0x3000}
    for out, (src, url, is_cjk) in FONTS.items():
        chars = cjk if is_cjk else latin
        opts = subset.Options()
        opts.flavor = 'woff2'
        opts.layout_features = ['*']
        opts.name_IDs = ['*']
        opts.notdef_outline = True
        font = subset.load_font(fetch(url, os.path.join(cache, src)), opts)
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=[ord(c) for c in chars if c.isprintable()])
        sub.subset(font)
        dst = os.path.join(OUT, out)
        subset.save_font(font, dst, opts)
        print(f'{out}: {os.path.getsize(dst) // 1024} KB')
    for name, url in LICENSES.items():
        fetch(url, os.path.join(OUT, name))


if __name__ == '__main__':
    main()
