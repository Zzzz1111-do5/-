'use strict';
// 设置：音量、显示、流程、AI 指挥官聊天。存 localStorage 'bh-settings'（兼容旧的 'bh-rain'）；无 DOM，可在 Node 中运行
const SETTINGS_DEF = { master: .8, music: .45, musicStyle: 'march', sfx: .8, radio: .6, rain: .25, bloom: .7, quality: 'high', look: 'green', intro: true, chat: 'normal', enemyChat: true, shake: true, front: true, rdist: 1 };
const SETTINGS = { ...SETTINGS_DEF };
const SET_FNS = [];
const SET_KEY = 'bh-settings';
const setStore = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } };

// 只接受与默认值同类型的字段，数值夹在合理范围内
function setClean(k, v) {
  const d = SETTINGS_DEF[k];
  if (d === undefined) return undefined;
  if (typeof d === 'number') { v = +v; return isFinite(v) ? Math.min(k === 'bloom' ? 1.5 : k === 'rdist' ? 4 : 1, Math.max(k === 'rdist' ? .5 : 0, v)) : undefined; }
  if (typeof d === 'boolean') return typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : undefined;
  if (k === 'quality') return v === 'low' || v === 'high' ? v : undefined;
  if (k === 'look') return v === 'green' || v === 'real' || v === 'matrix' ? v : undefined;
  if (k === 'chat') return v === 'brief' || v === 'normal' || v === 'verbose' ? v : undefined;
  if (k === 'musicStyle') return v === 'march' || v === 'ambient' || v === 'custom' ? v : undefined;
  return undefined;
}

function loadSettings() {
  const st = setStore();
  if (!st) return SETTINGS;
  try {
    const raw = st.getItem(SET_KEY), o = raw ? JSON.parse(raw) : null;
    if (o && typeof o === 'object') for (const k in SETTINGS_DEF) { const v = setClean(k, o[k]); if (v !== undefined) SETTINGS[k] = v; }
    if (o && o.lookV !== 2 && SETTINGS.look === 'real') SETTINGS.look = 'green';   // 旧版存下的「写实」是当时的默认值：改用新的默认黑绿画面（之后玩家自己选的照存）
    else { const r = st.getItem('bh-rain'); if (r != null && setClean('rain', r) !== undefined) SETTINGS.rain = setClean('rain', r); }
  } catch (e) { /* 存储损坏时用默认值 */ }
  return SETTINGS;
}

function saveSettings() {
  const st = setStore();
  if (!st) return;
  try { st.setItem(SET_KEY, JSON.stringify({ ...SETTINGS, lookV: 2 })); st.setItem('bh-rain', SETTINGS.rain); } catch (e) { /* 存储不可用时忽略 */ }
}

// fn(key, value, SETTINGS)；key 为 null 表示整体重置
function onSettings(fn) { if (typeof fn === 'function') SET_FNS.push(fn); }
function setNotify(k, v) { for (const f of SET_FNS) { try { f(k, v, SETTINGS); } catch (e) { if (typeof console !== 'undefined') console.error('settings listener', e); } } }

function setSetting(k, v) {
  const c = setClean(k, v);
  if (c === undefined || SETTINGS[k] === c) return SETTINGS[k];
  SETTINGS[k] = c;
  saveSettings();
  setNotify(k, c);
  return c;
}

function resetSettings() {
  Object.assign(SETTINGS, SETTINGS_DEF);
  saveSettings();
  setNotify(null, null);
}

// 引擎里已有的开关：数码雨强度（R 在 render.js，只在浏览器里存在）
onSettings((k) => { if ((k === 'rain' || k === null) && typeof R === 'object' && R) R.rain = SETTINGS.rain; });
// 画面风格：改 COL 与页面配色（在其他模块读取 COL 之前先套用一次）
onSettings((k) => { if ((k === 'look' || k === null) && typeof applyLook === 'function') applyLook(SETTINGS.look); });

loadSettings();
if (typeof applyLook === 'function') applyLook(SETTINGS.look);
