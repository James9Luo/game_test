/**
 * tools/swap_impact.mjs —— 「换形」影响评估：同一关换成新形状后，命中窗口变多少毫秒
 *
 *   node tools/swap_impact.mjs --file=02_美术源文件/shapes_src/v10_backup_shapes.json
 *
 * 口径：对每一关，用**该关自己的 cycle/turns/path** 分别构建旧形状与新形状的运行时，
 * 取 core.hitWindow 的 |early|+late（总窗口 ms）做差。
 * 判据（S22c 的换形口径）：|Δwindow| ≤ 10ms 才算「只换内容不换难度」；超过就必须调周期反解或改形。
 */
import path from 'node:path';
import fs from 'node:fs';
import { ROOT, readJson, rel } from './_io.mjs';
import { core } from './_core.mjs';

const { buildLevel, hitWindow, inspectShapes } = core;
const argv = process.argv.slice(2);
const arg = (n, d) => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`));
    return hit ? hit.split('=')[1] : d;
};
const FILE = arg('file', '02_美术源文件/shapes_src/v10_backup_shapes.json');

const MAP = {
    cup_tumbler: 'cup_tumbler_v10', car_hatch: 'car_hatch_v10', can_cola: 'can_cola_v10',
    slipper: 'slipper_v10', guitar: 'guitar_v10', wrench: 'wrench_v10',
    rocket: 'rocket_v10', toilet: 'toilet_v10', cat: 'cat_v10', tv: 'tv_v10',
    burger: 'burger_v10', duck: 'duck_v10',
};

const oldRaw = readJson(path.join(ROOT, 'assets/config/shapes.json'));
const newRaw = readJson(path.resolve(ROOT, FILE));
const merged = { shapes: [...(oldRaw.shapes || oldRaw), ...(newRaw.shapes || newRaw)] };
const insp = inspectShapes(merged);
if (insp.errors.length) {
    console.error('FAIL|合并后形状校验失败', insp.errors.slice(0, 5));
    process.exit(1);
}
const shapes = insp.shapes;

const lvRaw = readJson(path.join(ROOT, 'assets/resources/config/levels.json'));
const levels = Array.isArray(lvRaw) ? lvRaw : lvRaw.levels || [];

const total = (w) => Math.abs(w.earlyMs) + Math.abs(w.lateMs);
console.log('level|variant|oldShape|newShape|cycleMs|winOld|winNew|deltaMs|verdict');
const rows = [];
for (const lv of levels) {
    const pairs = [[lv.shapeId, MAP[lv.shapeId]]];
    if (lv.shapeId2 && MAP[lv.shapeId2]) pairs.push([lv.shapeId2, MAP[lv.shapeId2]]);
    for (const [o, n] of pairs) {
        if (!n) continue;
        const rtOld = buildLevel(lv, shapes, 20261018);
        const rtNew = buildLevel({ ...lv, shapeId: n, outlineId: n, shapeId2: lv.shapeId2 === o ? n : lv.shapeId2 }, shapes, 20261018);
        const wo = total(hitWindow(rtOld));
        const wn = total(hitWindow(rtNew));
        const d = wn - wo;
        const ok = Math.abs(d) <= 10;
        rows.push({ id: lv.id, o, n, d });
        console.log(`${lv.id}|${lv.variant}|${o}|${n}|${lv.cycleMs}|${wo.toFixed(1)}|${wn.toFixed(1)}|${d.toFixed(1)}|${ok ? 'OK' : 'SHIFT'}`);
    }
}
const bad = rows.filter((r) => Math.abs(r.d) > 10);
console.log(`SUMMARY|levels=${new Set(rows.map((r) => r.id)).size}|shift>10ms=${bad.length}`);
if (bad.length) {
    const by = {};
    for (const r of bad) {
        by[r.o] = by[r.o] || { d: r.d, levels: [] };
        by[r.o].levels.push(r.id);
    }
    for (const [k, v] of Object.entries(by)) console.log(`SHAPE|${k}|Δ≈${v.d.toFixed(1)}ms|levels=${v.levels.join(',')}`);
}
