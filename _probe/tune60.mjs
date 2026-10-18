/**
 * tune60.mjs —— v0.4 的 60 关周期反解（按 hit_target_ms 目标窗口）
 *
 * 与 v0.3 的 tune.mjs 的区别：
 *  1. 支持 60 行 + season / sine / inertia / dual
 *  2. 带正弦/惯性时窗口**不再与 cycle 严格成正比**（sine_period_ms 是绝对时间），
 *     所以用带阻尼的比例迭代（每次只走误差的 70%），最多 12 轮
 *  3. 季 1（sine=0 & inertia=0）走严格比例 + 一步收敛，保证不破坏 v0.3 校准
 *
 * 用法：node _probe/tune60.mjs [--dry]
 */
import fs from 'node:fs';
import '../tools/_ts_boot.mjs';
const { loadShapes } = await import('../assets/scripts/core/Shapes.ts');
const { buildLevel } = await import('../assets/scripts/core/LevelStore.ts');
const { hitWindow } = await import('../assets/scripts/core/Judge.ts');

const CSV = '01_策划文档/levels.csv';
const DRY = process.argv.includes('--dry');
const shapes = loadShapes(JSON.parse(fs.readFileSync('assets/config/shapes.json', 'utf8')));

const raw = fs.readFileSync(CSV, 'utf8').replace(/^\uFEFF/, '');
const lines = raw.split(/\r?\n/).filter((l) => l.trim());
const header = lines[0].split(',');
const rows = lines.slice(1).map((l) => {
    const c = l.split(',');
    const o = {};
    header.forEach((h, i) => (o[h.trim()] = (c[i] ?? '').trim()));
    return o;
});

const num = (s, d = 0) => (s === '' || s == null || isNaN(Number(s)) ? d : Number(s));

function toDef(o) {
    return {
        id: num(o.id), name: o.name, shapeId: o.object_id, outlineId: o.outline_id,
        variant: o.variant || 'single', motion: o.motion_type, path: o.path,
        cycleMs: num(o.cycle_ms), turns: num(o.turns), jitter: num(o.jitter),
        toleranceDeg: num(o.tolerance_deg), passRate: num(o.pass_rate), star3Rate: num(o.star3_rate),
        estSec: num(o.est_seconds), weight: num(o.weight), attempts: num(o.attempts, 3),
        note: o.note, speedStage: num(o.speed_stage, 1), shapeId2: o.object_id_2 || undefined,
        linSpeed: [num(o.lin_speed_min), num(o.lin_speed_max)],
        angSpeed: [num(o.ang_speed_min), num(o.ang_speed_max)],
        season: num(o.season, 1),
        sineAmp: num(o.sine_amp), sinePeriodMs: num(o.sine_period_ms, 960),
        inertiaPx: num(o.inertia_px), inertiaHz: num(o.inertia_hz, 1.0), inertiaPhase: num(o.inertia_phase),
        hitTargetMs: num(o.hit_target_ms, 100),
    };
}

function measure(def) {
    const rt = buildLevel(def, shapes, 0);
    const hw = hitWindow(rt, 0.5, 24);
    const narrow = Math.min(Math.abs(hw.earlyMs), Math.abs(hw.lateMs));
    return { rt, hw, narrow };
}

console.log('季 关   形状            目标ms  原周期  测得   → 新周期  复测  偏差');
console.log('-- ---  ----------------  ------  ------  ----   -------  ----  ----');
let hard = 0;
const out = [];
for (const o of rows) {
    const def = toDef(o);
    const target = def.hitTargetMs;
    const modulated = def.sineAmp > 0 || def.inertiaPx > 0;
    let before = def.cycleMs;
    let m = measure(def);
    let guard = 0;
    if (!modulated) {
        // 季 1：严格线性，一步收敛（保证与 v0.3 一致）
        if (Math.abs(m.narrow - target) > 1.5) {
            def.cycleMs = Math.max(600, Math.round((def.cycleMs * target) / m.narrow));
            m = measure(def);
        }
    } else {
        /* 正弦**相位锁到周期**：sine_period_ms = ratio × cycle_ms（ratio 取自草稿）。
           否则 sine 周期是绝对时间 → 窗口不随周期缩放 → tuner 会把周期推到几千 ms。
           带调制时窗口对 cycle 仍非严格线性，用有界二分 + 两轮相位重锁。 */
        const ratio = Math.max(0.25, Math.min(0.85, def.sinePeriodMs / def.cycleMs));
        for (let pass = 0; pass < 3; pass++) {
            let lo = 900;
            let hi = 3600;
            let best = def.cycleMs;
            let bestDiff = Math.abs(m.narrow - target);
            for (let it = 0; it < 22; it++) {
                const mid = Math.round((lo + hi) / 2);
                def.cycleMs = mid;
                def.sinePeriodMs = Math.round(mid * ratio);
                const mm = measure(def);
                const diff = Math.abs(mm.narrow - target);
                if (diff < bestDiff) { bestDiff = diff; best = mid; }
                if (mm.narrow > target) lo = mid + 1; else hi = mid - 1;
                if (lo > hi) break;
            }
            def.cycleMs = best;
            def.sinePeriodMs = Math.round(best * ratio);
            m = measure(def);
            if (Math.abs(m.narrow - target) <= 2) break;
        }
        o.sine_period_ms = String(def.sinePeriodMs);
    }
    const off = m.narrow - target;
    if (Math.abs(off) > 4) hard++;
    o.cycle_ms = String(def.cycleMs);
    out.push(o);
    console.log(
        String(def.season).padEnd(2) + ' ' + String(def.id).padStart(3) + '  ' +
        String(def.shapeId).padEnd(16) + '  ' + String(target).padStart(6) + '  ' +
        String(before).padStart(6) + '  ' + m.narrow.toFixed(0).padStart(4) + '   ' +
        String(def.cycleMs).padStart(7) + '  ' + m.narrow.toFixed(1).padStart(4) + '  ' +
        (off >= 0 ? '+' : '') + off.toFixed(1)
    );
}
console.log('\n偏差 >4ms 的关：' + hard + ' / ' + rows.length);
if (!DRY) {
    fs.writeFileSync(CSV, [header.join(','), ...out.map((r) => header.map((h) => r[h] ?? '').join(','))].join('\n') + '\n', 'utf8');
    console.log('已写回 ' + CSV);
}
