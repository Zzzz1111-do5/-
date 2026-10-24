// 生成安卓包用的网页目录 www/：index.html 补成完整文档（字符集、手机视口、禁止缩放），复制 js/ 与 fonts/
import fs from 'fs';
import path from 'path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), out = path.join(root, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const body = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<meta name="claude:[^>]*>\n?/g, '');
const head = '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n<meta name="format-detection" content="telephone=no">\n';
fs.writeFileSync(path.join(out, 'index.html'), head + body.replace(/(<\/style>)/, '$1\n</head>\n<body>') + '\n</body>\n</html>\n');
for (const d of ['js', 'fonts']) fs.cpSync(path.join(root, d), path.join(out, d), { recursive: true, filter: s => !/\.fontcache/.test(s) });
console.log('www/ 已生成：', fs.readdirSync(path.join(out, 'js')).length, '个脚本');
