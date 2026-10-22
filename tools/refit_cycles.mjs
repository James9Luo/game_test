/**
 * tools/refit_cycles.mjs —— 窗口归位（换形后必跑）
 *
 * 为什么需要：关卡难度 = 命中窗口（ms），窗口 = k(形状) × cycle(周期)。
 * 形状一改（描样、放大、附件、车道缩放），k 就变，必须把 cycle 反解回**校准窗口**
 * （levels.csv 的 hit_target_ms），否则等于偷偷改难度（D-087）。
 *
 * 用法：
 *   node tools/refit_cycles.mjs            # 只报告
 *   node tools/refit_cycles.mjs --apply    # 写回 levels.csv 并重新导出
 *   node tools/refit_cycles.mjs --apply --rounds=4
 *
 * 规则：
 *   · 目标窗口 = hitTargetMs × 2（hitTargetMs 是单侧容差）
 *   · 机制关（note 含「机制」）不允许比同季上一关更快 → 钳制到上一关周期（S11）
 *   · 每轮 re-export 后用 export_levels 自己的漂移检查兜底
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, readJson } from './_io.mjs';
import { core } from './_core.mjs';

const { buildLevel, hitWindow, inspectShapes } = core;
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const ROUNDS = Number((argv.find((a) => a.startsWith('--rounds=')) || '--rounds=4').split('=')[1]);

const CSV = path.join(ROOT, '01_策划文档/levels.csv');
const LEVELS = path.join(ROOT, 'assets/resources/config/levels.json');
const SHAPES = path.join(ROOT, 'assets/config/shapes.json');

function readCsv() {
    const text = fs.readFileSync(CSV, 'utf8').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    const head = lines[0].split(',');
    const rows = lines.slice(1).map((l) => {
        const cells = l.split(',');
        const o = {};
        head.forEach((h, i) => { o[h] = cells[i] ?? ''; });
        return o;
    });
    return { head, rows };
}

function writeCsv(head, rows) {
    const lines = [head.join(',')].concat(rows.map((r) => head.map((h) => r[h] ?? '').join(',')));
    fs.writeFileSync(CSV, '\uFEFF' + lines.join('\n') + '\n', 'utf8');
}

const shapes = inspectShapes(readJson(SHAPES)).shapes;
const levels = readJson(LEVELS).levels;

const totalWin = (cycle, lv) => {
    const rt = buildLevel({ ...lv, cycleMs: cycle }, shapes, 20261018);
    const w = hitWindow(rt);
    return Math.abs(w.earlyMs) + Math.abs(w.lateMs);
};

let totalChanged = 0;
for (let round = 1; round <= ROUNDS; round++) {
    const { head, rows } = readCsv();
    const byId = Object.fromEntries(rows.map((r) => [Number(r.id), r]));
    const patches = [];
    for (const lv of levels) {
        const target = lv.hitTargetMs * 2;
        if (!(target > 0)) continue;
        const cur = Math.abs(lv.hitWindow.earlyMs) + lv.hitWindow.lateMs;
        if (Math.abs(cur - target) / target <= 0.01) continue;
        let lo = lv.cycleMs * 0.35, hi = lv.cycleMs * 2.5;
        for (let i = 0; i < 32; i++) {
            const mid = (lo + hi) / 2;
            if (totalWin(mid, lv) > target) hi = mid; else lo = mid;
        }
        const cyc = Math.round((lo + hi) / 2);
        patches.push({ id: lv.id, from: lv.cycleMs, to: cyc, before: +cur.toFixed(1), target: +target.toFixed(1) });
    }
    if (!patches.length) {
        console.log(`第 ${round} 轮：全部在 ±1% 内，结束`);
        break;
    }
    let clamped = 0;
    for (const p of patches) {
        const r = byId[p.id];
        if (!r) continue;
        let cyc = p.to;
        const prev = byId[p.id - 1];
        if ((r.note || '').includes('机制') && prev && prev.season === r.season && cyc < Number(prev.cycle_ms)) {
            cyc = Number(prev.cycle_ms);
            clamped++;
        }
        r.cycle_ms = String(cyc);
        const ang = (360 * Math.abs(Number(r.turns || 1)) / (cyc / 1000)).toFixed(1).replace(/\.0$/, '');
        r.ang_speed_min = ang;
        r.ang_speed_max = ang;
        totalChanged++;
    }
    console.log(`第 ${round} 轮：${patches.length} 关归位（机制钳制 ${clamped}）`);
    patches.slice(0, 12).forEach((p) => console.log(`   L${p.id} ${p.from}→${p.to}（窗口 ${p.before} 目标 ${p.target}）`));
    if (!APPLY) {
        console.log('（未加 --apply，不写回）');
        break;
    }
    writeCsv(head, rows);
    const out = execFileSync(process.execPath, [path.join(ROOT, 'tools/export_levels.mjs')], {
        cwd: ROOT, encoding: 'utf8',
    });
    const line = out.split(/\r?\n/).find((l) => l.includes('窗口漂移检查'));
    console.log('   ' + (line || '').trim());
}
console.log(`REFIT|changed=${totalChanged}|apply=${APPLY}`);
