# 地势高度场：Sketchfab 上 hirnlaich 的「Soft Hills」（CC-BY-4.0，Gaea 生成的 1K 地形）→ js/hmap.js
#   用法：python3 -I tools/hmap_build.py <解压后的 glTF 目录>（tools/sfmodel.js 的下载缓存 tools/.cache/sketchfab/7450a967693e49bf8fd9e6da42f5b292/gltf）
#   只读 glTF 的 JSON 与二进制顶点（当数据读，不执行其中任何东西）：顶点高度落到 1024 × 1024 网格 → 轻微平滑 → 缩成 384 × 384 → 归一化到 0–255，base64 写进 js/hmap.js
import json, sys, base64, os, numpy as np
d = sys.argv[1]
g = json.load(open(os.path.join(d, 'scene.gltf'))); B = open(os.path.join(d, 'scene.bin'), 'rb').read()
xs, ys, zs = [], [], []
for m in g['meshes']:
    for p in m['primitives']:
        a = g['accessors'][p['attributes']['POSITION']]; bv = g['bufferViews'][a['bufferView']]
        st = bv.get('byteStride', 12); off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); n = a['count']
        arr = np.frombuffer(B, dtype=np.float32, count=(n - 1) * st // 4 + 3, offset=off).copy()
        v = np.lib.stride_tricks.as_strided(arr, shape=(n, 3), strides=(st, 4))
        xs.append(v[:, 0].copy()); ys.append(v[:, 1].copy()); zs.append(v[:, 2].copy())
x = np.concatenate(xs); y = np.concatenate(ys); z = np.concatenate(zs)
N = 1024
ix = np.clip(np.round((x - x.min()) / (x.max() - x.min()) * (N - 1)).astype(int), 0, N - 1)
iz = np.clip(np.round((z - z.min()) / (z.max() - z.min()) * (N - 1)).astype(int), 0, N - 1)
H = np.full((N, N), np.nan, dtype=np.float64); H[iz, ix] = y
for _ in range(20):   # 补洞（一般没有）
    msk = np.isnan(H)
    if not msk.any(): break
    P = np.pad(H, 1, mode='edge'); S = np.zeros_like(H); C = np.zeros_like(H)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            q = P[1 + dy:1 + dy + N, 1 + dx:1 + dx + N]; ok = ~np.isnan(q); S[ok] += q[ok]; C[ok] += 1
    f = msk & (C > 0); H[f] = S[f] / C[f]
def blur(A, r):   # 盒式平滑三遍 ≈ 高斯：缩小前去掉比目标像素还细的起伏（免得缩小后成了一颗颗小鼓包）
    for _ in range(3):
        P = np.pad(A, r, mode='reflect'); c = np.cumsum(np.cumsum(P, 0), 1); c = np.pad(c, ((1, 0), (1, 0)))
        k = 2 * r + 1; A = (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)
    return A
H = blur(H, 1)
M = 384
idx = (np.arange(M) * (N - 1) / (M - 1))
i0 = np.floor(idx).astype(int); i1 = np.minimum(i0 + 1, N - 1); f = idx - i0
Hr = H[i0][:, i0] * np.outer(1 - f, 1 - f) + H[i0][:, i1] * np.outer(1 - f, f) + H[i1][:, i0] * np.outer(f, 1 - f) + H[i1][:, i1] * np.outer(f, f)
Hr = (Hr - Hr.min()) / (Hr.max() - Hr.min())
q = np.round(Hr * 255).astype(np.uint8)
b64 = base64.b64encode(q.tobytes()).decode()
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = """'use strict';
// 地势高度场：Sketchfab 上 hirnlaich 的「Soft Hills」（https://sketchfab.com/3d-models/soft-hills-7450a967693e49bf8fd9e6da42f5b292，CC-BY-4.0，Gaea 生成的 1K 地形）——
//   取顶点高度重采样成 %d × %d、归一化到 0–255（tools/hmap_build.py 生成，改动：只取高度、平滑缩小、按地图缩放与翻转）。
//   默认地图、海岛地图的丘陵起伏照它（mapgen.js buildMap、isle.js buildIsle），换掉原来随机撒的近百个小山包与两层高频噪声
const HMAP = (() => {
  const s = '%s', A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', T = new Uint8Array(128), n = s.length;
  for (let i = 0; i < 64; i++) T[A.charCodeAt(i)] = i;
  const d = new Uint8Array(n / 4 * 3 - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0));
  for (let i = 0, j = 0; i < n; i += 4) {
    const v = T[s.charCodeAt(i)] << 18 | T[s.charCodeAt(i + 1)] << 12 | T[s.charCodeAt(i + 2)] << 6 | T[s.charCodeAt(i + 3)];
    if (j < d.length) d[j++] = v >> 16 & 255; if (j < d.length) d[j++] = v >> 8 & 255; if (j < d.length) d[j++] = v & 255;
  }
  return { w: %d, h: %d, d };
})();
// 署名（游戏里「设置 → 素材致谢」，v3import.js v3imCredits）
const HMAP_CRED = [{ name: '地图丘陵地势（高度场）', title: 'Soft Hills', author: 'hirnlaich', license: 'CC-BY-4.0', url: 'https://sketchfab.com/3d-models/soft-hills-7450a967693e49bf8fd9e6da42f5b292' }];
// 在地图上摆一张高度场：横向铺满宽 Wm 米，按种子左右 / 上下翻转、上下错开一段；超出的地方镜像折返（无缝）；返回 (x, y) → 0–1（双线性插值）
function hmapWin(r, Wm) {
  const fx = r() < .5, fy = r() < .5, oy = r() * HMAP.h, k = (HMAP.w - 1) / Wm, w = HMAP.w, h = HMAP.h, D = HMAP.d;
  const ref = (v, m) => { v = ((v %% (2 * m)) + 2 * m) %% (2 * m); return v >= m ? 2 * m - 1 - v : v; };
  const at = (i, j) => D[ref(j, h) * w + ref(i, w)];
  return (x, y) => {
    let u = x * k, v = y * k + oy;
    if (fx) u = w - 1 - u;
    if (fy) v = -v;
    const i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j;
    return ((at(i, j) * (1 - a) + at(i + 1, j) * a) * (1 - b) + (at(i, j + 1) * (1 - a) + at(i + 1, j + 1) * a) * b) / 255;
  };
}
""" % (M, M, b64, M, M)
open(os.path.join(root, 'js', 'hmap.js'), 'w').write(src)
print('js/hmap.js', len(src), 'bytes; mean', float(Hr.mean()))
