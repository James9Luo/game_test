/**
 * ladder.mjs —— 按**季目标阶梯**反解每一关的 cycle_ms（v0.5 路径放开后必需）
 *
 * 为什么不用"重排形状"：路径改了之后，某关的剩余形状候选窗口可能全部落在
 * 目标区间之外（bounce/arc 让窗口整体偏窄），重排只能"挑最接近"，做不出严格阶梯。
 * 而**同一关**（路径/圈数/正弦/惯性都固定）的窗口随 cycle 单调 → 二分一定可解。
 *
 * 每个季的单物体关按 id 顺序拿一个线性递减的目标窗口：
 *   季1 140→38 / 季2 141→47 / 季3 104→33 / 季4 68→19
 * 双物体关不动（它们是刻意的难度尖峰）。
 *
 * 用法：node _probe/ladder.mjs [--dry]
 */
import fs from 'node:fs';
import '../tools/_ts_boot.mjs';
const { loadShapes } = await import('../assets/scripts/core/Shapes.ts');
const { buildLevel } = await import('../assets/scripts/core/LevelStore.ts');
const { hitWindow } = await import('../assets/scripts/core/Judge.ts');

const CSV = '01_策划文档/levels.csv';
const DRY = process.argv.includes('--dry');
const shapes = loadShapes(JSON.parse(fs.readFileSync('assets/config/shapes.json', 'utf8')));
const num = (s, d = 0) => (s === '' || s == null || isNaN(Number(s)) ? d : Number(s));

const TARGETS = { 1: [140, 38], 2: [141, 47], 3: [104, 33], 4: [68, 19] };

const raw = fs.readFileSync(CSV, 'utf8').replace(/^\uFEFF/, '');
const lines = raw.split(/\r?\n/).filter((l) => l.trim());
const header = lines[0].split(',');
const rows = lines.slice(1).map((l) => {
    const c = l.split(',');
    const o = {};
    header.forEach((h, i) => (o[h.trim()] = (c[i] ?? '').trim()));
    return o;
});

function toDef(o, cyc) {
    return {
        id: num(o.id), name: o.name, shapeId: o.object_id, outlineId: o.outline_id,
        variant: o.variant || 'single', motion: o.motion_type, path: o.path,
        cycleMs: cyc ?? num(o.cycle_ms), turns: num(o.turns), jitter: num(o.jitter),
        toleranceDeg: num(o.tolerance_deg), passRate: num(o.pass_rate), star3Rate: num(o.star3_rate),
        estSec: num(o.est_seconds), weight: num(o.weight), attempts: num(o.attempts, 3),
        note: o.note, speedStage: num(o.speed_stage, 1), shapeId2: o.object_id_2 || undefined,
        linSpeed: [num(o.lin_speed_min), num(o.lin_speed_max)],
        angSpeed: [num(o.ang_speed_min), num(o.ang_speed_max)],
        season: num(o.season, 1),
        sineAmp: num(o.sine_amp), sinePeriodMs: num(o.sine_period_ms, 960), sinePhase: num(o.sine_phase, 0),
        inertiaPx: num(o.inertia_px), inertiaHz: num(o.inertia_hz, 1.0), inertiaPhase: num(o.inertia_phase),
    };
}

function win(o, cyc) {
    const rt = buildLevel(toDef(o, cyc), shapes, 0);
    const hw = hitWindow(rt, 0.5, 20);
    return Math.min(Math.abs(hw.earlyMs), Math.abs(hw.lateMs));
}

