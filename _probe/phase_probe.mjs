import fs from 'node:fs';
import '../tools/_ts_boot.mjs';
const { loadShapes } = await import('../assets/scripts/core/Shapes.ts');
const { buildLevel } = await import('../assets/scripts/core/LevelStore.ts');
const { hitWindow } = await import('../assets/scripts/core/Judge.ts');
const shapes = loadShapes(JSON.parse(fs.readFileSync('assets/config/shapes.json', 'utf8')));
const J = JSON.parse(fs.readFileSync('assets/resources/config/levels.json', 'utf8'));
const lv = (J.levels || J).find(x => x.id === 49);
for (const ph of [0, 0.25, 0.5, 0.75]) {
  const def = { ...lv, sinePhase: ph };
  const rt = buildLevel(def, shapes, 0);
  const hw = hitWindow(rt, 0.5, 24);
  console.log('φ=' + ph.toFixed(2), 'early=' + hw.earlyMs.toFixed(1), 'late=' + hw.lateMs.toFixed(1),
    'sum=' + (Math.abs(hw.earlyMs) + Math.abs(hw.lateMs)).toFixed(1),
    'perfectMs=' + rt.perfectMs.toFixed(1));
}
