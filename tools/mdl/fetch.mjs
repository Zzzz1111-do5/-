// 下载 sources.json 里条目的源模型到 src/（tbuild.mjs 的输入）：先查授权（只收 CC0 / CC-BY），再用 Sketchfab 下载接口取 glb
//   （没有 glb 就取 glTF 压缩包，解开后用 gltf-transform 合成 glb）；src/ 不进仓库，已经下过的跳过
// 用法：cd tools/mdl && SKETCHFAB_TOKEN=你的密钥 node fetch.mjs <id> …（密钥只从环境变量读，不写进任何文件、不打印）
import fs from 'fs';
import path from 'path';
import https from 'https';
import os from 'os';
import { execFileSync } from 'child_process';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const here = path.dirname(new URL(import.meta.url).pathname), SRC = JSON.parse(fs.readFileSync(path.join(here, 'sources.json'), 'utf8'));
const TOKEN = process.env.SKETCHFAB_TOKEN || '', OK_LIC = new Set(['by', 'cc0']);
function get(url, headers = {}, n = 0) {
  return new Promise((res, rej) => {
    https.get(url, { headers }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && n < 5) { r.resume(); res(get(new URL(r.headers.location, url).href, {}, n + 1)); return; }
      if (r.statusCode !== 200) { r.resume(); rej(new Error(`HTTP ${r.statusCode} ${url.split('?')[0]}`)); return; }
      const ch = []; r.on('data', d => ch.push(d)); r.on('end', () => res(Buffer.concat(ch)));
    }).on('error', rej);
  });
}
const uidOf = url => String(url || '').replace(/\/+$/, '').split('/').pop().split('-').pop();   // 老的 32 位十六进制、新的短编号都在网址最后一段的最后
for (const id of process.argv.slice(2)) {
  const C = SRC[id];
  if (!C || !C.file || !C.url) { console.error(id, '：sources.json 里没有这条，或缺 file / url'); continue; }
  const out = path.join(here, 'src', C.file);
  if (fs.existsSync(out)) { console.log(id, '：已经有了', C.file); continue; }
  try {
    const uid = uidOf(C.url), I = JSON.parse(await get(`https://api.sketchfab.com/v3/models/${uid}`)), lic = I.license && I.license.slug;
    if (!OK_LIC.has(lic)) throw new Error(`授权是 ${I.license && I.license.label}，不是 CC0 / CC-BY，不能用`);
    if (!TOKEN) throw new Error('需要环境变量 SKETCHFAB_TOKEN 才能下载');
    const D = JSON.parse(await get(`https://api.sketchfab.com/v3/models/${uid}/download`, { Authorization: 'Token ' + TOKEN }));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (D.glb && D.glb.url) fs.writeFileSync(out, await get(D.glb.url));
    else if (D.gltf && D.gltf.url) {   // 压缩包：解到临时目录（下载来的文件只当数据读），合成一个 glb
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-'));
      fs.writeFileSync(path.join(tmp, 'm.zip'), await get(D.gltf.url));
      execFileSync('unzip', ['-o', '-q', path.join(tmp, 'm.zip'), '-d', path.join(tmp, 'g')]);
      const io = new NodeIO().registerExtensions(ALL_EXTENSIONS), f = fs.readdirSync(path.join(tmp, 'g')).find(n => /\.gltf$/i.test(n));
      if (!f) throw new Error('压缩包里没有 .gltf');
      await io.write(out, await io.read(path.join(tmp, 'g', f)));
      fs.rmSync(tmp, { recursive: true, force: true });
    } else throw new Error('这个模型没有 glb / glTF 下载');
    console.log(`${id}：${I.name}（${I.user && I.user.displayName}，${I.license.label}）→ src/${C.file}，${(fs.statSync(out).size / 1048576).toFixed(1)} MB`);
  } catch (e) { console.error(id, '：', e.message); }
}
