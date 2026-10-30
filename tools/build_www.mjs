// 生成发布用的网页目录：index.html 补成完整文档（字符集、手机视口、禁止缩放），复制 js/、fonts/、assets/（外部模型、地表与海面贴图）、legal/（用户协议、隐私政策）
// 用法：node tools/build_www.mjs [--app] [--out 目录]
//   默认生成网页版 www/（GitHub Pages）：右上角显示版本号，打开时检查服务器上有没有更新的版本
//   --app：商店版（安卓 Capacitor、电脑版 Electron）：版本号只在菜单页脚和设置里显示，不检查更新（游戏随安装包更新）
//   --out：输出目录（相对仓库根目录），电脑版用 desktop/app
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const app = process.argv.includes('--app'), out = path.resolve(root, arg('--out') || 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const body = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<meta name="claude:[^>]*>\n?/g, '');
const head = '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n<meta name="format-detection" content="telephone=no">\n';
// 版本号：每次发布不同，脚本地址后面加 ?v=版本号，浏览器不会拿缓存里的旧脚本和新页面混用
const sha = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch (e) { return ''; } })();
const stamp = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace(/[-:T]/g, '').slice(2) + (sha ? '-' + sha : '');
const ver = app ? `${JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version} (${stamp})` : stamp;
// 网页版自动更新：打开页面时不走缓存地读一下 version.json，发现服务器上有更新的版本就换个地址重新打开一次（拿到新页面和新脚本）；页面右上角显示版本号，方便确认是不是最新的
const tag = app ? `<script>window.DS_BUILD = '${ver}';</script>\n` :
  `<div id="buildTag" style="position:fixed;right:8px;top:2px;z-index:99999;font:10px monospace;color:#3dff8a;opacity:.55;pointer-events:none">版本 ${ver}</div>\n` +
  `<script>window.DS_BUILD = '${ver}';\n(function () { try { fetch('version.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {\n` +
  `  if (j && j.v && j.v !== window.DS_BUILD && sessionStorage.getItem('dsReload') !== j.v) { sessionStorage.setItem('dsReload', j.v); location.replace(location.pathname + '?v=' + j.v + location.hash); }\n` +
  `}).catch(function () {}); } catch (e) {} })();</script>\n`;
if (!app) fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify({ v: ver }));
const page = body.replace(/(<script src="js\/[^"?]+\.js)"/g, `$1?v=${encodeURIComponent(stamp)}"`);
fs.writeFileSync(path.join(out, 'index.html'), head + page.replace(/(<\/style>)/, '$1\n</head>\n<body>\n' + tag) + '\n</body>\n</html>\n');
// 商店版（收费）不带授权只允许非商用的模型（tools/v3gmodels.json 里 license 带 NC 的），游戏里换成同类的另一个（js/v3g.js V3G_ALT）
const ncOut = app ? Object.entries(JSON.parse(fs.readFileSync(path.join(root, 'tools', 'v3gmodels.json'), 'utf8')).models).filter(([, C]) => C.credit && /NC/.test(C.credit.license)).map(([k]) => path.join(root, 'js', 'mdl', k + '.js')) : [];
for (const d of ['js', 'fonts', 'assets', 'legal']) fs.cpSync(path.join(root, d), path.join(out, d), { recursive: true, filter: s => !/\.fontcache/.test(s) && !ncOut.includes(s) });
if (ncOut.length) console.log('商店版不带非商用授权的模型：', ncOut.map(f => path.basename(f)).join('、'));
console.log(`${path.relative(root, out)}/ 已生成（${app ? '商店版' : '网页版'} ${ver}）：`, fs.readdirSync(path.join(out, 'js')).length, '个脚本');
