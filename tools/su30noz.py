# 歼-16 喷口换成 Su-30 的：把 andertan 的「Sukhoi Su-30 flanker c」喷口里的发动机内腔（涡轮面、火焰稳定器的几圈环，纯颜色材质、不带贴图）
#   装进同一作者的「Shenyang J16 "Hidden Dragon"」的两个喷口——两个模型的发动机短舱 + 喷口是同一套网格（每侧 1868 个三角形），
#   歼-16 那套只是按非均匀比例放大了（轴向约 1.55 倍、径向约 1.79 倍）：按两边短舱的包围盒逐轴映射，内腔正好落在歼-16 喷口内壁里。
#   Su-30 那张三视图贴图（网上的 Su-33 三视图）、发光的尾焰圆盘不要：贴图是别人的画作，火光由游戏按发动机热度画（js/v3det.js v3dBurner）。
# 用法：python3 -I tools/su30noz.py <歼-16.glb> <Su-30.glb> <输出.glb>      （下载来的模型只当数据读：解析 JSON、读二进制，不执行其中任何东西）
import json, struct, sys, math
from collections import defaultdict

FACE_MATS = ('Greyish color', 'engine grey', 'gold', 'darkness')   # Su-30 发动机内腔的材质（模型里的名字）
NACELLE_TRIS = 1868                                                # 两个模型里每侧发动机短舱 + 喷口的三角形数


def read_glb(p):
    b = open(p, 'rb').read()
    if b[:4] != b'glTF': raise SystemExit('不是 GLB：' + p)
    o, ch = 12, []
    while o < len(b):
        cl, ct = struct.unpack('<I4s', b[o:o + 8]); ch.append((ct, b[o + 8:o + 8 + cl])); o += 8 + cl
    J = json.loads(ch[0][1]); BIN = ch[1][1] if len(ch) > 1 else b''
    return J, BIN


CT = {5126: ('f', 4), 5123: ('H', 2), 5125: ('I', 4), 5121: ('B', 1)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def acc(J, BIN, i):
    a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]; f, sz = CT[a['componentType']]; n = NC[a['type']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); st = bv.get('byteStride', sz * n)
    return [struct.unpack_from('<' + f * n, BIN, off + k * st) for k in range(a['count'])]


def mat_of(n):   # 节点的局部变换（列主序 4×4）
    if 'matrix' in n: return n['matrix']
    t = n.get('translation', [0, 0, 0]); x, y, z, w = n.get('rotation', [0, 0, 0, 1]); s = n.get('scale', [1, 1, 1])
    R = [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y), 2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x), 2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)]
    return [R[0] * s[0], R[1] * s[0], R[2] * s[0], 0, R[3] * s[1], R[4] * s[1], R[5] * s[1], 0, R[6] * s[2], R[7] * s[2], R[8] * s[2], 0, t[0], t[1], t[2], 1]


def mul(a, b): return [sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4)) for c in range(4) for r in range(4)]


def tri_soup(J, BIN):
    """场景里全部三角形：[(三个顶点的世界坐标, 三个法线, 三个 uv, 材质序号)]"""
    out = []
    def walk(ni, M):
        n = J['nodes'][ni]; M = mul(M, mat_of(n))
        if 'mesh' in n:
            # 法线矩阵：左上 3×3 的逆转置
            a, b, c, d, e, f, g, h, i = M[0], M[4], M[8], M[1], M[5], M[9], M[2], M[6], M[10]
            det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g) or 1
            N = [(e * i - f * h) / det, -(d * i - f * g) / det, (d * h - e * g) / det, -(b * i - c * h) / det, (a * i - c * g) / det, -(a * h - b * g) / det, (b * f - c * e) / det, -(a * f - c * d) / det, (a * e - b * d) / det]
            for pr in J['meshes'][n['mesh']]['primitives']:
                P = acc(J, BIN, pr['attributes']['POSITION']); Nr = acc(J, BIN, pr['attributes']['NORMAL']) if 'NORMAL' in pr['attributes'] else [(0, 0, 1)] * len(P)
                UV = acc(J, BIN, pr['attributes']['TEXCOORD_0']) if 'TEXCOORD_0' in pr['attributes'] else [(0, 0)] * len(P)
                I = [v[0] for v in acc(J, BIN, pr['indices'])] if 'indices' in pr else list(range(len(P)))
                W = [tuple(M[r] * v[0] + M[4 + r] * v[1] + M[8 + r] * v[2] + M[12 + r] for r in range(3)) for v in P]
                WN = []
                for v in Nr:
                    x, y, z = N[0] * v[0] + N[1] * v[1] + N[2] * v[2], N[3] * v[0] + N[4] * v[1] + N[5] * v[2], N[6] * v[0] + N[7] * v[1] + N[8] * v[2]
                    l = math.sqrt(x * x + y * y + z * z) or 1; WN.append((x / l, y / l, z / l))
                for k in range(0, len(I) - 2, 3):
                    t = I[k:k + 3]; out.append(([W[j] for j in t], [WN[j] for j in t], [UV[j] for j in t], pr.get('material')))
        for c in n.get('children', []): walk(c, M)
    I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    for r in J['scenes'][J.get('scene', 0)]['nodes']: walk(r, I4)
    return out


def comps(T):
    """按顶点位置焊接后的连通块：[[三角形序号]]"""
    key = lambda v: (round(v[0] * 2000), round(v[1] * 2000), round(v[2] * 2000))
    par = {}
    def find(a):
        while par[a] != a: par[a] = par[par[a]]; a = par[a]
        return a
    for t in T:
        ks = [key(v) for v in t[0]]
        for k in ks: par.setdefault(k, k)
        for k in ks[1:]:
            a, b = find(ks[0]), find(k)
            if a != b: par[a] = b
    C = defaultdict(list)
    for i, t in enumerate(T): C[find(key(t[0][0]))].append(i)
    return list(C.values())


