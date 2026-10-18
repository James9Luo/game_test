import fs from 'node:fs';
import '../tools/_ts_boot.mjs';
const P = await import('../assets/scripts/core/Paths.ts');
const { loadShapes } = await import('../assets/scripts/core/Shapes.ts');
const { buildLevel } = await import('../assets/scripts/core/LevelStore.ts');
const shapes = loadShapes(JSON.parse(fs.readFileSync('assets/config/shapes.json', 'utf8')));
const J = JSON.parse(fs.readFileSync('assets/resources/config/levels.json', 'utf8'));
const d = (J.levels || J).find(x => x.id === 50);
for (const seed of [0, 1, 50, 50001, 777]) {
  const rt = buildLevel(d, shapes, seed);
  const out = [];
  for (let m = 0; m < rt.movers.length; m++) {
    const mv = rt.movers[m];
    const tm = P.moverTiming(mv);
    const pose = P.poseAt(mv, tm.perfectMs);
    const c = mv.target || mv.C || null;
    const dx = c ? pose.x - c.cx : NaN, dy = c ? pose.y - c.cy : NaN;
    out.push('m' + m + ' pm=' + tm.perfectMs.toFixed(1) + ' pose=(' + pose.x.toFixed(2) + ',' + pose.y.toFixed(2) + ') 偏=' + (isNaN(dx) ? 'n/a' : Math.hypot(dx, dy).toFixed(3)));
  }
  console.log('seed=' + seed + ' → ' + out.join(' | '));
}
