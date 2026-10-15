#!/usr/bin/env node
// Screenshot + perf harness for 蓝星纪元.
// Usage: node tools/shoot.js <build.html> <out-prefix> '<json scenario list>'
// Each scenario: { name, seed=22, year=1900, view='map'|'globe'|'system'|'planet', planet='mars',
//   focus='city'|'battle'|'rail'|'coast'|'none', dom='land'|'sea'|'air' (which battle theatre to frame), z=4, gfx=3,
//   wait=2500, w=1440, h=900, night=false }
// Prints one JSON line per scenario: { name, file, perfMs, fps, agents, errors }.
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const [, , build, prefix, json] = process.argv;
if (!build || !prefix) { console.error('usage: node tools/shoot.js build.html out-prefix \'[{...}]\''); process.exit(1); }
const scenarios = JSON.parse(json || '[{"name":"city"}]');
(async () => {
  const browser = await chromium.launch();
  for (const sc of scenarios) {
    const o = Object.assign({ seed: 22, year: 1900, view: 'map', focus: 'city', z: 4, gfx: 3, wait: 2500, w: 1440, h: 900 }, sc);
    const page = await browser.newPage({ viewport: { width: o.w, height: o.h }, deviceScaleFactor: o.dpr || 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message + ' @ ' + (e.stack || '').split('\n')[1]));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) errors.push('console: ' + m.text()); });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await page.goto('file://' + path.resolve(build));
    await page.waitForTimeout(600);
    await page.evaluate((o) => {
      const E = window.__earth; document.getElementById('modeSel').hidden = true;
      E.setGfx(o.gfx, false);
      E.newWorld(o.seed); const S = E.S;
      let guard = 0; while (S.year < o.year && guard++ < 20000) E.tick(1);
      const city = S.cities.slice().sort((a, b) => b.pop - a.pop)[0];
      const mp = c => [(c.lon + Math.PI) / (2 * Math.PI) * 3072, (Math.PI / 2 - c.lat) / Math.PI * 1536];
      let target = city ? mp(city) : [1536, 768];
      if (o.focus === 'battle') {
        let best = null;
        for (const [a, b] of S.borders) { const A = S.nations[a], B = S.nations[b]; if (!A.alive || !B.alive) continue; for (const c of A.cl) for (const d of B.cl) { const dd = Math.hypot(c.lat - d.lat, c.lon - d.lon); if (dd > 0.04 && (!best || dd < best[0])) best = [dd, A, B, c, d]; } }
        if (best) { for (const w of S.wars.slice()) E.api.makePeace(w.a, w.b); const w = E.api.startWar(best[1].id, best[2].id, true, 'test'); if (w) w.dur = 400; const p1 = mp(best[3]), p2 = mp(best[4]); target = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]; window.__battle = true; }
      }
      if (o.focus === 'rail' && S.rails) { const k = Object.keys(S.rails)[0]; if (k) { const [ia, ib] = k.split(':').map(Number); const A = S.cities.find(c => c.id === ia), B = S.cities.find(c => c.id === ib); if (A && B) { const p1 = mp(A), p2 = mp(B); target = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]; } } }
      if (o.focus === 'coast') { const c = S.cities.filter(c => c.coastal).sort((a, b) => b.pop - a.pop)[0]; if (c) target = mp(c); }
      if (o.view === 'map') { E.cam.goal = null; E.cam.follow = null; E.cam.x = target[0]; E.cam.y = target[1]; E.cam.z = E.cam.tz = o.z; }
      else if (o.view === 'globe') E.switchView('globe');
      else if (o.view === 'system' || o.view === 'planet') { S.space.unlocked = true; E.setView('system'); if (o.view === 'planet') E.openPlanet(o.planet || 'mars'); }
    }, o);
    const steps = Math.ceil(o.wait / 500);
    for (let k = 0; k < steps; k++) {
      await page.waitForTimeout(500);
      if (o.focus === 'battle' && o.view === 'map') await page.evaluate(([z, dom]) => { const E = window.__earth, b = E.BATTLES.find(b => !dom || b.dom === dom) || E.BATTLES[0]; if (b) { E.cam.goal = null; E.cam.x = b.x; E.cam.y = b.y; E.cam.z = E.cam.tz = z; } }, [o.z, o.dom]);
    }
    const doms = await page.evaluate(() => window.__earth.BATTLES.map(b => b.dom).join(','));
    const stats = await page.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); function f() { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(f); else r({ fps: n / 1.5, perfMs: window.__earth.perfMs, agents: window.__earth.AG.length }); } requestAnimationFrame(f); }));
    const file = `${prefix}-${o.name}.png`;
    await page.screenshot({ path: file, clip: o.clip });
    console.log(JSON.stringify({ name: o.name, file, perfMs: +stats.perfMs.toFixed(2), fps: +stats.fps.toFixed(1), agents: stats.agents, battles: doms, errors }));
    await page.close();
  }
  await browser.close();
})();
