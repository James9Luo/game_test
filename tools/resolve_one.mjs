/**
 * tools/resolve_one.mjs —— 单件换形后，把受影响关卡的周期反解回原窗口
 *   node tools/resolve_one.mjs --ids=cup_tumbler --out=temp/cycle_patch_cup.json
 * 读：assets/resources/config/levels.json（里面的 hitWindow 是**换形前**的窗口，作为目标）
 *     assets/config/shapes.json（已是换形后的形状）
 * 出：每关 {id, cycleOld, cycleNew, winOld, winNew}
 */
import path from 'node:path';
import fs from 'node:fs';
import { ROOT, readJson, rel } from './_io.mjs';
import { core } from './_core.mjs';

const { buildLevel, hitWindow, inspectShapes } = core;
const arg = (n, d) => {
    const h = process.argv.find((a) => a.startsWith(`--${n}=`));
    return h ? h.split('=')[1] : d;
};
const IDS = new Set((arg('ids', 'cup_tumbler')).split(','));
const OUT = arg('out', 'temp/cycle_patch_one.json');

const shapes = inspectShapes(readJson(path.join(ROOT, 'assets/config/shapes.json'))).shapes;
const lvRaw = readJson(path.join(ROOT, 'assets/resources/config/levels.json'));
const levels = Array.isArray(lvRaw) ? lvRaw : lvRaw.levels || [];

const winOf = (lv, cycle) => {
    const rt = buildLevel(cycle ? { ...lv, cycleMs: cycle } : lv, shapes, 20261018);
    const w = hitWindow(rt);
    return Math.abs(w.earlyMs) + Math.abs(w.lateMs);
};

const rows = [];
for (const lv of levels) {
    if (!IDS.has(lv.shapeId) && !IDS.has(lv.shapeId2)) continue;
    const hw = lv.hitWindow || {};
    const target = Math.abs(hw.earlyMs || 0) + Math.abs(hw.lateMs || 0);
    if (!(target > 0)) continue;
    let lo = lv.cycleMs * 0.55, hi = lv.cycleMs * 1.8;
    for (let i = 0; i < 28; i++) {
        const mid = (lo + hi) / 2;
        if (winOf(lv, mid) > target) hi = mid; else lo = mid;
    }
    const cyc = Math.round((lo + hi) / 2);
    const after = winOf(lv, cyc);
    rows.push({ id: lv.id, cycleOld: lv.cycleMs, cycleNew: cyc, winOld: +target.toFixed(1), winNew: +after.toFixed(1) });
    console.log(`L${lv.id} ${lv.shapeId}${lv.shapeId2 ? '+' + lv.shapeId2 : ''}  cycle ${lv.cycleMs}→${cyc}  win ${target.toFixed(1)}→${after.toFixed(1)}ms`);
}
const dst = path.resolve(ROOT, OUT);
fs.writeFileSync(dst, JSON.stringify(rows, null, 1), 'utf-8');
console.log('SAVED|' + rel(dst));
