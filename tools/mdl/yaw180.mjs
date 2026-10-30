// 把已转换好的模型（assets/models/<id>.bin，DSM2 格式，v3props.js v3pParse）绕竖轴转 180°：机头朝向反了时用，不必重新下载、转换。
//   位置按包围盒量化（16 位）：x、y 取反 = 包围盒对调取反 + 量化值换成 65535 − q；法线 x、y 取反；UV、三角形绕向（转 180° 不翻面）、棱线标志都不变。
//   用法：node tools/mdl/yaw180.mjs u_f22（改完记得把 tools/mdl/sources.json 里这个模型的 yaw 也加 180，以后重新转换才对）
import fs from 'fs';
import path from 'path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
for (const id of process.argv.slice(2)) {
  const file = path.join(root, 'assets/models', id + '.bin'), b = fs.readFileSync(file), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.toString('latin1', 0, 4) !== 'DSM2') throw new Error(id + '：不是 DSM2');
  let o = 4;
  const nV = dv.getUint32(o, true), nM = dv.getUint32(o + 4, true), nT = dv.getUint32(o + 8, true); o += 12;
  const al = () => { o = (o + 3) & ~3; };
  o += nT; al(); o += nM * 24;
  let nv0 = 0;
  for (let i = 0; i < nV; i++) {
    const ln = b[o]; o += 1 + ln; al();
    for (const k of [0, 1]) { const mn = dv.getFloat32(o + k * 4, true), mx = dv.getFloat32(o + 12 + k * 4, true); dv.setFloat32(o + k * 4, -mx, true); dv.setFloat32(o + 12 + k * 4, -mn, true); }   // x、y 的包围盒对调取反
    o += 24;
    const nG = dv.getUint32(o, true); o += 4;
    for (let g = 0; g < nG; g++) {
      const nv = dv.getUint32(o + 4, true), ni = dv.getUint32(o + 8, true); o += 12;
      for (let v = 0; v < nv; v++) for (const k of [0, 1]) { const p = o + (v * 3 + k) * 2; dv.setUint16(p, 65535 - dv.getUint16(p, true), true); }
      o += nv * 6; al();
      for (let v = 0; v < nv; v++) for (const k of [0, 1]) { const p = o + v * 3 + k; dv.setInt8(p, Math.max(-127, Math.min(127, -dv.getInt8(p)))); }
      o += nv * 3; al();
      o += nv * 8; al(); o += ni * 2; al(); o += ni / 3; al();
      nv0 += nv;
    }
  }
  if (o !== b.byteLength) throw new Error(`${id}：解析到 ${o} 字节，文件 ${b.byteLength} 字节，格式和预想的不一样，没写回`);
  fs.writeFileSync(file, b);
  console.log(`${id}：转了 180°（${nV} 个变体、${nv0} 个顶点）`);
}
