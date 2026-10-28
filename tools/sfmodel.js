// Sketchfab 模型导入（只收 CC0 / CC-BY：允许商用、允许改）：按清单 tools/sfmodels.json 下载 glTF，展开节点，
//   统一朝向与尺寸（建模坐标 x 船头 / 机头、y 右、z 上，单位米），减面（meshoptimizer），按棱角算发光棱线，
//   输出 js/mdl/<键>.js（游戏按需加载，js/v3x.js 解码成与代码建模同一种网格）；署名写进 docs/credits.md 与游戏里的 legal/credits.html
// 用法：SKETCHFAB_TOKEN=你的密钥 node tools/sfmodel.js [键 …]（不给键就处理清单里全部）
//   密钥只从环境变量读，不写进任何文件；下载缓存在 tools/.cache/sketchfab/<uid>/（不进仓库），已经下过的不用密钥
//   下载来的文件只当数据读（解析 JSON 与二进制），不执行其中任何东西
// 清单每项：uid、name、fwd / up（模型的前、上是哪根轴）、len（实长，米）、draft（吃水，米；飞机不给）、tris（减面后面数）、crease（棱线角度）；
//   车辆、飞机给 floor: true（轮子着地处为 z = 0）；飞机给 air: {} 另出收起落架的 <键>_a（gearless）；
//   lines：{ crease 度, min 米, tol 米 } 只画整理好的轮廓线（featureLines），三角形不描边；
//   parts：活动舵面 { 名: { box: [x0, x1, |y| 下限, |y| 上限, z0, z1], piv: [转轴 x, 转轴 z], nz: 法线竖直分量下限 } }，切成 <键>_<名>L / R；skip：不要的节点名（正则，比如展示用的地面板）；舰船可给 vls：垂发块 [x0, x1, y0, y1, 盖面高, 纵向格数, 横向格数]（转换后的建模坐标，米；对着转换结果量），垂发出弹与开盖动画按它
'use strict';
const fs = require('fs'), path = require('path'), https = require('https'), { execFileSync } = require('child_process');
const { MeshoptSimplifier } = require('meshoptimizer');
const ROOT = path.resolve(__dirname, '..'), CACHE = path.join(ROOT, 'tools', '.cache', 'sketchfab'), OUT = path.join(ROOT, 'js', 'mdl');
const LIST = JSON.parse(fs.readFileSync(path.join(__dirname, 'sfmodels.json'), 'utf8'));
const TOKEN = process.env.SKETCHFAB_TOKEN || '';
const OK_LIC = new Set(['by', 'cc0']);

function get(url, headers = {}, n = 0) {
  return new Promise((res, rej) => {
    https.get(url, { headers }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && n < 5) { r.resume(); res(get(new URL(r.headers.location, url).href, {}, n + 1)); return; }
      if (r.statusCode !== 200) { r.resume(); rej(new Error(`HTTP ${r.statusCode} ${url.split('?')[0]}`)); return; }
      const ch = []; r.on('data', d => ch.push(d)); r.on('end', () => res(Buffer.concat(ch)));
    }).on('error', rej);
  });
}
// 下载并解开到缓存目录；授权不是 CC0 / CC-BY 的不收
async function fetchModel(uid) {
  const dir = path.join(CACHE, uid), info = path.join(dir, 'info.json');
  if (fs.existsSync(path.join(dir, 'gltf', 'scene.gltf')) && fs.existsSync(info)) return { dir: path.join(dir, 'gltf'), info: JSON.parse(fs.readFileSync(info, 'utf8')) };
  const I = JSON.parse(await get(`https://api.sketchfab.com/v3/models/${uid}`));
  const lic = I.license && I.license.slug;
  if (!OK_LIC.has(lic)) throw new Error(`「${I.name}」的授权是 ${I.license && I.license.label}，不是 CC0 / CC-BY，不能用`);
  if (!TOKEN) throw new Error('没有缓存，需要环境变量 SKETCHFAB_TOKEN 才能下载');
  const D = JSON.parse(await get(`https://api.sketchfab.com/v3/models/${uid}/download`, { Authorization: 'Token ' + TOKEN }));
  if (!D.gltf || !D.gltf.url) throw new Error('这个模型没有 glTF 下载');
  fs.mkdirSync(path.join(dir, 'gltf'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'model.zip'), await get(D.gltf.url));
  execFileSync('unzip', ['-o', '-q', path.join(dir, 'model.zip'), '-d', path.join(dir, 'gltf')]);
  const keep = { uid, name: I.name, author: I.user && I.user.displayName, profile: I.user && I.user.profileUrl, url: I.viewerUrl, license: I.license.label, slug: lic, licUrl: I.license.url };
  fs.writeFileSync(info, JSON.stringify(keep, null, 1));
  return { dir: path.join(dir, 'gltf'), info: keep };
}

