/**
 * tune.mjs —— 主策划专用：按「命中窗口目标」反解 cycle_ms
 *
 * 原理：pct(t) 是 Δt/cycleMs 的函数（位移与转角都按 1/cycleMs 缩放），
 *       所以窗口宽度与 cycleMs 严格成正比 → newCycle = cycle × target / measured，一步收敛。
 *
 * 用法：node _probe/tune.mjs [--dry]
 *   写回：01_策划文档/levels.csv 的 cycle_ms 列（速度列随后由 export_levels + fill_speeds 回填）
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadShapes } from '../assets/scripts/core/Shapes.ts';
import { buildLevel } from '../assets/scripts/core/LevelStore.ts';
import { hitWindow } from '../assets/scripts/core/Judge.ts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const CSV = path.join(ROOT, '01_策划文档', 'levels.csv');
const SHAPES = path.join(ROOT, 'assets', 'resources', 'config', 'shapes.json');
const DRY = process.argv.includes('--dry');

const shapes = loadShapes(JSON.parse(fs.readFileSync(SHAPES, 'utf8')));
const raw = fs.readFileSync(CSV, 'utf8').replace(/^\uFEFF/, '');
const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
const header = lines[0].split(',');
const rows = lines.slice(1).map((l) => {
    const cells = l.split(',');
    const o = {};
    header.forEach((h, i) => (o[h.trim()] = (cells[i] ?? '').trim()));
    return o;
});

const num = (s, d = 0) => (s === '' || s == null || isNaN(Number(s)) ? d : Number(s));

function toDef(o) {
    return {
        id: num(o.id),
        name: o.name,
        shapeId: o.object_id,
        outlineId: o.outline_id,
        variant: o.variant || 'single',
        motion: o.motion_type,
        path: o.path,
        cycleMs: num(o.cycle_ms),
        turns: num(o.turns),
        jitter: num(o.jitter),
        toleranceDeg: num(o.tolerance_deg),
        passRate: num(o.pass_rate),
        star3Rate: num(o.star3_rate),
        estSec: num(o.est_seconds),
        weight: num(o.weight),
        attempts: num(o.attempts, 3),
        note: o.note,
        speedStage: num(o.speed_stage, 1),
        shapeId2: o.object_id_2 || undefined,
        linSpeed: [num(o.lin_speed_min), num(o.lin_speed_max)],
        angSpeed: [num(o.ang_speed_min), num(o.ang_speed_max)],
    };
}

function measure(def) {
    const rt = buildLevel(def, shapes, 0);
    const hw = hitWindow(rt, 0.5, 24);
    const narrow = Math.min(Math.abs(hw.earlyMs), Math.abs(hw.lateMs));
    return { rt, hw, narrow };
}

console.log('关  形状          目标ms  调整前周期  测得ms   → 新周期  复测ms  偏差');
console.log('--  ------------  ------  ----------  ------  --------  ------  ----');
const out = [];
let hard = 0;
for (const o of rows) {
    const target = num(o.hit_target_ms, 100);
    let def = toDef(o);
    let m = measure(def);
    const before = def.cycleMs;
    let guard = 0;
    while (guard++ < 8 && Math.abs(m.narrow - target) > 1.5) {
        def.cycleMs = Math.max(600, Math.round((def.cycleMs * target) / m.narrow));
        m = measure(def);
    }
    const off = m.narrow - target;
    if (Math.abs(off) > 3) hard++;
    o.cycle_ms = String(def.cycleMs);
    out.push(o);
    console.log(
        String(def.id).padEnd(3) +
            ' ' + def.shapeId.padEnd(13) +
            ' ' + String(target).padStart(6) +
            ' ' + String(before).padStart(10) +
            ' ' + m.narrow.toFixed(1).padStart(6) +
            '  ' + String(def.cycleMs).padStart(8) +
            '  ' + m.narrow.toFixed(1).padStart(6) +
            '  ' + (off >= 0 ? '+' : '') + off.toFixed(1)
    );
}
console.log('\n超出 ±3ms 的关：' + hard + ' / ' + rows.length);

if (!DRY) {
    const text = [header.join(','), ...out.map((o) => header.map((h) => o[h.trim()] ?? '').join(','))].join('\n') + '\n';
    fs.writeFileSync(CSV, text, 'utf8');
    console.log('已写回 ' + path.relative(ROOT, CSV));
} else {
    console.log('--dry：未写回');
}
