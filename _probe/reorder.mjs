/**
 * reorder.mjs —— 按**实测窗口**重排季 3/4 的单物体关，让阶梯严格单调
 *
 * 背景：按 k 排序不够——同一形状在不同 cycle/turns 下敏感度会变序（正弦相位的影响）。
 * 做法：对某季的「单物体关」按关序（周期递减）贪心分配：
 *       每一关从剩余形状里挑「实测窗口 ≤ 上一关窗口、且尽可能接近上一关」的那个。
 * 只改 object_id / outline_id，不动周期、圈数、正弦、惯性、双物体关。
 *
 * 用法：node _probe/reorder.mjs 3 4        # 重排季 3、季 4
 *      node _probe/reorder.mjs --check      # 只打印当前阶梯
 */
import fs from 'node:fs';
import '../tools/_ts_boot.mjs';
const { loadShapes } = await import('../assets/scripts/core/Shapes.ts');
const { buildLevel } = await import('../assets/scripts/core/LevelStore.ts');
const { hitWindow } = await import('../assets/scripts/core/Judge.ts');

const CSV = '01_策划文档/levels.csv';
const shapes = loadShapes(JSON.parse(fs.readFileSync('assets/config/shapes.json', 'utf8')));
const num = (s, d = 0) => (s === '' || s == null || isNaN(Number(s)) ? d : Number(s));

function readCsv() {
    const raw = fs.readFileSync(CSV, 'utf8').replace(/^\uFEFF/, '');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim());
    const header = lines[0].split(',');
    const rows = lines.slice(1).map((l) => {
        const c = l.split(',');
        const o = {};
        header.forEach((h, i) => (o[h.trim()] = (c[i] ?? '').trim()));
        return o;
    });
    return { header, rows };
}

function writeCsv(header, rows) {
    fs.writeFileSync(CSV, [header.join(','), ...rows.map((r) => header.map((h) => r[h] ?? '').join(','))].join('\n') + '\n', 'utf8');
}

function toDef(o, shapeId) {
    return {
        id: num(o.id), name: o.name, shapeId, outlineId: shapeId,
        variant: o.variant || 'single', motion: o.motion_type, path: o.path,
        cycleMs: num(o.cycle_ms), turns: num(o.turns), jitter: num(o.jitter),
        toleranceDeg: num(o.tolerance_deg), passRate: num(o.pass_rate), star3Rate: num(o.star3_rate),
        estSec: num(o.est_seconds), weight: num(o.weight), attempts: num(o.attempts, 3),
        note: o.note, speedStage: num(o.speed_stage, 1),
        shapeId2: o.object_id_2 || undefined,
        linSpeed: [num(o.lin_speed_min), num(o.lin_speed_max)],
        angSpeed: [num(o.ang_speed_min), num(o.ang_speed_max)],
        season: num(o.season, 1),
        sineAmp: num(o.sine_amp), sinePeriodMs: num(o.sine_period_ms, 960),
        inertiaPx: num(o.inertia_px), inertiaHz: num(o.inertia_hz, 1.0), inertiaPhase: num(o.inertia_phase),
    };
}

function winOf(row, shapeId) {
    const rt = buildLevel(toDef(row, shapeId), shapes, 0);
    const hw = hitWindow(rt, 0.5, 20);
    return Math.min(Math.abs(hw.earlyMs), Math.abs(hw.lateMs));
}

const { header, rows } = readCsv();
const want = process.argv.slice(2).filter((a) => /^[0-9]+$/.test(a)).map(Number);

if (process.argv.includes('--check') || want.length === 0) {
    for (const s of [1, 2, 3, 4]) {
        const list = rows.filter((r) => num(r.season) === s && r.variant !== 'dual');
        const w = list.map((r) => Math.round(winOf(r, r.object_id)));
        let mono = true;
        for (let i = 1; i < w.length; i++) if (w[i] > w[i - 1] + 2) mono = false;
        console.log('季' + s + ' 单物体: ' + w.join('>') + '  ' + (mono ? '单调✓' : '非单调'));
    }
    process.exit(0);
}

for (const s of want) {
    const idxs = rows.map((r, i) => ({ r, i })).filter((x) => num(x.r.season) === s && x.r.variant !== 'dual');
    const pool = [...new Set(idxs.map((x) => x.r.object_id))];
    const taken = new Set();
    let prev = Infinity;
    console.log('\n重排季 ' + s + '（' + idxs.length + ' 个单物体关，候选形状 ' + pool.length + ' 个）');
    for (const { r } of idxs) {
        let best = null;
        let bestW = -1;
        for (const id of pool) {
            if (taken.has(id)) continue;
            const w = winOf(r, id);
            if (w <= prev + 0.5 && w > bestW) { bestW = w; best = id; }
        }
        if (!best) { /* 没有满足递减的 → 取剩余里最大窗口的那个 */
            let w2 = -1;
            for (const id of pool) if (!taken.has(id)) { const w = winOf(r, id); if (w > w2) { w2 = w; best = id; } }
            bestW = w2;
        }
        taken.add(best);
        prev = bestW;
        const old = r.object_id;
        r.object_id = best;
        r.outline_id = best;
        console.log('  L' + r.id + '  ' + old + ' → ' + best + '   窗口 ' + bestW.toFixed(1) + 'ms');
    }
}
writeCsv(header, rows);
console.log('\n已写回 ' + CSV);
