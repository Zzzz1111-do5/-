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

const xml = '<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">\n' +
  '<Meta name="ExplicitAutoJoints">true</Meta>\n<External>null</External>\n<External>nil</External>\n' +
  // 关掉流式加载：客户端要找到自己基地和战场的零件（布阵点选、射线）
  item('Workspace', 'Workspace', '<bool name="StreamingEnabled">false</bool>\n') +
  item('ReplicatedStorage', 'ReplicatedStorage', '', [script('ModuleScript', 'Config', 'Config.lua')]) +
  item('ServerScriptService', 'ServerScriptService', '', [
    script('Script', 'Main', 'Main/init.server.lua', [script('ModuleScript', 'Models', 'Main/Models.lua'), script('ModuleScript', 'Battle', 'Main/Battle.lua')]),
  ]) +
  item('StarterPlayer', 'StarterPlayer', '', [item('StarterPlayerScripts', 'StarterPlayerScripts', '', [script('LocalScript', 'Client', 'Client.client.lua')])]) +
  '</roblox>\n';

const out = path.join(dir, 'MilitaryTycoon.rbxlx');
fs.writeFileSync(out, xml);
console.log('写好了 ' + path.relative(process.cwd(), out) + '（' + (xml.length / 1024).toFixed(0) + ' KB）');
