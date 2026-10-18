/**
 * tools/win_snapshot.mjs —— 把当前 levels.json 里的三窗口存成「版本基线」（S13 与 S22c 共用的秤）
 *
 *   node tools/win_snapshot.mjs            # 写出 tools/_win_baseline_v05.mjs（已存在且有效时拒绝覆盖）
 *   node tools/win_snapshot.mjs --force    # 明确覆盖（只在数据确实还是「改表前」时用）
 *   node tools/win_snapshot.mjs --check    # 只校验基线文件是否**真的可用**（空文件 / {} / 空 levels 都判红）
 *
 * 为什么需要：v0.6 加了 phase_2 / cycle_2_ms，要求「同步关（phase_2=0 & cycle_2=0）的窗口与 v0.5 逐位相同」。
 * 这个脚本必须在**改数据之后的第一次 export 之前**跑一次，否则基线会被新值覆盖（那样 S13 就失去意义）。
 *
 * 2026-10-18 修（D-085）：旧版有两个坑，已修
 *   ① 旧版先 `writeJson(OUT, {})` 占位，再用 `import('node:fs').then(writeFileSync…)` 补正文，
 *      紧接着 `process.exit()` → 正文**永远不会落盘**，产物一直是个 `{}`；
 *      而 `--check` 只看文件在不在 → 把 `{}` 当成「基线已存在」，于是 S13 与 S22c 共用一只坏秤。
 *      现在：全部算完 → 一次 `writeFileSync` 同步写完整文件 → 回读验真 → 再退出。
 *   ② `--check` 现在会真正 import 回来验 `WIN_BASELINE_V05.levels`：缺文件报「缺基线」，
 *      空文件 / `{}` / 空 levels / 行缺 hit 都报红，不再有「文件在就算通过」这条路。
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, readJson, exists, rel, makeReporter } from './_io.mjs';

const OUT = path.join(ROOT, 'tools/_win_baseline_v05.mjs');
const LEVELS = path.join(ROOT, 'assets/resources/config/levels.json');
const ARGV = process.argv.slice(2);
const CHECK = ARGV.includes('--check');
const FORCE = ARGV.includes('--force');

const rep = makeReporter(`win_snapshot${CHECK ? '（--check）' : ''}`);

/**
 * 从基线文件正文里抠出 levels 数组（text 级解析，不 import）
 * 为什么不用 import：写入模式要「写完立刻回读」，同一个路径二次 import 会命中模块缓存读到旧内容；
 * 加 ?t= 破缓存则依赖 node 对 file: URL 带 query 的支持，不值得为一行校验赌这个。
 */
function extractLevelsArray(text) {
    const m = /levels:\s*\[/.exec(text);
    if (!m) return null;
    const start = m.index + m[0].length - 1; // 指向 '['
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '[' || ch === '{') depth++;
        else if (ch === ']' || ch === '}') {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return null;
}

/**
 * 读回基线并验真：返回 { ok, levels, reason, capturedFrom }
 * 判据比旧版严：文件存在不算数，必须有非空、每行带 id + hit:[早,晚] 的 levels。
 */
function readBaseline(p) {
    if (!exists(p)) return { ok: false, levels: [], reason: '缺基线文件：' + rel(p) };
    let text = '';
    try {
        text = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
    } catch (e) {
        return { ok: false, levels: [], reason: '读不了 ' + rel(p) + '：' + ((e && e.message) || e) };
    }
    const t = text.trim();
    if (t === '') return { ok: false, levels: [], reason: rel(p) + ' 是空文件（正文 0 字节）' };
    if (t === '{}') {
        return {
            ok: false,
            levels: [],
            reason: rel(p) + ' 的内容是 `{}` —— 正是旧版 win_snapshot.mjs 的占位残留（先写 {} 再异步补正文，正文没补上就 process.exit 了）',
        };
    }
    if (!/export\s+const\s+WIN_BASELINE_V05\s*=/.test(text)) {
        return { ok: false, levels: [], reason: rel(p) + ' 里没有 `export const WIN_BASELINE_V05 = …`（不是本工具生成的基线）' };
    }
    const arrText = extractLevelsArray(text);
    if (!arrText) return { ok: false, levels: [], reason: rel(p) + ' 里找不到 `levels: [...]`' };
    let lv = null;
    try {
        lv = JSON.parse(arrText);
    } catch (e) {
        return { ok: false, levels: [], reason: rel(p) + ' 的 levels 不是合法 JSON：' + ((e && e.message) || e) };
    }
    if (!Array.isArray(lv) || lv.length === 0) return { ok: false, levels: [], reason: rel(p) + ' 的 levels 是空的' };
    const badRows = lv.filter((r) => !r || typeof r.id !== 'number' || !Array.isArray(r.hit) || r.hit.length !== 2);
    if (badRows.length) {
        return { ok: false, levels: [], reason: rel(p) + ' 里有 ' + badRows.length + ' 行缺 id 或 hit（hit 必须是 [早, 晚]）' };
    }
    const cm = /capturedFrom:\s*("(?:[^"\\]|\\.)*")/.exec(text);
    let capturedFrom = '';
    if (cm) {
        try { capturedFrom = JSON.parse(cm[1]); } catch { capturedFrom = ''; }
    }
    return { ok: true, levels: lv, reason: 'ok', capturedFrom };
}

