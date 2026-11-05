// 把 src/ 里的脚本打包成 Roblox Studio 能直接打开的场景文件 MilitaryTycoon.rbxlx
//   node roblox/build.mjs
// 场景里只有脚本：地图、基地、建筑都是开始游戏时由 ServerScriptService.Main 生成的。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = f => fs.readFileSync(path.join(dir, 'src', f), 'utf8');
let n = 0;
const ref = () => 'RBX' + (++n).toString(16).toUpperCase().padStart(32, '0');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// 源码放在 CDATA 里（源码里万一有 "]]>" 要拆开）
const cdata = s => '<![CDATA[' + s.split(']]>').join(']]]]><![CDATA[>') + ']]>';
const item = (cls, name, props = '', kids = []) =>
  `<Item class="${cls}" referent="${ref()}">\n<Properties>\n<string name="Name">${esc(name)}</string>\n${props}</Properties>\n${kids.join('')}</Item>\n`;
const script = (cls, name, file, kids = []) => item(cls, name, `<ProtectedString name="Source">${cdata(read(file))}</ProtectedString>\n`, kids);

// 一个脚本 + 同目录下其它 .lua 当它的子模块（init.server.lua / init.client.lua 是脚本本身）
const withModules = (cls, name, dir, initFile) => {
  const kids = fs.readdirSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'src', dir)).filter(f => f.endsWith('.lua') && f !== initFile).sort()
    .map(f => script('ModuleScript', f.replace(/\.lua$/, ''), dir + '/' + f));
  return script(cls, name, dir + '/' + initFile, kids);
};

const xml = '<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">\n' +
  '<Meta name="ExplicitAutoJoints">true</Meta>\n<External>null</External>\n<External>nil</External>\n' +
  // 关掉流式加载：客户端要找到自己基地和战场的零件（布阵点选、射线、部队平滑显示）
  item('Workspace', 'Workspace', '<bool name="StreamingEnabled">false</bool>\n') +
  // UnitModels：导入的原模型可以放这里（放在 Workspace 里也认）
  item('ReplicatedStorage', 'ReplicatedStorage', '', [script('ModuleScript', 'Config', 'Config.lua'), item('Folder', 'UnitModels')]) +
  item('ServerScriptService', 'ServerScriptService', '', [withModules('Script', 'Main', 'Main', 'init.server.lua')]) +
  item('StarterPlayer', 'StarterPlayer', '', [item('StarterPlayerScripts', 'StarterPlayerScripts', '', [withModules('LocalScript', 'Client', 'Client', 'init.client.lua')])]) +
  '</roblox>\n';

const out = path.join(dir, 'MilitaryTycoon.rbxlx');
fs.writeFileSync(out, xml);
console.log('写好了 ' + path.relative(process.cwd(), out) + '（' + (xml.length / 1024).toFixed(0) + ' KB）');
