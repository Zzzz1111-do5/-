'use strict';
// 高级感（界面层）：写实画面下，对局界面、菜单的面板改成大作里常见的「毛玻璃」——面板背后的战场画面做模糊（backdrop-filter）、
//   底色更透一点、投影更柔更深、边上一道发丝细的高光；开新局时从黑场淡入（像过场镜头，不是一下子跳出画面）。
//   毛玻璃要每帧重算背后那一块的模糊，只在桌面（精确指针）且画质「高」时开；手机、低画质照旧是不透明的深色面板
const PL_CSS = `
:root[data-look="real"][data-glass] { --panel: rgba(13, 18, 23, .64); }
:root[data-look="real"][data-glass] .box,
:root[data-look="real"][data-glass] #feed li,
:root[data-look="real"][data-glass] #pauseBand,
:root[data-look="real"][data-glass] .uc {
  -webkit-backdrop-filter: blur(14px) saturate(140%); backdrop-filter: blur(14px) saturate(140%);
}
:root[data-look="real"] .box { box-shadow: 0 12px 34px rgba(0, 0, 0, .42), inset 0 1px 0 rgba(255, 255, 255, .07), inset 0 0 0 1px rgba(255, 255, 255, .025); }
:root[data-look="real"] #feed li { box-shadow: 0 6px 18px rgba(0, 0, 0, .3), inset 0 1px 0 rgba(255, 255, 255, .05); letter-spacing: .02em; }
:root[data-look="real"] #clock { text-shadow: 0 0 12px rgba(var(--g-rgb), .45); letter-spacing: .04em; }
:root[data-look="real"] .tb { transition: border-color .15s, box-shadow .2s, background-color .2s, color .15s, scale .08s; }
:root[data-look="real"] .tb:hover:not(:disabled) { box-shadow: 0 0 14px rgba(var(--g-rgb), .22), inset 0 1px 0 rgba(255, 255, 255, .08); }
#plFade { position: fixed; inset: 0; z-index: 60; background: #000; pointer-events: none; opacity: 1; transition: opacity 1.4s cubic-bezier(.4, 0, .2, 1); }
#plFade.go { opacity: 0; }
@media (prefers-reduced-motion: reduce) { #plFade { display: none; } }
`;
function plApply() {
  if (typeof document === 'undefined') return;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const on = !coarse && !(typeof SETTINGS === 'object' && SETTINGS && SETTINGS.quality === 'low');
  document.documentElement.toggleAttribute('data-glass', on);
}
// 开新局：黑场淡入（两帧后开始淡，1.4 秒淡完、拿掉）
function plFadeIn() {
  if (typeof document === 'undefined' || !document.body) return;
  let el = document.getElementById('plFade');
  if (el) el.remove();
  el = document.createElement('div'); el.id = 'plFade'; document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('go')));
  setTimeout(() => el.remove(), 1700);
}
if (typeof document !== 'undefined' && document.head) {
  const st = document.createElement('style'); st.id = 'plCss'; st.textContent = PL_CSS; document.head.appendChild(st);
  plApply();
  if (typeof onSettings === 'function') onSettings(k => { if (k === 'quality' || k === null) plApply(); });
  if (typeof HOOK === 'object' && HOOK.newGame) HOOK.newGame.push(() => { if (typeof MENU !== 'object' || MENU.game !== false) plFadeIn(); });
}
// 3D 自由镜头：附近的大爆炸让镜头一震（view3d.js v3FcCamera 调，返回 [偏航, 俯仰] 的小角度；设置里关了「屏幕震动」就不震）——
//   越近、越大、越新越震，几百米外就几乎感觉不到；两组不同频率的正弦叠起来，抖得不规则
function plShake3(x, y, z) {
  if (typeof S !== 'object' || !S || !S.fx || S.paused || (typeof SETTINGS === 'object' && SETTINGS && SETTINGS.shake === false)) return null;   // 暂停时不震（爆炸停在那一刻）
  let k = 0;
  for (const f of S.fx) {
    if ((f.kind !== 'boom' && f.kind !== 'b2') || !(f.life < .6)) continue;
    const P = (f.kind === 'b2' ? 2.2 : 1) * (f.r || 10), d = Math.hypot(f.x - x, f.y - y, (typeof v3Ht === 'function' ? v3Ht(clamp(f.x, 0, W - 1), clamp(f.y, 0, H - 1)) : 0) - z);
    k += P / 22 * Math.exp(-d / (P * 12)) * (1 - f.life / .6);
  }
  if (k < .02) return null;
  k = Math.min(k, 1.5);
  const t = performance.now() / 1000;
  return [(Math.sin(t * 47) + Math.sin(t * 31.7)) * .0035 * k, (Math.sin(t * 53.3) + Math.sin(t * 23.1)) * .0035 * k];
}