/* ---------------- --check：只验基线可用性 ---------------- */
if (CHECK) {
    const v = readBaseline(OUT);
    if (!v.ok) {
        rep.bad('基线不可用：' + v.reason);
        rep.info('处置：数据确实还是「改表前」的状态时跑 node tools/win_snapshot.mjs（数据已经改过就别抓了，追不回来）');
        process.exit(rep.finish());
    }
    /* 文本过关后再真 import 一次：能抓「正文合法但模块语法坏了」这种情况（--check 是独立进程，没有缓存问题） */
    try {
        const mod = await import(pathToFileURL(OUT).href);
        if (!mod || !mod.WIN_BASELINE_V05) throw new Error('模块里没有导出 WIN_BASELINE_V05');
    } catch (e) {
        rep.bad('基线正文看着对，但 import 失败（模块语法有问题）：' + ((e && e.message) || e));
        process.exit(rep.finish());
    }
    const first = v.levels[0];
    const last = v.levels[v.levels.length - 1];
    rep.ok(`基线可用：${rel(OUT)}（${v.levels.length} 关，L${first.id}–L${last.id}）`, v.capturedFrom);
    process.exit(rep.finish());
}

/* ---------------- 抓基线：先算完，再一次性同步写 ---------------- */
if (!exists(LEVELS)) {
    rep.bad(`找不到 ${rel(LEVELS)}，先跑 node tools/export_levels.mjs`);
    process.exit(rep.finish());
}
const raw = readJson(LEVELS);
const levels = (Array.isArray(raw) ? raw : raw.levels || [])
    .filter((l) => l.hitWindow && l.godWindow && l.starWindow)
    .map((l) => ({
        id: l.id,
        cycleMs: l.cycleMs,
        phase2: l.phase2 ?? 0,
        cycle2Ms: l.cycle2Ms ?? 0,
        hit: [l.hitWindow.earlyMs, l.hitWindow.lateMs],
        god: [l.godWindow.earlyMs, l.godWindow.lateMs],
        star: [l.starWindow.earlyMs, l.starWindow.lateMs],
    }));
if (levels.length === 0) {
    rep.bad('levels.json 里没有窗口字段（hitWindow/godWindow/starWindow）—— 先跑 node tools/export_levels.mjs');
    process.exit(rep.finish());
}
const staggered = levels.filter((l) => l.phase2 > 0 || l.cycle2Ms > 0).length;
if (staggered > 0) {
    rep.warn(`注意：已有 ${staggered} 关带错拍字段——这些关的窗口不是 v0.5 状态，S13 会跳过它们`);
}

/* 覆盖保护：有效基线一律不许静默覆盖（覆盖 = 把新值当基准，S13 就永远绿了）。
   无效残留（空文件 / {}）允许直接覆盖，不必加 --force。 */
const prev = readBaseline(OUT);
if (prev.ok && !FORCE) {
    rep.bad(`基线已存在且有效：${rel(OUT)}（${prev.levels.length} 关）—— 重抓会覆盖「改表前」的快照，S13 就失去意义`);
    rep.info('确认数据确实还是改表前、要重抓：node tools/win_snapshot.mjs --force');
    process.exit(rep.finish());
}
if (!prev.ok && exists(OUT)) {
    rep.warn(`旧文件无效（${prev.reason}）→ 直接覆盖`);
}

const capturedAt = new Date().toISOString();
const body = `/**
 * tools/_win_baseline_v05.mjs —— 【S13 基线】窗口实测快照（由 tools/win_snapshot.mjs 生成，别手改）
 *
 * 纪律：本文件只读。之后的改动中，**同步关**（phase_2=0 & cycle_2=0）的三窗口必须与这里**逐位相同**；
 * 错拍关（有 phase2/cycle2Ms）跳过比对（它们的窗口本来就该变）。
 * 用途：node tools/geometry_test.mjs 的 [S13] 段（v0.7 的 S22c 另有独立快照 tools/_win_baseline_s22.json）。
 *
 * 生成时间：${capturedAt}
 * 数据来源：${rel(LEVELS)}（${levels.length} 关）
 */

export const WIN_BASELINE_V05 = {
    version: 'snapshot',
    capturedAt: ${JSON.stringify(capturedAt)},
    capturedFrom: ${JSON.stringify(rel(LEVELS) + '（win_snapshot.mjs 同步写出）')},
    metric: 'hitWindow / godWindow / starWindow，单位 ms，[早, 晚]，与 levels.json 的派生值同源',
    levels: ${JSON.stringify(levels)},
};

/** 按 id 取基线（不存在返回 null） */
export function baselineV05Of(id) {
    return WIN_BASELINE_V05.levels.find((l) => l.id === id) || null;
}
`;

/* 关键：一次同步写完，中间不夹 process.exit（旧版的死法就是异步补写被 exit 掐掉） */
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, body, 'utf8');

/* 写完立刻回读验真：写坏了自己先炸，别把坏秤交给 S13 */
const verify = readBaseline(OUT);
if (!verify.ok) {
    rep.bad(`写完回读失败：${verify.reason}`);
    process.exit(rep.finish());
}
rep.ok(`写出 ${rel(OUT)}（${verify.levels.length} 关三窗口，回读校验通过）`);
rep.info('下一步：改 levels.csv → node tools/export_levels.mjs → node tools/geometry_test.mjs（S13）／node tools/modes_check.mjs（S22c 有自己的快照）');
process.exit(rep.finish());
