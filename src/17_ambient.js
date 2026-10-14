/* =====================================================================
   Ambient life and weather on the map (day/night, cloud shadows, rain,
   snow, birds…). nightAt() is the shared day/night contract: other
   renderers (city windows, torches) call it to know how dark a spot is.
   ===================================================================== */
let showDayNight = true;
// 0 = full day, 1 = deep night at map pixel (mx, my); stays 0 when the cycle is off
function nightAt(mx, my) { return 0; }
function ambientTick(dt) {}
function drawAmbient(z) {}
