# 生成安卓图标与启动画面（暗绿作战台风格：发光的剑 + 「暗剑」），输出到 android/app/src/main/res
import os, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont
RES = 'android/app/src/main/res'
FONT = sys.argv[1] if len(sys.argv) > 1 else None
BG, G, G2 = (2, 7, 4), (61, 255, 138), (190, 255, 215)

def sword(size, scale=1.0):
    S = size * 4  # 超采样
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    cx, k = S / 2, S * scale
    tip, guard, grip, pom = S / 2 - .40 * k, S / 2 + .16 * k, S / 2 + .30 * k, S / 2 + .36 * k
    w = .055 * k
    d.polygon([(cx, tip), (cx + w, tip + .1 * k), (cx + w, guard), (cx - w, guard), (cx - w, tip + .1 * k)], fill=G)   # 剑身
    d.line([(cx, tip + .06 * k), (cx, guard - .02 * k)], fill=BG + (255,), width=max(2, int(.012 * k)))           # 血槽
    d.rounded_rectangle([cx - .2 * k, guard, cx + .2 * k, guard + .045 * k], radius=.02 * k, fill=G)                # 护手
    d.rectangle([cx - .028 * k, guard + .045 * k, cx + .028 * k, grip], fill=G2)                                   # 握把
    d.ellipse([cx - .05 * k, grip, cx + .05 * k, pom + .03 * k], fill=G)                                           # 剑首
    glow = im.filter(ImageFilter.GaussianBlur(S * .03))
    out = Image.alpha_composite(glow, im)
    return out.resize((size, size), Image.LANCZOS)

def icon(size, round_=False, fg_only=False, scale=.82):
    base = Image.new('RGBA', (size, size), (0, 0, 0, 0) if fg_only else BG + (255,))
    if not fg_only:   # 细网格（作战台），单独一层再叠上去才是半透明
        grid = Image.new('RGBA', (size, size), (0, 0, 0, 0)); d = ImageDraw.Draw(grid); step = max(4, size // 12)
        for i in range(0, size, step): d.line([(i, 0), (i, size)], fill=(61, 255, 138, 34)); d.line([(0, i), (size, i)], fill=(61, 255, 138, 34))
        base = Image.alpha_composite(base, grid)
    base = Image.alpha_composite(base, sword(size, scale))
    if round_:
        m = Image.new('L', (size, size), 0); ImageDraw.Draw(m).ellipse([0, 0, size - 1, size - 1], fill=255); base.putalpha(m)
    return base

DENS = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for k, f in DENS.items():
    p = f'{RES}/mipmap-{k}'
    icon(int(48 * f)).save(f'{p}/ic_launcher.png')
    icon(int(48 * f), round_=True).save(f'{p}/ic_launcher_round.png')
    icon(int(108 * f), fg_only=True, scale=.55).save(f'{p}/ic_launcher_foreground.png')   # 自适应图标：前景留安全区

# 启动画面：按各目录原尺寸重画
for dp, _, fs in os.walk(RES):
    for fn in fs:
        if fn != 'splash.png': continue
        path = os.path.join(dp, fn); w, h = Image.open(path).size
        im = Image.new('RGBA', (w, h), BG + (255,)); m = min(w, h)
        sw = sword(int(m * .5), .9); im.alpha_composite(sw, ((w - sw.width) // 2, int(h * .42 - sw.height / 2)))
        if FONT:
            d = ImageDraw.Draw(im); ft = ImageFont.truetype(FONT, max(12, int(m * .09)))
            t = '暗剑'; bb = d.textbbox((0, 0), t, font=ft); d.text(((w - bb[2]) / 2, int(h * .42 + m * .27)), t, font=ft, fill=G)
        im.convert('RGB').save(path)
print('图标与启动画面已生成')
