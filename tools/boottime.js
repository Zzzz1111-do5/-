const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.goto('file://' + require('path').resolve(process.argv[2])); await p.waitForTimeout(500);
  const r = await p.evaluate(() => { const E = window.__earth; const t0 = performance.now(); E.newWorld(22); const t1 = performance.now(); for (let k = 0; k < 500; k++) E.tick(1); const t2 = performance.now(); return { bootMs: Math.round(t1 - t0), tick500Ms: Math.round(t2 - t1) }; });
  console.log(JSON.stringify(r)); await b.close();
})();