// —— glTF：展开全部三角形（世界坐标），带材质类别与明暗 ——
const CT = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array, 5122: Int16Array, 5120: Int8Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function loadGltf(dir, skip) {
  const G = JSON.parse(fs.readFileSync(path.join(dir, 'scene.gltf'), 'utf8'));
  const bufs = G.buffers.map(b => {   // 下载来的文件不可信：缓冲区只许在模型目录里
    const f = path.resolve(dir, decodeURIComponent(b.uri || ''));
    if (!f.startsWith(path.resolve(dir) + path.sep)) throw new Error('缓冲区路径出了模型目录：' + b.uri);
    return fs.readFileSync(f);
  });
  const acc = i => {
    const a = G.accessors[i], bv = G.bufferViews[a.bufferView], T = CT[a.componentType], n = NC[a.type], sz = T.BYTES_PER_ELEMENT;
    const st = bv.byteStride || sz * n, off = (bv.byteOffset || 0) + (a.byteOffset || 0), B = bufs[bv.buffer], out = new Float64Array(a.count * n);
    const dv = new DataView(B.buffer, B.byteOffset, B.byteLength), rd = { 5126: 'getFloat32', 5125: 'getUint32', 5123: 'getUint16', 5121: 'getUint8', 5122: 'getInt16', 5120: 'getInt8' }[a.componentType];
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = dv[rd](off + k * st + c * sz, true);
    return out;
  };
  const mat4 = nd => {
    if (nd.matrix) return nd.matrix.slice();
    const [x, y, z, w] = nd.rotation || [0, 0, 0, 1], [sx, sy, sz] = nd.scale || [1, 1, 1], [tx, ty, tz] = nd.translation || [0, 0, 0];
    return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
      2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
  };
  const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };   // 列主序
  const tris = [];   // { p: [9 个坐标], cls, s }
  const matCls = mi => {
    const m = (G.materials || [])[mi] || {}, nm = (m.name || '').toLowerCase(), pb = m.pbrMetallicRoughness || {}, f = pb.baseColorFactor || [1, 1, 1, 1], em = Math.max(...(m.emissiveFactor || [0, 0, 0]));
    const lum = .299 * f[0] + .587 * f[1] + .114 * f[2], tex = !!pb.baseColorTexture;
    if (/glass|window|lamp|light|led/.test(nm) || em > .3) return { cls: 'glow', s: -.8 };
    if (m.alphaMode === 'MASK' || m.alphaMode === 'BLEND' || f[3] < .9) return { cls: 'mask', s: .5 };   // 栏杆、护网这类透明贴图：只留轮廓线
    return { cls: 'solid', s: tex && lum > .95 ? .7 : Math.max(.35, Math.min(.95, .35 + lum * .65)) };
  };
  const walk = (i, M) => {
    const nd = G.nodes[i], W = mul(M, mat4(nd));
    if (skip && skip.test(nd.name || '')) return;   // 清单 skip：不要的节点（展示用的地面板之类）
    if (nd.mesh != null) for (const pr of G.meshes[nd.mesh].primitives) {
      if ((pr.mode ?? 4) !== 4) continue;
      const P = acc(pr.attributes.POSITION), I = pr.indices != null ? acc(pr.indices) : Array.from({ length: P.length / 3 }, (_, k) => k), C = matCls(pr.material);
      const X = k => [W[0] * P[k * 3] + W[4] * P[k * 3 + 1] + W[8] * P[k * 3 + 2] + W[12], W[1] * P[k * 3] + W[5] * P[k * 3 + 1] + W[9] * P[k * 3 + 2] + W[13], W[2] * P[k * 3] + W[6] * P[k * 3 + 1] + W[10] * P[k * 3 + 2] + W[14]];
      for (let t = 0; t + 2 < I.length; t += 3) tris.push({ p: [...X(I[t]), ...X(I[t + 1]), ...X(I[t + 2])], cls: C.cls, s: C.s });
    }
    for (const c of nd.children || []) walk(c, W);
  };
  const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const r of G.scenes[G.scene || 0].nodes) walk(r, I4);
  return { tris, mats: (G.materials || []).map((m, i) => (m.name || i) + ':' + matCls(i).cls) };
}

