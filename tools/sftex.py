# 贴图解码（tools/sfmodel.js 调用）：把 glTF 的底色贴图（png / jpg / webp）缩到最长边 ≤ 512，存成原始 RGBA：
#   文件头 8 字节（宽、高，u32 小端）+ 宽 × 高 × 4 字节；sfmodel.js 按 UV 取平均色，把涂装色烘进三角形
#   用法：python3 -I tools/sftex.py 贴图 输出.raw（下载来的贴图只当数据读，-I 不从当前目录加载模块）
import struct, sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGBA')
s = min(1.0, 512.0 / max(im.size))
if s < 1:
    im = im.resize((max(1, round(im.size[0] * s)), max(1, round(im.size[1] * s))), Image.LANCZOS)
with open(dst, 'wb') as f:
    f.write(struct.pack('<II', im.size[0], im.size[1]))
    f.write(im.tobytes())
