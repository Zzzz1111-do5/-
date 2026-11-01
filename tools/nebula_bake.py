"""星云点云烘焙：Sketchfab 下载的点云 glTF（POINTS 图元、每点 POSITION + COLOR_0）→ js/mdl/nebula.js（js/v3neb.js 画）。

用法：python3 -I tools/nebula_bake.py <scene.gltf> [点数=300000]
  · 只读 glTF 与它引用的 .bin（当作数据解析，不执行里面的任何东西）
  · 去掉几乎全黑的点（亮度 < 0.012：加法混合下看不见），在剩下的里按固定种子均匀抽样到指定点数
  · 坐标减去重心、按最大绝对值量化成 16 位整数；颜色 RGB 各 8 位
  · 输出 V3G.add("nebula", 元数据, base64)：先是 3n 个 int16 坐标，再是 3n 个 uint8 颜色
"""
import base64
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    src = sys.argv[1]
    n_out = int(sys.argv[2]) if len(sys.argv) > 2 else 300000
    g = json.load(open(src, encoding='utf-8'))
    buf_uri = g['buffers'][0]['uri']
    if '/' in buf_uri or '\\' in buf_uri or buf_uri.startswith('.'):
        raise SystemExit('buffer uri 不是同目录文件：' + buf_uri)
    raw = np.fromfile(os.path.join(os.path.dirname(src), buf_uri), dtype=np.uint8)

    def acc(i, comp):
        a = g['accessors'][i]
        if a['componentType'] != 5126:
            raise SystemExit('只支持 float 属性')
        bv = g['bufferViews'][a['bufferView']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        st = bv.get('byteStride', comp * 4)
        n = a['count']
        return raw[off:off + st * n].view(np.float32).reshape(n, st // 4)[:, :comp]

    P, C = [], []
    for m in g['meshes']:
        for p in m['primitives']:
            if p.get('mode', 4) != 0:
                continue
            P.append(acc(p['attributes']['POSITION'], 3))
            C.append(acc(p['attributes']['COLOR_0'], 4)[:, :3])
    P = np.concatenate(P).astype(np.float64)
    C = np.clip(np.concatenate(C), 0, 1)
    n0 = len(P)
    lum = C @ np.array([.3, .59, .11])
    keep = lum >= .012
    P, C = P[keep], C[keep]
    rng = np.random.default_rng(20251101)
    if len(P) > n_out:
        idx = np.sort(rng.choice(len(P), n_out, replace=False))
        P, C = P[idx], C[idx]
    perm = rng.permutation(len(P))   # 打乱顺序：画面按画质只画前一部分时，前面任意一段都是均匀的抽样
    P, C = P[perm], C[perm]
    P -= P.mean(0)
    s = float(np.abs(P).max())
    q = np.round(P / s * 32767).astype('<i2')
    col = np.round(C * 255).astype(np.uint8)
    data = q.tobytes() + col.tobytes()
    ex = (g.get('asset') or {}).get('extras') or {}
    meta = {'v': 1, 'key': 'nebula', 'kind': 'points', 'n': int(len(q)), 's': round(s, 6), 'src': n0,
            'name': '超新星遗迹', 'title': ex.get('title', ''), 'author': ex.get('author', ''), 'url': ex.get('source', ''), 'license': ex.get('license', '')}
    head = ('// 超新星遗迹星云（白色平原的太空背景，js/v3neb.js 画）：' + meta['title'] + '，作者 ' + meta['author'] + '（' + meta['url'] + '），' + meta['license']
            + ' 授权。改动：原模型 ' + str(n0) + ' 个点去掉近乎全黑的、抽样到 ' + str(meta['n']) + ' 个，坐标量化为 16 位、颜色 8 位（tools/nebula_bake.py）。署名见 docs/credits.md\n')
    out = os.path.join(ROOT, 'js', 'mdl', 'nebula.js')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(head)
        f.write('V3G.add("nebula", ' + json.dumps(meta, ensure_ascii=False) + ', "' + base64.b64encode(data).decode('ascii') + '");\n')
    print('写出', out, os.path.getsize(out), '字节；点数', meta['n'], '/', n0, '；坐标尺度', s)


if __name__ == '__main__':
    main()
