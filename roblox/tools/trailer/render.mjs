// 宣传片第二步：开一个本地网页服务，用 Playwright 打开 render.html 一帧一帧截图，再配乐、合成 MP4
//   NODE_PATH=$(npm root -g) node roblox/tools/trailer/render.mjs <录像目录> <输出目录> [帧范围 起-止] [步骤 frames,audio,video]
//   录像目录是 record.lua 写的 scene.json / battle.json；输出 frames/00000.jpg…、cues.json、music.wav、trailer_1080p.mp4
import http from 'http';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, '..', '..', '..');
const rec = path.resolve(process.argv[2] || '/tmp/trailer_rec');
const out = path.resolve(process.argv[3] || path.join(rec, 'out'));
const range = (process.argv[4] || '').split('-').map(Number);
const steps = (process.argv[5] || 'frames,audio,video').split(',');
const FPS = 30;
fs.mkdirSync(path.join(out, 'frames'), { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const file = u.startsWith('/rec/') ? path.join(rec, u.slice(5)) : path.join(repo, u);
  if (!file.startsWith(repo) && !file.startsWith(rec)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

if (steps.includes('frames')) {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('页面出错：', e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('页面：', m.text()); });
  await page.goto(`http://127.0.0.1:${port}/roblox/tools/trailer/render.html`);
  const info = await page.evaluate(() => TR.init({ rec: '/rec', models: '/roblox/models' }));
  console.log('载入：', JSON.stringify(info));
  const shots = await page.evaluate(() => TR.buildTimeline());
  console.log('镜头 ' + shots.length + ' 个：' + shots.map(s => s.at + 's' + (s.card ? '「' + s.card + '」' : '')).join(' '));
  await page.evaluate(() => document.fonts.ready);
  const total = await page.evaluate(() => Math.round(TR.LEN * 30));
  const from = Number.isFinite(range[0]) ? range[0] : 0, to = Number.isFinite(range[1]) ? range[1] : total;
  const list = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;
  const t0 = Date.now();
  let n = 0;
  for (let i = from; i < to; i++) {
    if (list && !list.includes(i)) continue;
    await page.evaluate(i => TR.frame(i), i);
    await page.screenshot({ path: path.join(out, 'frames', String(i).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: 92 });
    n++;
    if (n % 30 === 0 || n < 3) { const el = (Date.now() - t0) / 1000; console.log(`帧 ${i}（${n} 帧，每帧 ${(el / n).toFixed(2)} 秒）`); }
  }
  await browser.close();
}
// 音效点：不画画面、从头到尾快速走一遍分镜（分段渲染时每段各算各的会在段首多出「换镜头」）
if (steps.includes('cues') || steps.includes('audio')) {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on('pageerror', e => console.error('页面出错：', e.message));
  await page.goto(`http://127.0.0.1:${port}/roblox/tools/trailer/render.html`);
  await page.evaluate(() => TR.init({ rec: '/rec', models: '/roblox/models', noModels: true }));
  const cues = await page.evaluate(async () => { TR.buildTimeline(); TR.cues.length = 0; const n = Math.round(TR.LEN * 30); for (let i = 0; i < n; i++) await TR.frame(i, true); return TR.cues; });
  fs.writeFileSync(path.join(out, 'cues.json'), JSON.stringify(cues));
  console.log('音效点 ' + cues.length + ' 个');
  await browser.close();
}
server.close();
if (steps.includes('audio')) {
  execFileSync('node', [path.join(here, 'audio.mjs'), path.join(out, 'cues.json'), path.join(out, 'music.wav')], { stdio: 'inherit' });
}
if (steps.includes('video')) {
  // 1080p 码率封顶 6 Mbit/s（64 秒约 45 MB，好传）；再出一份 720p 给手机看
  const enc = (vf, rate, name) => {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(out, 'frames', '%05d.jpg'), '-i', path.join(out, 'music.wav'), ...(vf ? ['-vf', vf] : []),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-maxrate', rate + 'M', '-bufsize', (rate * 2) + 'M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', path.join(out, name)], { stdio: 'inherit' });
    console.log('写好 ' + path.join(out, name) + '（' + (fs.statSync(path.join(out, name)).size / 1e6).toFixed(1) + ' MB）');
  };
  enc(null, 6, 'trailer_1080p.mp4');
  enc('scale=1280:720:flags=lanczos', 3, 'trailer_720p.mp4');
}