let bad = 0;
for (const s of [1, 2, 3, 4]) {
    const list = rows.filter((r) => num(r.season) === s && r.variant !== 'dual');
    const [wHi, wLo] = TARGETS[s];
    const out = [];
    /* 该季可用形状（本季已出现的形状集合，保证不引入季外道具） */
    const pool = s === 1 ? list.map((r) => r.object_id) : [...new Set(rows.filter((r) => num(r.season) === s).map((r) => r.object_id))];
    const used = new Set(s === 1 ? [] : []); /* 季 1 不动形状，保留 v0.3 校准 */
    list.forEach((r, i) => {
        const target = wHi + ((wLo - wHi) * (i / (list.length - 1)));
        const cyc0 = num(r.cycle_ms);
        const isBeat = /机制/.test(r.note || '');   /* 机制节点关：速度持平，不参与反解 */
        /* 季 1 不动（已与 v0.3 逐位对齐），只做周期微调 */
        if (s > 1) {
            /* 阶段 A：挑一个"在计划周期下窗口最接近目标"的形状；
               未用过的形状有 4ms 的优先权，但**允许重复**——否则某关可能只剩不合适的候选 */
            let bestShape = r.object_id;
            let bestDiff = Infinity;
            for (const id of pool) {
                r.object_id = id; r.outline_id = id;
                const d = Math.abs(win(r, cyc0) - target) + (used.has(id) ? 4 : 0);
                if (d < bestDiff) { bestDiff = d; bestShape = id; }
            }
            r.object_id = bestShape; r.outline_id = bestShape;
            used.add(bestShape);
        }
        /* 阶段 B：二分周期，把窗口钉到目标（机制节点关跳过——它们靠机制换难度，不靠提速） */
        if (!isBeat) {
            const lockSine = (c) => {
                if (num(r.sine_amp) > 0) { const ratio = Math.max(0.25, Math.min(0.85, num(r.sine_period_ms, 960) / num(r.cycle_ms, 1000))); r.sine_period_ms = String(Math.max(600, Math.min(1600, Math.round(c * ratio)))); }
            };
            let lo = 700;
            let hi = 3400;
            let best = cyc0;
            let bestDiff2 = Math.abs(win(r, cyc0) - target);
            for (let it = 0; it < 26; it++) {
                const mid = Math.round((lo + hi) / 2);
                lockSine(mid);
                const w = win(r, mid);
                const diff = Math.abs(w - target);
                if (diff < bestDiff2) { bestDiff2 = diff; best = mid; }
                if (w > target) lo = mid + 1; else hi = mid - 1;
                if (lo > hi) break;
            }
            lockSine(best);
            r.cycle_ms = String(best);
        }
        const w = win(r, num(r.cycle_ms));
        if (Math.abs(w - target) > 3) bad++;
        out.push(Math.round(w));
        console.log(
            '季' + s + ' L' + String(r.id).padStart(2) + '  ' + String(r.object_id).padEnd(12) + String(r.path).padEnd(13) +
            ' 目标' + target.toFixed(0).padStart(4) + '  周期 ' + String(cyc0).padStart(4) + '→' + String(r.cycle_ms).padStart(4) +
            '  实测 ' + w.toFixed(1).padStart(5) + 'ms'
        );
    });
    console.log('  → 季' + s + ' 阶梯: ' + out.join('>') + '\n');
}

if (!DRY) {
    /* 阶段 C：单调兜底——任一关窗口大于前一关，就在**同周期**下换一个更敏感的形状把它压下去 */
    for (const s of [1, 2, 3, 4]) {
        if (s === 1) continue;
        const list = rows.filter((r) => num(r.season) === s && r.variant !== 'dual');
        const pool = [...new Set(rows.filter((r) => num(r.season) === s).map((r) => r.object_id))];
        let prev = Infinity;
        for (const r of list) {
            let w = win(r, num(r.cycle_ms));
            if (w > prev) {
                let pick = r.object_id;
                let pickW = Infinity;
                const oldId = r.object_id;
                for (const id of pool) {
                    r.object_id = id; r.outline_id = id;
                    const ww = win(r, num(r.cycle_ms));
                    if (ww <= prev && Math.abs(ww - prev) < Math.abs(pickW - prev)) { pick = id; pickW = ww; }
                }
                if (pickW !== Infinity) {
                    r.object_id = pick; r.outline_id = pick;
                    w = pickW;
                    console.log('  [C] 季' + s + ' L' + r.id + ' ' + oldId + '→' + pick + ' 压到 ' + w.toFixed(1) + 'ms');
                } else {
                    r.object_id = oldId; r.outline_id = oldId;
                }
            }
            prev = w;
        }
    }
    /* 阶段 D：机制节点必须"不比同季前一关更快"（S11）。
       ladder 求解会把别的关加速，从而让后面的机制节点相对变快 → 这里把机制节点
       的周期拉回到前一关的周期，靠机制本身（正弦/惯性）制造难度差。 */
    for (const s of [2, 3, 4]) {
        const list = rows.filter((r) => num(r.season) === s);
        let prevCyc = null;
        for (const r of list) {
            if (/机制/.test(r.note || '') && prevCyc != null && num(r.cycle_ms) < prevCyc) {
                r.cycle_ms = String(prevCyc);
                if (num(r.sine_amp) > 0) r.sine_period_ms = String(Math.max(600, Math.min(1600, Math.round(prevCyc * 0.5))));
                console.log('  [D] 季' + s + ' L' + r.id + ' 机制关周期拉回 ' + prevCyc + '（不加速）');
            }
            prevCyc = num(r.cycle_ms);
        }
    }
    fs.writeFileSync(CSV, [header.join(','), ...rows.map((r) => header.map((h) => r[h] ?? '').join(','))].join('\n') + '\n', 'utf8');
    console.log('已写回 ' + CSV + '；偏差 >3ms 的关：' + bad);
}
