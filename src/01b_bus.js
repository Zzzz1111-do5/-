/* =====================================================================
   Event bus. The simulation and the UI announce what happened; optional
   modules (missions, tutorial, sound, key moments) listen without the core
   knowing about them. A listener must never break the simulation, so errors
   are caught and logged. Events (payload):
     log {type, text, cell, major} · war {w, a, b} · peace {a, b} · capture {c, win, lose, wasCap, w}
     fall {n, cell} · tech {n, id, first} · era {n, era, first} · nuke {X, Y, c, big, retal}
     civilwar {n, rebels} · ideology {n, from, to} · victory {kind, title, text} · defeat {n}
     built {n, c, k} · produced {n, u, ue} · focus {n, f} · mode {mode, n} · order {o, from, to}
     decision {id, n, target} · milevent {t, a, b, i, ...} · banner {title, sub} · frame dt (seconds)
   ===================================================================== */
const BUS = {};
function busOn(type, fn) { (BUS[type] = BUS[type] || []).push(fn); }
function busEmit(type, d) {
  const L = BUS[type]; if (!L) return;
  if (type !== 'frame' && booting) return;
  for (const f of L) { try { f(d); } catch (e) { if (window.console) console.warn('bus listener for ' + type + ' failed', e); } }
}