// 轴：'+x' '-x' '+y' '-y' '+z' '-z'
const AX = s => { const v = [0, 0, 0]; v['xyz'.indexOf(s[1])] = s[0] === '-' ? -1 : 1; return v; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const pct = (A, q) => { const s = Float64Array.from(A).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]; };
const amin = A => { let m = Infinity; for (const v of A) if (v < m) m = v; return m; }, amax = A => { let m = -Infinity; for (const v of A) if (v > m) m = v; return m; };   // 几十万个数不能用 Math.min(...A)（调用栈放不下）
const pushAll = (A, B) => { for (const v of B) A.push(v); };
const STATS = {};   // 每个输出键的棱线统计（打印用）

async function convert(key, E) {
  const { dir, info } = await fetchModel(E.uid);
  let { tris, mats } = loadGltf(dir, E.skip ? new RegExp(E.skip) : null);
  // 换到建模坐标：x = 前、y = 右、z = 上（左手系）——glTF 是右手系，镜像一次，三角形顶点顺序反过来法线才朝外
  const F = AX(E.fwd || '+z'), U = AX(E.up || '+y'), R = cross(F, U);
  const all = []; for (const t of tris) for (let k = 0; k < 9; k += 3) all.push([t.p[k], t.p[k + 1], t.p[k + 2]]);
  const xs = all.map(p => dot(p, F)), ys = all.map(p => dot(p, R)), zs = all.map(p => dot(p, U));
  const x0 = amin(xs), x1 = amax(xs), k = E.len / (x1 - x0), yc = (pct(ys, .02) + pct(ys, .98)) / 2, zb = amin(zs);
  const z0 = E.draft != null ? zb + E.draft / k : E.floor ? zb : (amin(zs) + amax(zs)) / 2;   // 舰船：水线（离最低点 draft 米）为 z = 0；车辆（floor）：着地点为 z = 0；导弹、飞机：包围盒中心
  const tf0 = p => [(dot(p, F) - (x0 + x1) / 2) * k, (dot(p, R) - yc) * k, (dot(p, U) - z0) * k];
  let tf = tf0;
  // 活动舵面（parts）：按区域切出近似水平的面（平尾、鸭翼），左右各一块，坐标以转轴为原点（画面里按算出的偏角转）
  const PT = [];
  if (E.parts) {
    const own = new Map();
    for (const t of tris) {
      const P = [tf0(t.p.slice(0, 3)), tf0(t.p.slice(3, 6)), tf0(t.p.slice(6, 9))], c = [0, 1, 2].map(a => (P[0][a] + P[1][a] + P[2][a]) / 3);
      const n = cross([P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]]), nl = Math.hypot(...n) || 1;
      for (const [nm, D] of Object.entries(E.parts)) {
        const [bx0, bx1, ya, yb, bz0, bz1] = D.box;
        if (c[0] < bx0 || c[0] > bx1 || Math.abs(c[1]) < ya || Math.abs(c[1]) > yb || c[2] < bz0 || c[2] > bz1 || Math.abs(n[2] / nl) < (D.nz ?? .6)) continue;
        own.set(t, nm + (c[1] < 0 ? 'L' : 'R')); break;
      }
    }
    for (const [nm, D] of Object.entries(E.parts)) for (const sd of ['L', 'R']) PT.push({ key: key + '_' + nm + sd, piv: D.piv, tris: tris.filter(t => own.get(t) === nm + sd) });
    tris = tris.filter(t => !own.has(t));
  }
  const lines = [], meta0 = PT.length ? { parts: Object.fromEntries(Object.entries(E.parts).map(([nm, D]) => [nm, D.piv])) } : {};
  lines.push(await emit(tris, key, meta0));
  for (const P of PT) { if (!P.tris.length) { console.warn(P.key, '这块舵面没切到面'); continue; } tf = p => { const q = tf0(p); return [q[0] - P.piv[0], q[1], q[2] - P.piv[1]]; }; lines.push(await emit(P.tris, P.key, { piv: P.piv })); }
  tf = tf0;
  fs.mkdirSync(OUT, { recursive: true });
  const head = `'use strict';\n// ${E.name}：${creditLine(info)}\n// 由 tools/sfmodel.js 转换（减面、统一朝向与尺寸、算发光棱线），不要手改\n`;
  fs.writeFileSync(path.join(OUT, key + '.js'), head + lines.join(''));
  if (E.air) fs.writeFileSync(path.join(OUT, key + '_a.js'), head + await emit(gearless(tris, tf, E.air), key + '_a', { air: 1, ...meta0 }));   // 飞机：另出一个收起落架的空中版（舵面块在主文件里）
  // 一个变体：焊接、减面、算棱线、编码，返回一行 V3X.add(…)
  async function emit(tris, key, extra) {
  // 按类别焊接顶点（1 厘米网格）、减面
  const out = { v: [], t: [], e: [], s: [], l: [] };
  for (const cls of ['solid', 'glow', 'mask']) {
    const T = tris.filter(t => t.cls === cls);
    if (!T.length) continue;
    const map = new Map(), V = [], S = [], IDX = [];
    const vid = p => { const q = tf(p), h = q.map(v => Math.round(v * 100)).join(','); let i = map.get(h); if (i == null) { i = V.length / 3; map.set(h, i); V.push(...q); } return i; };
    const seen = new Set();   // 双面导出的模型每个面有一正一反两个三角形：只留一个，不然每条边都被当成非流形边描出来
    for (const t of T) { const a = vid(t.p.slice(0, 3)), b = vid(t.p.slice(3, 6)), c = vid(t.p.slice(6, 9)); if (a === b || b === c || a === c) continue; const h = [a, b, c].sort((x, y) => x - y).join(','); if (seen.has(h)) continue; seen.add(h); IDX.push(a, c, b); S.push(t.s); }   // 反顺序（镜像）
    if (cls === 'solid' && E.lines) featureLines(V, IDX, E.lines, out);   // 轮廓线在原始精度的网格上提取（减面前）
    if (cls === 'mask') {   // 透明贴图的面：只取边界线（只属于一个三角形的边）
      const cnt = new Map(); for (let i = 0; i < IDX.length; i += 3) for (const [a, b] of [[IDX[i], IDX[i + 1]], [IDX[i + 1], IDX[i + 2]], [IDX[i + 2], IDX[i]]]) { const h = Math.min(a, b) + ',' + Math.max(a, b); cnt.set(h, (cnt.get(h) || 0) + 1); }
      const base = out.v.length / 3; pushAll(out.v, V);
      for (const [h, n] of cnt) if (n === 1) { const [a, b] = h.split(',').map(Number), d = Math.hypot(V[a * 3] - V[b * 3], V[a * 3 + 1] - V[b * 3 + 1], V[a * 3 + 2] - V[b * 3 + 2]); if (d > (E.minLine || .25)) out.l.push(base + a, base + b); }
      continue;
    }
    // 减面：按三角形数配额
    let I = Uint32Array.from(IDX), Ss = S;
    const want = Math.round((cls === 'solid' ? E.tris : (E.glowTris || 2000)) * 3);
    if (I.length > want) {
      await MeshoptSimplifier.ready;
      const [J] = MeshoptSimplifier.simplify(I, Float32Array.from(V), 3, want, E.err ?? .02, []);
      const sOf = new Map(); for (let i = 0; i < IDX.length; i += 3) { const s = S[i / 3]; for (let k2 = 0; k2 < 3; k2++) sOf.set(IDX[i + k2], s); }
      I = J; Ss = []; for (let i = 0; i < I.length; i += 3) Ss.push(sOf.get(I[i]) ?? .7);
    }
    // 只留用到的顶点
    const used = new Map(), base = out.v.length / 3;
    for (const i of I) if (!used.has(i)) { used.set(i, base + used.size); out.v.push(V[i * 3], V[i * 3 + 1], V[i * 3 + 2]); }
    const J = Array.from(I, i => used.get(i));
    // 统一绕向：有的模型相邻面片朝向不一致（法线相反），会被当成锐角描出一片乱线——沿流形边广度优先翻正，每个连通块以原来的多数朝向为准
    { const nt = J.length / 3, flip = new Uint8Array(nt), done = new Uint8Array(nt), E2 = new Map(), ek = (a, b) => a < b ? a + ',' + b : b + ',' + a;
      for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const a = J[t * 3 + k], b = J[t * 3 + (k + 1) % 3], h = ek(a, b); (E2.get(h) || E2.set(h, []).get(h)).push([t, a, b]); }
      for (let s0 = 0; s0 < nt; s0++) {
        if (done[s0]) continue;
        done[s0] = 1; const st = [s0], comp = [s0];
        while (st.length) {
          const t = st.pop();
          for (let k = 0; k < 3; k++) {
            let a = J[t * 3 + k], b = J[t * 3 + (k + 1) % 3]; if (flip[t]) [a, b] = [b, a];
            const L = E2.get(ek(a, b)); if (L.length !== 2) continue;
            for (const [u, ua, ub] of L) if (u !== t && !done[u]) { flip[u] = ua === a && ub === b ? 1 : 0; done[u] = 1; st.push(u); comp.push(u); }
          }
        }
        if (comp.reduce((n, t) => n + flip[t], 0) * 2 > comp.length) for (const t of comp) flip[t] ^= 1;
      }
      for (let t = 0; t < nt; t++) if (flip[t]) { const q = J[t * 3 + 1]; J[t * 3 + 1] = J[t * 3 + 2]; J[t * 3 + 2] = q; }
    }
    // 发光棱线：边界边、非流形边、两面夹角大于 E.crease 度的边
    const P = i => [out.v[i * 3], out.v[i * 3 + 1], out.v[i * 3 + 2]], nrm = (a, b, c) => { const n = cross([P(b)[0] - P(a)[0], P(b)[1] - P(a)[1], P(b)[2] - P(a)[2]], [P(c)[0] - P(a)[0], P(c)[1] - P(a)[1], P(c)[2] - P(a)[2]]), l = Math.hypot(...n) || 1; return n.map(v => v / l); };
    const N = [], adj = new Map();
    for (let i = 0; i < J.length; i += 3) { N.push(nrm(J[i], J[i + 1], J[i + 2])); for (let k2 = 0; k2 < 3; k2++) { const a = J[i + (k2 + 1) % 3], b = J[i + (k2 + 2) % 3], h = Math.min(a, b) + ',' + Math.max(a, b); (adj.get(h) || adj.set(h, []).get(h)).push(i / 3); } }
    // 棱线筛选：两面夹角超过 crease 的才算棱；面片边界、非流形边（拼起来的零散面片、小部件）只画长过 edgeMin 米的——不然满身碎线
    const cosT = Math.cos((E.crease || 32) * Math.PI / 180), eMin = E.edgeMin || 0, ST = STATS[key] || (STATS[key] = { crease: 0, bound: 0, short: 0 });
    for (let i = 0; i < J.length; i += 3) {
      let f = 0;
      for (let k2 = 0; k2 < 3; k2++) {   // 第 k2 条边 = 顶点 k2 的对边
        const a = J[i + (k2 + 1) % 3], b = J[i + (k2 + 2) % 3], L = adj.get(Math.min(a, b) + ',' + Math.max(a, b));
        if (E.lines) continue;   // 用整理好的轮廓线（featureLines），三角形本身不描边
        if (L.length === 2) { if (dot(N[L[0]], N[L[1]]) < cosT) { f |= 1 << k2; ST.crease++; } continue; }
        const len = Math.hypot(...[0, 1, 2].map(c => out.v[a * 3 + c] - out.v[b * 3 + c]));
        if (len >= eMin) { f |= 1 << k2; ST.bound++; } else ST.short++;
      }
      out.t.push(J[i], J[i + 1], J[i + 2]); out.e.push(f); out.s.push(Ss[i / 3]);
    }
  }
  // 编码：位置按包围盒量化成 16 位、索引 16 / 32 位、每个三角形一字节棱线标志 + 一字节明暗、线段索引
  const nv = out.v.length / 3, nt = out.t.length / 3, nl = out.l.length / 2, idx = nv > 65535 ? 4 : 2;
  const bb = [0, 1, 2].map(a => amin(out.v.filter((_, i) => i % 3 === a))).concat([0, 1, 2].map(a => amax(out.v.filter((_, i) => i % 3 === a))));
  const buf = Buffer.alloc(nv * 6 + (nt * 3 + nl * 2) * idx + nt * 2); let o = 0;
  for (let i = 0; i < nv * 3; i++) { const a = i % 3; buf.writeUInt16LE(Math.round((out.v[i] - bb[a]) / ((bb[a + 3] - bb[a]) || 1) * 65535), o); o += 2; }
  const wi = v => { if (idx === 4) buf.writeUInt32LE(v, o); else buf.writeUInt16LE(v, o); o += idx; };
  for (const v of out.t) wi(v);
  for (const f of out.e) buf.writeUInt8(f, o++);
  for (const s of out.s) buf.writeUInt8(Math.round((s + 1) * 127.5), o++);
  for (const v of out.l) wi(v);
  let xm = -Infinity, zc = 0; for (let i = 0; i < nv; i++) if (out.v[i * 3] > xm) { xm = out.v[i * 3]; zc = out.v[i * 3 + 2]; }   // 机头尖的高度（飞机：画面上对齐机身中线）
  const meta = { name: E.name, len: E.len, nv, nt, nl, idx, bb: bb.map(v => +v.toFixed(3)), zc: +zc.toFixed(3), ...extra, ...(E.vls ? { vls: E.vls } : {}), credit: { title: info.name, author: info.author, url: info.url, license: info.license } };
  const st = STATS[key] || {};
  console.log(`${key}：${info.name}（${info.author}，${info.license}）原 ${tris.length} 面 → ${nt} 面、${nl} 条轮廓线，${(buf.length / 1024).toFixed(0)} KB；棱 ${st.crease || 0}、边界 ${st.bound || 0}（略去短的 ${st.short || 0}）`);
  return `V3X.add('${key}', ${JSON.stringify(meta)}, '${buf.toString('base64')}');\n`;
  }
}
// 轮廓线：在原始精度的网格上找棱（两面夹角超过 O.crease 度）与面片边界，串成连续折线，短于 O.min 米的不要（碎面片、小部件），
//   再按 O.tol 米抽稀（Douglas-Peucker）——只留机翼、尾翼前后缘、进气道、座舱盖、机身棱线这类主要轮廓，不是满身碎线
function featureLines(V, IDX, O, out) {
  const P = i => [V[i * 3], V[i * 3 + 1], V[i * 3 + 2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const N = [], adj = new Map(), ek = (a, b) => a < b ? a + ',' + b : b + ',' + a;
  for (let i = 0; i < IDX.length; i += 3) {
    const n = cross(sub(P(IDX[i + 1]), P(IDX[i])), sub(P(IDX[i + 2]), P(IDX[i]))), l = Math.hypot(...n) || 1; N.push(n.map(v => v / l));
    for (let k = 0; k < 3; k++) { const a = IDX[i + k], b = IDX[i + (k + 1) % 3], h = ek(a, b); (adj.get(h) || adj.set(h, []).get(h)).push(i / 3); }
  }
  const cosT = Math.cos((O.crease || 40) * Math.PI / 180), G = new Map(), link = (a, b) => { (G.get(a) || G.set(a, []).get(a)).push(b); };
  for (const [h, L] of adj) {
    if (L.length === 2 && Math.abs(dot(N[L[0]], N[L[1]])) > cosT) continue;   // 平滑处（绝对值：个别面片朝向反了也算平滑）
    const [a, b] = h.split(',').map(Number); link(a, b); link(b, a);
  }
  const used = new Set(), chains = [], walk = (a, b) => { const C = [a, b]; used.add(ek(a, b)); let p = a, q = b; for (;;) { const nb = G.get(q); if (nb.length !== 2) break; const r = nb[0] === p ? nb[1] : nb[0]; if (used.has(ek(q, r))) break; used.add(ek(q, r)); C.push(r); p = q; q = r; } return C; };
  for (const [a, nb] of G) if (nb.length !== 2) for (const b of nb) if (!used.has(ek(a, b))) chains.push(walk(a, b));
  for (const [a, nb] of G) for (const b of nb) if (!used.has(ek(a, b))) chains.push(walk(a, b));   // 闭合的圈
  const dp = (C, tol) => {   // Douglas-Peucker
    if (C.length < 3) return C;
    const A = P(C[0]), B = P(C[C.length - 1]), d = sub(B, A), dl = Math.hypot(...d) || 1e-9;
    let mx = -1, mi = 0;
    for (let i = 1; i < C.length - 1; i++) { const v = sub(P(C[i]), A), c = cross(v, d), e = Math.hypot(...c) / dl; if (e > mx) { mx = e; mi = i; } }
    return mx <= tol ? [C[0], C[C.length - 1]] : dp(C.slice(0, mi + 1), tol).slice(0, -1).concat(dp(C.slice(mi), tol));
  };
  let kept = 0;
  for (const C of chains) {
    let len = 0; for (let i = 1; i < C.length; i++) len += Math.hypot(...sub(P(C[i]), P(C[i - 1])));
    if (len < (O.min || 1)) continue;
    const D = dp(C, O.tol || .03), base = out.v.length / 3;
    for (const i of D) pushAll(out.v, P(i));
    for (let i = 1; i < D.length; i++) out.l.push(base + i - 1, base + i);
    kept++;
  }
  console.log(`  轮廓线：${chains.length} 条折线，留下 ${kept} 条、${out.l.length / 2} 段`);
}
// 收起落架：起落架（机轮、支柱、舱门）一般是和机体不相连的小块，在机身下方、一直伸到地面——按连通块去掉；
//   A.cut：块的最高点低于全高的这个比例（默认 0.45），A.low：最低点低于全高的这个比例（默认 0.25，雷达罩这类低处的机体块不算）；
//   A.z：再去掉整个三角形都低于这个高度（米）的（和机体连在一起的支柱）
function gearless(tris, tf, A) {
  const cut = (A && A.cut) || .45, low = (A && A.low) || .25, zAbs = A && A.z, key = q => q.map(v => Math.round(v * 100)).join(','), id = new Map(), par = [];
  const f = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
  const vi = q => { const h = key(q); let i = id.get(h); if (i == null) { i = par.length; id.set(h, i); par.push(i); } return i; };
  const T = tris.map(t => { const P = [tf(t.p.slice(0, 3)), tf(t.p.slice(3, 6)), tf(t.p.slice(6, 9))], I = P.map(vi); par[f(I[1])] = f(I[0]); par[f(I[2])] = f(I[0]); return { P, I }; });
  const B = new Map(); let zmin = Infinity, zmax = -Infinity, xmin = Infinity, xmax = -Infinity;
  for (const { P, I } of T) { const r = f(I[0]); let b = B.get(r); if (!b) B.set(r, b = [Infinity, -Infinity, Infinity, -Infinity]); for (const q of P) { b[0] = Math.min(b[0], q[0]); b[1] = Math.max(b[1], q[0]); b[2] = Math.min(b[2], q[2]); b[3] = Math.max(b[3], q[2]); zmin = Math.min(zmin, q[2]); zmax = Math.max(zmax, q[2]); xmin = Math.min(xmin, q[0]); xmax = Math.max(xmax, q[0]); } }
  const H = zmax - zmin, L = xmax - xmin, gear = new Set();
  for (const [r, b] of B) if (b[3] < zmin + cut * H && b[2] < zmin + low * H && b[1] - b[0] < .35 * L) gear.add(r);
  return tris.filter((t, i) => !gear.has(f(T[i].I[0])) && !(zAbs != null && T[i].P.every(q => q[2] < zmin + zAbs)));
}

// 署名（CC-BY 要求的格式）；名字、作者是下载来的文字，去掉换行，免得写进 js/mdl/*.js 的注释时跑出注释变成代码
const one = v => String(v ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ');
const creditLine = I => `This work is based on "${one(I.name)}" (${one(I.url)}) by ${one(I.author)} (${one(I.profile)}) licensed under ${one(I.license)} (${one(I.licUrl)})`;
// 署名：docs/credits.md 里「Sketchfab 模型」一节整段重写
function writeCredits() {
  const f = path.join(ROOT, 'docs', 'credits.md');
  let s = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '# 素材来源与署名\n\n游戏里用到的第三方素材及其授权。\n';
  const all = Object.entries(LIST).map(([key, E]) => { const cf = path.join(CACHE, E.uid, 'info.json'); return fs.existsSync(cf) && fs.existsSync(path.join(OUT, key + '.js')) ? { key, E, info: JSON.parse(fs.readFileSync(cf, 'utf8')) } : null; }).filter(Boolean);
  const sec = '## Sketchfab 模型（3D 模型，tools/sfmodel.js 转换）\n\n都有改动（CC-BY 要求注明）：减面、统一朝向与尺寸、按游戏的黑绿画风重新绘制。游戏里在「设置 → 素材署名」（legal/credits.html）显示。\n\n' + all.map(({ key, E, info }) => `- ${E.name}（js/mdl/${key}.js）：${creditLine(info)}`).join('\n') + '\n';
  s = s.includes('## Sketchfab 模型') ? s.replace(/## Sketchfab 模型[\s\S]*?(?=\n## |$)/, sec) : s.trimEnd() + '\n\n' + sec;
  fs.writeFileSync(f, s);
  // 游戏里「设置 → 素材署名」那一页（legal/credits.html）：两行标记之间整段重写；下载来的文字一律转义，链接只认 http(s)
  const h = path.join(ROOT, 'legal', 'credits.html');
  if (!fs.existsSync(h)) return;
  const esc = v => one(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ln = (url, text) => /^https?:\/\/[^\s"'<>]+$/.test(String(url || '')) ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text);
  const li = all.map(({ E, info: I }) => `<li><strong>${esc(E.name)}</strong>：This work is based on "${ln(I.url, I.name)}" by ${ln(I.profile, I.author)} licensed under ${ln(I.licUrl, I.license)}</li>`).join('\n');
  const html = fs.readFileSync(h, 'utf8').replace(/(<!-- sketchfab:start -->\n)[\s\S]*?(?=<!-- sketchfab:end -->)/, `$1<ul>\n${li}\n</ul>\n`);
  fs.writeFileSync(h, html);
}

(async () => {
  const keys = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(LIST);
  for (const k of keys) {
    if (!LIST[k]) { console.warn('清单里没有', k); continue; }
    try { await convert(k, LIST[k]); } catch (e) { console.error(k, '失败：', e.message); process.exitCode = 1; }
  }
  writeCredits();
})();
