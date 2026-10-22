/**
 * tools/k_verify.mjs —— 自检：用同一套 core 复算真实关卡的 hitWindow，和 levels.json 里的派生值对比
 *   node tools/k_verify.mjs
 * 用途：确认 k_probe 的口径没有偏离「主策划 tool」，否则新形状的 k 不可信。
 */
import path from 'node:path';
import { ROOT, readJson, rel } from './_io.mjs';
import { core } from './_core.mjs';

const { buildLevel, hitWindow, inspectShapes } = core;
const shapesRaw = readJson(path.join(ROOT, 'assets/config/shapes.json'));
const shapes = inspectShapes(shapesRaw).shapes;
const lvRaw = readJson(path.join(ROOT, 'assets/resources/config/levels.json'));
const levels = Array.isArray(lvRaw) ? lvRaw : lvRaw.levels || [];

let worst = 0;
console.log('level|shape|cycle|turns|k_json|k_core|diff%');
for (const lv of levels.slice(0, 12)) {
    if (lv.variant !== 'single' || lv.jitter) continue;
    const rt = buildLevel(lv, shapes, 20261018);
    const w = hitWindow(rt);
    const kCore = (Math.abs(w.earlyMs) + Math.abs(w.lateMs)) / lv.cycleMs;
    const hj = lv.hitWindow || {};
    const kJson = (Math.abs(hj.earlyMs || 0) + Math.abs(hj.lateMs || 0)) / lv.cycleMs;
    const diff = kJson > 0 ? Math.abs(kCore - kJson) / kJson * 100 : 0;
    worst = Math.max(worst, diff);
    console.log(`${lv.id}|${lv.shapeId}|${lv.cycleMs}|${lv.turns}|${kJson.toFixed(4)}|${kCore.toFixed(4)}|${diff.toFixed(1)}`);
}
console.log(`SUMMARY|worstDiff%=${worst.toFixed(1)}`);
