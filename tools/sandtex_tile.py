# 用法：python3 -I tools/sandtex_tile.py <前缀>_col.png <前缀>_cov.npy assets/terrain/sand.jpg（旧图，取平均色） <输出.jpg> 1024
# 扫描俯视图 → 无缝平铺的沙地贴图：裁最大的完整正方形、去掉大尺度明暗（拍摄时的光照渐变）、半格错位交叉淡化做成无缝、颜色均值对齐原来的 sand.jpg
import sys, numpy as np
from PIL import Image, ImageFilter
col, cov, old, out, N = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5])
A = np.asarray(Image.open(col).convert('RGB'), np.float32); C = np.load(cov)
H, W = C.shape
ys, xs = np.nonzero(C); cy, cx = int(ys.mean()), int(xs.mean())
best = None
for s in range(min(H, W) // 2, 64, -8):   # 以覆盖区重心为中心找最大的全覆盖正方形（允许中心挪一点）
    for dy in range(-200, 201, 25):
        for dx in range(-200, 201, 25):
            y0, x0 = cy + dy - s, cx + dx - s
            if y0 < 0 or x0 < 0 or y0 + 2 * s > H or x0 + 2 * s > W: continue
            if C[y0:y0 + 2 * s, x0:x0 + 2 * s].mean() > .9995: best = (y0, x0, 2 * s); break
        if best: break
    if best: break
y0, x0, n = best; print('crop', best)
T = A[y0:y0 + n, x0:x0 + n]
# 大尺度明暗：亮度按很宽的高斯模糊做分母压平
L = T.mean(2); Lb = np.asarray(Image.fromarray(np.clip(L, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(n / 7)), np.float32)
T = T * (L.mean() / np.maximum(Lb, 1))[..., None]
# 无缝：和错开半格的自己按「离边越近越用错位那张」的权重混合
k = np.minimum(np.arange(n), n - 1 - np.arange(n)) / (n / 2); w1 = np.clip(k / .55, 0, 1); w1 = w1 * w1 * (3 - 2 * w1)
Wm = np.minimum.outer(w1, w1)[..., None]
R = np.roll(np.roll(T, n // 2, 0), n // 2, 1)
Tt = T * Wm + R * (1 - Wm)
img = Image.fromarray(np.clip(Tt, 0, 255).astype(np.uint8)).resize((N, N), Image.LANCZOS)
Z = np.asarray(img, np.float32)
O = np.asarray(Image.open(old).convert('RGB'), np.float32)
Z = Z * (O.reshape(-1, 3).mean(0) / Z.reshape(-1, 3).mean(0))   # 平均颜色对齐原贴图（着色器里沙漠、沙滩的调色按原贴图标定的）
Z = (Z - Z.mean((0, 1))) * .8 + Z.mean((0, 1))   # 脚印阴影压淡一点：远看不花
Image.fromarray(np.clip(Z, 0, 255).astype(np.uint8)).save(out, quality=88, optimize=True, progressive=False)
print('mean old', O.reshape(-1, 3).mean(0), 'new', Z.reshape(-1, 3).mean(0), 'std old', O.std(), 'new', Z.std(), 'real px per tile', n)
