/**
 * tools/resolve_cycles.mjs —— 「换形但难度不变」：反解每关周期，让命中窗口逐关保持原值
 *
 *   node tools/resolve_cycles.mjs --out=temp/cycle_patch.json
 *
 * 输入：
 *   - 旧形状：02_美术源文件/rollback_20261021/shapes.json（换形前的真源快照）
 *   - 新形状：02_美术源文件/shapes_src/v10_backup_shapes.json（后缀 _v10）
 *   - 关卡：assets/resources/config/levels.json（当前生效）
 * 输出：每关 {id, cycleOld, cycleNew, winOld, winNew, delta}，只对 |Δ|>阈值 的关做反解。
 *
 * 为什么可以这么解：窗口(ms) ≈ k(形状) × cycle，k 在同一关的 turns/path 下基本与 cycle 无关；
 * 所以把 cycle 按 win_old/win_new 缩放，窗口就能回到原值 —— 难度（毫秒容错）不变，只换转速。
 */
import path from 'node:path';
import fs from 'node:fs';
import { ROOT, readJson, rel } from './_io.mjs';
import { core } from './_core.mjs';

const { buildLevel, hitWindow, inspectShapes } = core;
const arg = (n, d) => {
    const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
    return hit ? hit.split('=')[1] : d;
};
const OUT = arg('out', 'temp/cycle_patch.json');
const TOL = Number(arg('tol', 10)); // |Δ| ≤ 10ms 不动（S22c 的换形口径）

const MAP = {
    cup_tumbler: 'cup_tumbler_v10', car_hatch: 'car_hatch_v10', can_cola: 'can_cola_v10',
    slipper: 'slipper_v10', guitar: 'guitar_v10', wrench: 'wrench_v10',
    rocket: 'rocket_v10', toilet: 'toilet_v10', cat: 'cat_v10', tv: 'tv_v10',
    burger: 'burger_v10', duck: 'duck_v10',
};

const oldRaw = readJson(path.join(ROOT, '02_美术源文件/rollback_20261021/shapes.json'));
const newRaw = readJson(path.join(ROOT, '02_美术源文件/shapes_src/v10_backup_shapes.json'));
const oldShapes = inspectShapes(oldRaw).shapes;
const merged = inspectShapes({ shapes: [...oldRaw.shapes, ...newRaw.shapes] }).shapes;
const lvRaw = readJson(path.join(ROOT, 'assets/resources/config/levels.json'));
const levels = Array.isArray(lvRaw) ? lvRaw : lvRaw.levels || [];

const winOf = (lv, shapes, cycle) => {
    const def = cycle ? { ...lv, cycleMs: cycle, cycle2Ms: lv.cycle2Ms ? lv.cycle2Ms : 0 } : lv;
    const rt = buildLevel(def, shapes, 20261018);
    const w = hitWindow(rt);
    return Math.abs(w.earlyMs) + Math.abs(w.lateMs);
};

/** 把该关涉及的形状换成新几何（用于「新形状」构建） */
const withNew = (lv) => {
    const d = { ...lv };
    if (MAP[d.shapeId]) {
        d.shapeId = MAP[d.shapeId];
        d.outlineId = MAP[d.outlineId] || d.outlineId;
    }
    if (MAP[d.shapeId2]) d.shapeId2 = MAP[d.shapeId2];
    return d;
};

const rows = [];
for (const lv of levels) {
    if (!MAP[lv.shapeId] && !MAP[lv.shapeId2]) continue;
    const oldWin = winOf(lv, oldShapes, 0);
    const newWin0 = winOf(withNew(lv), merged, 0);
    const delta = newWin0 - oldWin;
    let cycleNew = lv.cycleMs;
    if (Math.abs(delta) > TOL) {
        // 窗口 ∝ cycle（近似线性），先用比例猜一步，再二分校准
        let lo = lv.cycleMs * 0.55;
        let hi = lv.cycleMs * 1.75;
        for (let i = 0; i < 26; i++) {
            const mid = (lo + hi) / 2;
            const w = winOf(withNew(lv), merged, mid);
            if (w > oldWin) hi = mid;
            else lo = mid;
        }
        cycleNew = Math.round((lo + hi) / 2);
        if (lv.cycle2Ms) cycleNew = cycleNew;
    }
    const newWin = winOf(withNew(lv), merged, cycleNew);
    rows.push({
        id: lv.id, cycleOld: lv.cycleMs, cycleNew, winOld: +oldWin.toFixed(1), winNew: +newWin.toFixed(1),
        delta: +(newWin - oldWin).toFixed(1), pacePct: +(((cycleNew - lv.cycleMs) / lv.cycleMs) * 100).toFixed(1),
    });
}

console.log('level|cycle_old|cycle_new|pace%|win_old|win_new|Δms');
for (const r of rows) {
    const flag = Math.abs(r.delta) > 2 ? ' ⚠' : '';
    console.log(`${r.id}|${r.cycleOld}|${r.cycleNew}|${r.pacePct}|${r.winOld}|${r.winNew}|${r.delta}${flag}`);
}
const changed = rows.filter((r) => r.cycleNew !== r.cycleOld);
console.log(`SUMMARY|levels=${rows.length}|cycleChanged=${changed.length}|maxPace=${Math.max(...changed.map((r) => Math.abs(r.pacePct)), 0)}%|maxDelta=${Math.max(...rows.map((r) => Math.abs(r.delta)))}ms`);
const dst = path.resolve(ROOT, OUT);
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, JSON.stringify(rows, null, 1), 'utf-8');
console.log('SAVED|' + rel(dst));
