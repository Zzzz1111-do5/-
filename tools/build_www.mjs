// 生成安卓包用的网页目录 www/：index.html 补成完整文档（字符集、手机视口、禁止缩放），复制 js/ 与 fonts/
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), out = path.join(root, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const body = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<meta name="claude:[^>]*>\n?/g, '');
const head = '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n<meta name="format-detection" content="telephone=no">\n';
// 版本号：每次发布不同，脚本地址后面加 ?v=版本号，浏览器不会拿缓存里的旧脚本和新页面混用；页面左下角显示版本号，方便确认是不是最新的
const sha = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch (e) { return ''; } })();
const ver = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace(/[-:T]/g, '').slice(2) + (sha ? '-' + sha : '');
// 自动更新：打开页面时不走缓存地读一下 version.json，发现服务器上有更新的版本就换个地址重新打开一次（拿到新页面和新脚本）
const tag = `<div id="buildTag" style="position:fixed;right:8px;top:2px;z-index:99999;font:10px monospace;color:#3dff8a;opacity:.55;pointer-events:none">版本 ${ver}</div>\n` +
  `<script>window.DS_BUILD = '${ver}';\n(function () { try { fetch('version.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {\n` +
  `  if (j && j.v && j.v !== window.DS_BUILD && sessionStorage.getItem('dsReload') !== j.v) { sessionStorage.setItem('dsReload', j.v); location.replace(location.pathname + '?v=' + j.v + location.hash); }\n` +
  `}).catch(function () {}); } catch (e) {} })();</script>\n`;
fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify({ v: ver }));
const page = body.replace(/(<script src="js\/[^"?]+\.js)"/g, `$1?v=${ver}"`);
fs.writeFileSync(path.join(out, 'index.html'), head + page.replace(/(<\/style>)/, '$1\n</head>\n<body>\n' + tag) + '\n</body>\n</html>\n');
for (const d of ['js', 'fonts']) fs.cpSync(path.join(root, d), path.join(out, d), { recursive: true, filter: s => !/\.fontcache/.test(s) });
console.log('www/ 已生成：', fs.readdirSync(path.join(out, 'js')).length, '个脚本');
