/**
 * tools/k_probe.mjs —— 给「还没进关卡表」的形状量 k（命中窗口 / 周期）
 *
 *   node tools/k_probe.mjs --file=02_美术源文件/shapes_src/v10_backup_shapes.json
 *   node tools/k_probe.mjs --file=... --turns=2 --cycle=2600 --pass=0.6
 *
 * 口径与主策划 tool 完全一致：合成一关（单物体 / h_line / 匀速自转 / 无 jitter），
 * 用 core.buildLevel + core.hitWindow 跑 seed=0 的实例，k = (|early| + late) / cycleMs。
 * 这样 v10 备份集的 k 不是「自算 × 校准系数」，而是同一台机器上的实测值。
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
const TURNS = Number(arg('turns', 2));
const CYCLE = Number(arg('cycle', 2600));
const PASS = Number(arg('pass', 0.6));
const SEED = Number(arg('seed', 20261018));

const p = path.resolve(ROOT, FILE);
if (!fs.existsSync(p)) {
    console.error(`FAIL|找不到 ${p}`);
    process.exit(1);
}
const raw = readJson(p);
const insp = inspectShapes(raw);
if (insp.errors.length) {
    console.error(`FAIL|形状校验不通过 ${insp.errors.length} 项：`);
    for (const e of insp.errors.slice(0, 10)) console.error('  ', e);
    process.exit(1);
}
const shapes = insp.shapes;
const list = Array.isArray(raw) ? raw : raw.shapes || [];

const out = {};
console.log('id|k|earlyMs|lateMs|windowMs|verdict');
let bad = 0;

// 用真实关卡做模板（字段一个不缺），只换 shapeId/outlineId/turns/cycleMs —— 比手搓一个 def 安全
const lvRaw = readJson(path.join(ROOT, 'assets/resources/config/levels.json'));
const levels = Array.isArray(lvRaw) ? lvRaw : lvRaw.levels || [];
const template = levels.find((l) => l.variant === 'single') || levels[0];
if (!template) {
    console.error('FAIL|levels.json 为空，无法取模板');
    process.exit(1);
}

for (const s of list) {
    const lv = {
        ...template,
        id: 9000 + Object.keys(out).length,
        name: 'k_probe',
        shapeId: s.id,
        outlineId: s.id,
        turns: TURNS,
        cycleMs: CYCLE,
        jitter: 0,
        toleranceDeg: 0,
        passRate: PASS,
        star3Rate: 0.93,
        speedStage: template.speedStage ?? 1,
        phase2: 0,
        cycle2Ms: 0,
        sineAmp: 0,
    };
    delete lv.hitWindow;
    delete lv.godWindow;
    delete lv.starWindow;
    delete lv.windowDriftPct;
    const rt = buildLevel(lv, shapes, SEED);
    const win = hitWindow(rt);
    const k = (Math.abs(win.earlyMs) + Math.abs(win.lateMs)) / CYCLE;
    const ok = k >= 0.02 && k <= 0.047;
    out[s.id] = { k: Number(k.toFixed(4)), earlyMs: Number(win.earlyMs.toFixed(1)), lateMs: Number(win.lateMs.toFixed(1)) };
    if (!ok) bad++;
    console.log(`${s.id}|${k.toFixed(4)}|${win.earlyMs.toFixed(1)}|${win.lateMs.toFixed(1)}|${(Math.abs(win.earlyMs) + Math.abs(win.lateMs)).toFixed(0)}|${ok ? 'OK' : 'OUT'}`);
}
const dst = path.join(path.dirname(p), '_k_v10.json');
fs.writeFileSync(dst, JSON.stringify(out, null, 1), 'utf-8');
console.log(`SUMMARY|shapes=${Object.keys(out).length}|outOfBand=${bad}|saved=${rel(dst)}`);