def bbox(T, ids):
    xs = [v for i in ids for v in T[i][0]]
    return [min(v[k] for v in xs) for k in range(3)], [max(v[k] for v in xs) for k in range(3)]


jp, sp, outp = sys.argv[1:4]
J1, B1 = read_glb(jp); J2, B2 = read_glb(sp)
T1, T2 = tri_soup(J1, B1), tri_soup(J2, B2)
nac1 = sorted([c for c in comps(T1) if len(c) == NACELLE_TRIS], key=lambda c: bbox(T1, c)[0][2])
nac2 = sorted([c for c in comps(T2) if len(c) == NACELLE_TRIS], key=lambda c: bbox(T2, c)[0][2])
if len(nac1) != 2 or len(nac2) != 2: raise SystemExit('两个模型里没找到左右各一个 %d 面的发动机短舱（%d / %d）' % (NACELLE_TRIS, len(nac1), len(nac2)))
fm = {i for i, m in enumerate(J2['materials']) if m.get('name') in FACE_MATS}
faces = sorted([c for c in comps(T2) if all(T2[i][3] in fm for i in c)], key=lambda c: bbox(T2, c)[0][2])
if len(faces) != 2: raise SystemExit('Su-30 里没找到左右两个发动机内腔（%d）' % len(faces))
new = []   # (世界坐标三个点, 法线, uv, 新材质名)
for side in (0, 1):
    (a0, a1), (b0, b1) = bbox(T2, nac2[side]), bbox(T1, nac1[side])
    s = [(b1[k] - b0[k]) / (a1[k] - a0[k]) for k in range(3)]
    for i in faces[side]:
        P, N, UV, m = T2[i]
        P = [tuple(b0[k] + (v[k] - a0[k]) * s[k] for k in range(3)) for v in P]
        N2 = []
        for n in N:   # 非均匀缩放：法线按逆缩放再单位化
            x, y, z = n[0] / s[0], n[1] / s[1], n[2] / s[2]; l = math.sqrt(x * x + y * y + z * z) or 1; N2.append((x / l, y / l, z / l))
        new.append((P, N2, UV, J2['materials'][m]['name']))
    print('第 %d 侧：Su-30 短舱 %s–%s → 歼-16 %s–%s，逐轴缩放 %s' % (side, [round(x, 3) for x in a0], [round(x, 3) for x in a1], [round(x, 3) for x in b0], [round(x, 3) for x in b1], [round(x, 4) for x in s]))

# —— 写出：歼-16 原样 + 一个新节点（单位变换，顶点就是世界坐标），每种材质一个图元 ——
J, BIN = J1, bytearray(B1)
while len(BIN) % 4: BIN.append(0)
mi = {}
for m in J2['materials']:
    if m.get('name') in FACE_MATS:
        c = {k: v for k, v in m.items() if k != 'extensions'}; c['name'] = 'su30_' + m['name'].replace(' ', '_')
        mi[m['name']] = len(J['materials']); J['materials'].append(c)
prims = []
for nm, idx in mi.items():
    L = [t for t in new if t[3] == nm]
    if not L: continue
    P = [v for t in L for v in t[0]]; N = [v for t in L for v in t[1]]; UV = [v for t in L for v in t[2]]
    def put(fmt, rows, typ, ctype, target=None, mm=False):
        off = len(BIN)
        for r in rows: BIN.extend(struct.pack('<' + fmt, *r))
        while len(BIN) % 4: BIN.append(0)
        bv = {'buffer': 0, 'byteOffset': off, 'byteLength': len(rows) * struct.calcsize('<' + fmt)}
        if target: bv['target'] = target
        J['bufferViews'].append(bv)
        a = {'bufferView': len(J['bufferViews']) - 1, 'componentType': ctype, 'count': len(rows), 'type': typ}
        if mm: a['min'] = [min(r[k] for r in rows) for k in range(len(rows[0]))]; a['max'] = [max(r[k] for r in rows) for k in range(len(rows[0]))]
        J['accessors'].append(a)
        return len(J['accessors']) - 1
    pa = put('fff', P, 'VEC3', 5126, 34962, True); na = put('fff', N, 'VEC3', 5126, 34962); ua = put('ff', UV, 'VEC2', 5126, 34962)
    ia = put('I', [(k,) for k in range(len(P))], 'SCALAR', 5125, 34963)
    prims.append({'attributes': {'POSITION': pa, 'NORMAL': na, 'TEXCOORD_0': ua}, 'indices': ia, 'material': idx})
J['meshes'].append({'name': 'su30_engine_face', 'primitives': prims})
J['nodes'].append({'name': 'su30_engine_face', 'mesh': len(J['meshes']) - 1})
J['scenes'][J.get('scene', 0)]['nodes'].append(len(J['nodes']) - 1)
J['buffers'][0]['byteLength'] = len(BIN)
J.setdefault('asset', {}).setdefault('extras', {})['modified'] = '喷口里装了 Sukhoi Su-30 flanker c（andertan，CC-BY-4.0，https://sketchfab.com/3d-models/sukhoi-su-30-flanker-c-92ca062c90fd45ffb6ce8144dc46004a）的发动机内腔'
js = json.dumps(J, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
while len(js) % 4: js += b' '
with open(outp, 'wb') as f:
    f.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(BIN)))
    f.write(struct.pack('<I4s', len(js), b'JSON')); f.write(js)
    f.write(struct.pack('<I4s', len(BIN), b'BIN\x00')); f.write(bytes(BIN))
print('写出 %s：加了 %d 个三角形（%d 种材质）' % (outp, len(new), len(prims)))
