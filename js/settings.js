'use strict';
// 设置：音量、显示、流程、AI 指挥官聊天。存 localStorage 'bh-settings'（兼容旧的 'bh-rain'）；无 DOM，可在 Node 中运行
const SETTINGS_DEF = { master: .8, music: .45, sfx: .8, radio: .6, rain: .25, bloom: .7, quality: 'high', intro: true, chat: 'normal', enemyChat: true, shake: true };
const SETTINGS = { ...SETTINGS_DEF };
const SET_FNS = [];
const SET_KEY = 'bh-settings';
const setStore = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } };

// 只接受与默认值同类型的字段，数值夹在合理范围内
function setClean(k, v) {
  const d = SETTINGS_DEF[k];
  if (d === undefined) return undefined;
  if (typeof d === 'number') { v = +v; return isFinite(v) ? Math.min(k === 'bloom' ? 1.5 : 1, Math.max(0, v)) : undefined; }
  if (typeof d === 'boolean') return typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : undefined;
  if (k === 'quality') return v === 'low' || v === 'high' ? v : undefined;
  if (k === 'chat') return v === 'brief' || v === 'normal' || v === 'verbose' ? v : undefined;
  return undefined;
}

function loadSettings() {
  const st = setStore();
  if (!st) return SETTINGS;
  try {
    const raw = st.getItem(SET_KEY), o = raw ? JSON.parse(raw) : null;
    if (o && typeof o === 'object') for (const k in SETTINGS_DEF) { const v = setClean(k, o[k]); if (v !== undefined) SETTINGS[k] = v; }
    else { const r = st.getItem('bh-rain'); if (r != null && setClean('rain', r) !== undefined) SETTINGS.rain = setClean('rain', r); }
  } catch (e) { /* 存储损坏时用默认值 */ }
  return SETTINGS;
}

function saveSettings() {
  const st = setStore();
  if (!st) return;
  try { st.setItem(SET_KEY, JSON.stringify(SETTINGS)); st.setItem('bh-rain', SETTINGS.rain); } catch (e) { /* 存储不可用时忽略 */ }
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

loadSettings();
