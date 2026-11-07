# 下载的 glTF 压缩包 → 烘焙用的目录：解到一个新的空目录里（只当数据：不执行任何东西），
#   贴图最长边超过 maxTex 的缩到 maxTex（LANCZOS）；不透明的 PNG 改存成 JPEG（文件名不变，烘焙按文件头认格式），透明的仍存 PNG。
#   原始压缩包不动（无损原件留着）。
# 用法：python3 -I tools/sfprep.py <gltf.zip> <输出目录（必须不存在或为空）> [maxTex=2048] [jpegQ=90]
import json, os, sys, zipfile, io
from PIL import Image

zp, out = sys.argv[1], sys.argv[2]
mx = int(sys.argv[3]) if len(sys.argv) > 3 else 2048
q = int(sys.argv[4]) if len(sys.argv) > 4 else 90
if os.path.exists(out) and os.listdir(out): raise SystemExit('输出目录不是空的：' + out)
os.makedirs(out, exist_ok=True)
Z = zipfile.ZipFile(zp)
root = os.path.realpath(out)
for info in Z.infolist():
  if info.is_dir(): continue
  dst = os.path.realpath(os.path.join(out, info.filename))
  if not dst.startswith(root + os.sep): raise SystemExit('压缩包里有越界路径：' + info.filename)   # 防 ../ 穿越
  os.makedirs(os.path.dirname(dst), exist_ok=True)
  with Z.open(info) as s, open(dst, 'wb') as d:
    while True:
      b = s.read(1 << 20)
      if not b: break
      d.write(b)
before = after = 0; n = 0
for dp, _, fs in os.walk(out):
  for f in fs:
    if not f.lower().endswith(('.png', '.jpg', '.jpeg')): continue
    p = os.path.join(dp, f); sz = os.path.getsize(p); before += sz
    try:
      im = Image.open(p); im.load()
    except Exception as e:
      print('  读不了图', f, e); after += sz; continue
    w, h = im.size; k = min(1, mx / max(w, h))
    alpha = im.mode in ('RGBA', 'LA', 'PA') or (im.mode == 'P' and 'transparency' in im.info)
    if alpha:
      a = im.convert('RGBA').getchannel('A')
      alpha = a.getextrema()[0] < 255
    if k >= 1 and (alpha or im.format == 'JPEG'): after += sz; continue
    if k < 1: im = im.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
    buf = io.BytesIO()
    if alpha: im.convert('RGBA').save(buf, 'PNG', optimize=True)
    else: im.convert('RGB').save(buf, 'JPEG', quality=q, optimize=True)
    if k >= 1 and buf.tell() >= sz: after += sz; continue   # 没缩、换格式也不省就不动
    open(p, 'wb').write(buf.getvalue()); after += buf.tell(); n += 1
print('解到 %s；贴图 %.1f MB → %.1f MB（改了 %d 张，最长边 ≤ %d）' % (out, before / 1e6, after / 1e6, n, mx))
