import fs from 'node:fs';
import '../tools/_ts_boot.mjs';
const { loadShapes } = await import('../assets/scripts/core/Shapes.ts');
const { buildLevel } = await import('../assets/scripts/core/LevelStore.ts');
const { hitWindow } = await import('../assets/scripts/core/Judge.ts');
const shapes = loadShapes(JSON.parse(fs.readFileSync('assets/config/shapes.json', 'utf8')));
const J = JSON.parse(fs.readFileSync('assets/resources/config/levels.json', 'utf8'));
const lv = J.levels || J;
const mix = (d) => { const rt = buildLevel(d, shapes, 0); const h = hitWindow(rt, 0.5, 24);
  return { e: Math.abs(h.earlyMs), l: Math.abs(h.lateMs), s: Math.abs(h.earlyMs) + Math.abs(h.lateMs), skew: Math.abs(Math.abs(h.earlyMs) - Math.abs(h.lateMs)) }; };
for (const id of [49, 55, 22]) {
  const base = lv.find(x => x.id === id);
  const out = [];
  for (const ratio of [0.35, 0.5, 0.65]) {
    const d = { ...base, sinePeriodMs: Math.round(base.cycleMs * ratio) };
    const m = mix(d);
    out.push('r=' + ratio + ' 宽' + m.s.toFixed(0) + '(早' + m.e.toFixed(0) + '/晚' + m.l.toFixed(0) + ' 差' + m.skew.toFixed(0) + ')');
  }
  const ph = [0, 0.25, 0.5, 0.75].map(p => 'φ' + p + '=' + mix({ ...base, sinePhase: p }).s.toFixed(0));
  console.log('L' + id + ' amp=' + base.sineAmp + ' 圈' + base.turns + '\n  频率: ' + out.join(' | ') + '\n  相位: ' + ph.join(' '));
}
