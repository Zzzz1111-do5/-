# 用法：python3 -I tools/sandtex_render.py <解压的 glTF 目录> <输出前缀> 2048（出 _col.png 颜色、_h.npy 高度、_cov.npy 覆盖）
# 把扫描的沙地模型从正上方正投影渲染成颜色图 + 高度图（numpy 软光栅），供做平铺贴图
import json, sys, struct, numpy as np
from PIL import Image
src, out, N = sys.argv[1], sys.argv[2], int(sys.argv[3])
G = json.load(open(src + '/scene.gltf')); B = open(src + '/scene.bin', 'rb').read()
def acc(i):
    a = G['accessors'][i]; bv = G['bufferViews'][a['bufferView']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]; ct = {5126: np.float32, 5125: np.uint32, 5123: np.uint16}[a['componentType']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); st = bv.get('byteStride')
    if st and st != n * np.dtype(ct).itemsize:
        raw = np.frombuffer(B, np.uint8, count=st * a['count'], offset=off).reshape(a['count'], st)[:, :n * np.dtype(ct).itemsize]
        return np.frombuffer(raw.tobytes(), ct).reshape(a['count'], n)
    return np.frombuffer(B, ct, count=a['count'] * n, offset=off).reshape(a['count'], n) if n > 1 else np.frombuffer(B, ct, count=a['count'], offset=off)
M = np.array(G['nodes'][0]['matrix'], np.float64).reshape(4, 4).T
tex = [np.asarray(Image.open(src + '/' + im['uri']).convert('RGB'), np.float32) for im in G['images']]
P, UV, I, MT = [], [], [], []
base = 0
for mi, mesh in enumerate(G['meshes']):
    for pr in mesh['primitives']:
        p = acc(pr['attributes']['POSITION']).astype(np.float64); p = (np.c_[p, np.ones(len(p))] @ M.T)[:, :3]
        P.append(p); UV.append(acc(pr['attributes']['TEXCOORD_0']).astype(np.float64)); idx = acc(pr['indices']).astype(np.int64).reshape(-1, 3)
        I.append(idx + base); MT.append(np.full(len(idx), G['materials'][pr['material']]['pbrMetallicRoughness']['baseColorTexture']['index'])); base += len(p)
P = np.concatenate(P); UV = np.concatenate(UV); I = np.concatenate(I); MT = np.concatenate(MT)
c = P.mean(0); Q = P - c; w, V = np.linalg.eigh(Q.T @ Q); nrm = V[:, 0]
if nrm[1] < 0: nrm = -nrm   # 法线朝上（模型 y 朝上）
ax = V[:, 2]; ay = np.cross(nrm, ax)
X, Y, Z = Q @ ax, Q @ ay, Q @ nrm
print('extent', X.min(), X.max(), Y.min(), Y.max(), 'relief', Z.min(), Z.max())
x0, x1, y0, y1 = X.min(), X.max(), Y.min(), Y.max(); sc = (N - 1) / max(x1 - x0, y1 - y0)
px, py = (X - x0) * sc, (Y - y0) * sc
img = np.zeros((N, N, 3), np.float32); zb = np.full((N, N), -1e9, np.float32); cov = np.zeros((N, N), bool)
for t in range(len(I)):
    a, b, cc = I[t]
    xs = np.array([px[a], px[b], px[cc]]); ys = np.array([py[a], py[b], py[cc]])
    bx0, bx1 = int(np.floor(xs.min())), int(np.ceil(xs.max())); by0, by1 = int(np.floor(ys.min())), int(np.ceil(ys.max()))
    if bx1 < 0 or by1 < 0 or bx0 >= N or by0 >= N: continue
    bx0, by0 = max(bx0, 0), max(by0, 0); bx1, by1 = min(bx1, N - 1), min(by1, N - 1)
    gx, gy = np.meshgrid(np.arange(bx0, bx1 + 1) + .5, np.arange(by0, by1 + 1) + .5)
    d = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
    if abs(d) < 1e-12: continue
    l0 = ((ys[1] - ys[2]) * (gx - xs[2]) + (xs[2] - xs[1]) * (gy - ys[2])) / d; l1 = ((ys[2] - ys[0]) * (gx - xs[2]) + (xs[0] - xs[2]) * (gy - ys[2])) / d; l2 = 1 - l0 - l1
    m = (l0 >= -1e-4) & (l1 >= -1e-4) & (l2 >= -1e-4)
    if not m.any(): continue
    z = l0 * Z[a] + l1 * Z[b] + l2 * Z[cc]
    iy, ix = np.nonzero(m); iy2, ix2 = iy + by0, ix + bx0; zz = z[m]
    up = zz > zb[iy2, ix2]
    if not up.any(): continue
    iy2, ix2, zz = iy2[up], ix2[up], zz[up]
    u = (l0[m][up] * UV[a, 0] + l1[m][up] * UV[b, 0] + l2[m][up] * UV[cc, 0]); v = (l0[m][up] * UV[a, 1] + l1[m][up] * UV[b, 1] + l2[m][up] * UV[cc, 1])
    T = tex[MT[t]]; th, tw = T.shape[:2]
    img[iy2, ix2] = T[np.clip((v * th).astype(int), 0, th - 1), np.clip((u * tw).astype(int), 0, tw - 1)]
    zb[iy2, ix2] = zz; cov[iy2, ix2] = True
print('coverage', cov.mean(), 'units per px', 1 / sc)
Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(out + '_col.png')
zz = np.where(cov, zb, np.nan); np.save(out + '_h.npy', zz); np.save(out + '_cov.npy', cov)
