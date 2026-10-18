import fs from 'node:fs';
import '../tools/_ts_boot.mjs';
const { loadShapes } = await import('../assets/scripts/core/Shapes.ts');
const { buildLevel } = await import('../assets/scripts/core/LevelStore.ts');
const { hitWindow } = await import('../assets/scripts/core/Judge.ts');
const shapes = loadShapes(JSON.parse(fs.readFileSync('assets/config/shapes.json', 'utf8')));
const J = JSON.parse(fs.readFileSync('assets/resources/config/levels.json', 'utf8'));
const lv = J.levels || J;
for (const id of [1, 50]) {
  const d = lv.find(x => x.id === id);
  const rt = buildLevel(d, shapes, 0);
  const hw = hitWindow(rt, 0.5, 24);
  console.log('L' + id, 'variant=' + d.variant, '→ hitWindow =', JSON.stringify(hw).slice(0, 220));
}
