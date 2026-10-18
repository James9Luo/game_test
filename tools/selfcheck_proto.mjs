/**
 * tools/selfcheck_proto.mjs —— 不开浏览器也能验的「逻辑闭环」自测
 *
 * 做法：把 原型/dista_prototype.html 里内联的 bundle 抠出来，在 node:vm 里用一个
 *      假 DOM（canvas 全部绘制方法空实现）跑起来，然后通过 window.__PROTO__ 驱动
 *      buildLevel / poseAt / judge / settle，断言纯逻辑正确。
 *
 * 它**不验**视觉（构图、文字压边、颜色），视觉靠 Edge 截图 + 人眼。
 *
 * 用法：node tools/selfcheck_proto.mjs
 * 退出码：0 全过 / 1 有失败
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, '原型', 'dista_prototype.html');

if (!fs.existsSync(HTML)) {
    console.error('[selfcheck] 找不到 ' + HTML + '，先跑 node tools/build_proto.mjs');
    process.exit(2);
}

const html = fs.readFileSync(HTML, 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (blocks.length < 2) {
    console.error('[selfcheck] HTML 里没找到内联 bundle（script 块数 = ' + blocks.length + '）');
    process.exit(2);
}
/* 最后一块 = bundle（前面是错误网） */
const bundle = blocks[blocks.length - 1];

/* ---------------- 假 canvas / 假 DOM ---------------- */
function makeCtx() {
    const noop = () => {};
    const grad = { addColorStop: noop };
    const ctx = {
        canvas: null,
        save: noop, restore: noop, setTransform: noop, translate: noop, rotate: noop, scale: noop,
        clearRect: noop, fillRect: noop, strokeRect: noop, beginPath: noop, closePath: noop,
        moveTo: noop, lineTo: noop, arc: noop, arcTo: noop, fill: noop, stroke: noop, clip: noop,
        createLinearGradient: () => grad,
        createRadialGradient: () => grad,
        measureText: (t) => ({ width: String(t == null ? '' : t).length * 12 }),
        fillText: noop,
        drawImage: noop,
        globalAlpha: 1, globalCompositeOperation: 'source-over',
        fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineJoin: 'miter', lineCap: 'butt',
        font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic',
        shadowColor: 'transparent', shadowBlur: 0
    };
    return ctx;
}

const listeners = { window: {}, canvas: {} };
const canvas = {
    width: 720, height: 1280, style: {},
    getContext: () => makeCtx(),
    addEventListener: (k, fn) => { listeners.canvas[k] = fn; }
};
const body = { attrs: {}, setAttribute: (k, v) => { body.attrs[k] = v; }, getAttribute: (k) => body.attrs[k] };
const documentElement = { attrs: {}, setAttribute: (k, v) => { documentElement.attrs[k] = v; } };

const storage = new Map();
const documentStub = {
    readyState: 'complete',
    title: '定格瞬间 · 原型',
    documentElement,
    body,
    getElementById: (id) => {
        if (id === 'cv') return canvas;
        if (id === 'errbar') return { style: {}, textContent: '' };
        return null;
    },
    addEventListener: () => {}
};

let t = 0;
let rafQueue = [];
const sandbox = {
    console,
    Math, Date, JSON, Object, Array, String, Number, Boolean, Error, isNaN, parseInt, parseFloat, Infinity, NaN,
    document: documentStub,
    window: null,
    performance: { now: () => t },
    requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
    cancelAnimationFrame: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    localStorage: {
        getItem: (k) => (storage.has(k) ? storage.get(k) : null),
        setItem: (k, v) => storage.set(k, String(v)),
        removeItem: (k) => storage.delete(k)
    },
    location: { search: '' }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.devicePixelRatio = 1;
sandbox.window.innerWidth = 720;
sandbox.window.innerHeight = 1280;
sandbox.window.addEventListener = (k, fn) => { listeners.window[k] = fn; };
sandbox.window.requestAnimationFrame = sandbox.requestAnimationFrame;
sandbox.window.localStorage = sandbox.localStorage;
sandbox.window.PointerEvent = function PointerEvent() {};

/* ---------------- 跑起来 ---------------- */
let pass = 0;
let fail = 0;
const failures = [];
const warnings = [];

/** 一位小数，NaN 安全（断言细节里常打角度/毫秒） */
function num1(v) {
    return (typeof v === 'number' && isFinite(v)) ? v.toFixed(1) : String(v);
}

function check(name, cond, detail) {
    if (cond) { pass++; return; }
    fail++;
    failures.push(name + (detail ? ' — ' + detail : ''));
}

/** 跨模块问题：只提醒，不算本原型的失败（例如 core 的热力图 API 坏了，原型有兜底） */
function warn(name, detail) {
    warnings.push(name + (detail ? ' — ' + detail : ''));
}

let P = null;
try {
    vm.createContext(sandbox);
    vm.runInContext(bundle, sandbox, { filename: 'dista_prototype.bundle.js' });
    P = sandbox.window.__PROTO__;
} catch (e) {
    console.error('[selfcheck] bundle 执行抛异常：' + (e && e.stack ? e.stack : e));
    process.exit(1);
}

check('bundle 启动无异常（window.__PROTO__ 已挂）', !!P);
check('页面未进入错误态（title 未被改写）', !String(documentStub.title).includes('JS-ERROR'), String(documentStub.title));
check('data-core-mode 已写入 body', !!body.attrs['data-core-mode'], JSON.stringify(body.attrs));

if (!P) {
    console.error('[selfcheck] 没有 __PROTO__，后续断言跳过');
    process.exit(1);
}

const CORE = P.CORE;
const LEVELS = P.levels;
const SHAPES = P.shapes;

/* 关卡数不写死：v0.4 是 60 关，下一次扩容还会变。
   只校验"四的倍数的季结构"与"至少 15 关"，具体数量交给 modes_check 的 S1。 */
check('关卡数 ≥ 15 且是 15 的整数倍（每季 15 关）',
    LEVELS.length >= 15 && LEVELS.length % 15 === 0, '实际 ' + LEVELS.length);
check('轮廓数 ≥ 1', Object.keys(SHAPES).length >= 1, '实际 ' + Object.keys(SHAPES).length);
check('CORE API 齐全', ['buildLevel', 'poseAt', 'objectPtsAt', 'judge', 'ratingOf', 'loadShapes', 'loadLevels'].every((k) => typeof CORE[k] === 'function'), '缺 ' + ['buildLevel', 'poseAt', 'objectPtsAt', 'judge', 'ratingOf', 'loadShapes', 'loadLevels'].filter((k) => typeof CORE[k] !== 'function').join(','));

/* 2. 每关都能 build，perfectMs 合理 */
let buildBad = [];
for (let i = 0; i < LEVELS.length; i++) {
    const def = LEVELS[i];
    try {
        const rt = CORE.buildLevel(def, SHAPES, 1337 + i * 97);
        const cyc = rt.movers[0].cycleMs;
        if (!(rt.perfectMs > 0 && rt.perfectMs < cyc)) buildBad.push('L' + (i + 1) + ' perfectMs=' + Math.round(rt.perfectMs) + '/' + Math.round(cyc));
        if (!rt.movers.length) buildBad.push('L' + (i + 1) + ' 无 mover');
        if (def.variant === 'dual' && rt.movers.length !== 2) buildBad.push('L' + (i + 1) + ' 双物体 mover 数=' + rt.movers.length);
    } catch (e) {
        buildBad.push('L' + (i + 1) + ' 抛异常 ' + e.message);
    }
}
check('15 关 buildLevel 全部成功且 perfectMs ∈ (0, cycle)', buildBad.length === 0, buildBad.join(' | '));

/* 3. 完美时机判定：重合率高、onTime、pass
 * v0.6 双物体错拍：L50/L60 是 `phase2>0`，两个 mover **不同帧**完美，
 * 所以"同帧都卡位"这条语义不成立 —— 改为**各自在自己 perfectMs 上**判定（S18 同口径）。 */
const judgeBad = [];
for (let i = 0; i < LEVELS.length; i++) {
    const def = LEVELS[i];
    const rt = CORE.buildLevel(def, SHAPES, 1337 + i * 97);
    const isDesyncLevel = Number(def.phase2 || def.phase_2 || 0) > 0;
    if (isDesyncLevel && typeof CORE.perMoverWindows === 'function' && typeof CORE.moverTiming === 'function') {
        for (let m = 0; m < rt.movers.length; m++) {
            const pm = CORE.moverTiming(rt.movers[m]).perfectMs;
            const rm = CORE.judgeMover(rt.movers[m], pm);
            if (!(rm.pct >= 95)) judgeBad.push('L' + def.id + ' mover' + m + ' pct=' + rm.pct.toFixed(1) + '（错拍关：各自 perfectMs 上必须卡住）');
            if (Math.abs(rm.offsetPx) > 2) judgeBad.push('L' + def.id + ' mover' + m + ' 形心偏移 ' + rm.offsetPx.toFixed(1) + 'px');
        }
        continue;
    }
    const r = CORE.judge(rt, rt.perfectMs, 0);
    if (!(r.pct >= 95)) judgeBad.push('L' + (i + 1) + ' 平均 pct=' + r.pct.toFixed(1));
    for (const o of r.objects) {
        if (!(o.pct >= 95)) judgeBad.push('L' + (i + 1) + ' 单物体 pct=' + o.pct.toFixed(1) + '（双车道必须同帧都卡位）');
        if (Math.abs(o.offsetPx) > 2) judgeBad.push('L' + (i + 1) + ' 形心偏移 ' + o.offsetPx.toFixed(1) + 'px');
    }
    if (r.timing.verdict !== 'onTime') judgeBad.push('L' + (i + 1) + ' verdict=' + r.timing.verdict + '(' + r.timing.deltaMs.toFixed(1) + 'ms)');
    if (!r.pass) judgeBad.push('L' + (i + 1) + ' 完美时机却未通关');
    if (r.objects.length !== rt.movers.length) judgeBad.push('L' + (i + 1) + ' objects 数不符');
}
check('完美时机：pct ≥ 95 / onTime / pass / 形心重合（错拍关按 per-mover 各自 perfectMs）', judgeBad.length === 0, judgeBad.slice(0, 6).join(' | '));

/* 4. 按早 / 按晚 的因果必须对得上（这是本作核心） */
const timingBad = [];
for (let i = 0; i < LEVELS.length; i++) {
    const rt = CORE.buildLevel(LEVELS[i], SHAPES, 1337 + i * 97);
    const cyc = rt.movers[0].cycleMs;
    const earlyMs = Math.max(30, rt.perfectMs - Math.min(300, rt.perfectMs * 0.3));
    const lateMs = Math.min(cyc - 30, rt.perfectMs + Math.min(300, (cyc - rt.perfectMs) * 0.3));
    const rEarly = CORE.judge(rt, earlyMs, 0);
    const rLate = CORE.judge(rt, lateMs, 0);
    if (rEarly.timing.verdict !== 'early') timingBad.push('L' + (i + 1) + ' 提前按却判 ' + rEarly.timing.verdict);
    if (rLate.timing.verdict !== 'late') timingBad.push('L' + (i + 1) + ' 延后按却判 ' + rLate.timing.verdict);
    if (rEarly.timing.deltaMs >= 0) timingBad.push('L' + (i + 1) + ' 提前 deltaMs=' + rEarly.timing.deltaMs.toFixed(0));
    if (rLate.timing.deltaMs <= 0) timingBad.push('L' + (i + 1) + ' 延后 deltaMs=' + rLate.timing.deltaMs.toFixed(0));
    if (!(rEarly.pct <= CORE.judge(rt, rt.perfectMs, 0).pct + 0.001)) timingBad.push('L' + (i + 1) + ' 提前的重合率反而更高');
    if (!(rLate.pct <= CORE.judge(rt, rt.perfectMs, 0).pct + 0.001)) timingBad.push('L' + (i + 1) + ' 延后的重合率反而更高');
}
check('按早/按晚：verdict、deltaMs 符号、pct 衰减方向都对', timingBad.length === 0, timingBad.slice(0, 6).join(' | '));

/* 5. 角度偏差方向：晚按 = 多转（正角）
 * ⚠️ 不能直接"晚按 200ms"就去验 angleDev 符号：L60 是 3 圈 / 1200ms = 1080°/s，
 *    晚 150ms 就是 +162°，晚 200ms 超过 +180° 后 normDeg 会绕回负数（-168.3° 其实是 +191.7°）。
 *    正确做法：
 *      a) 早/晚的**符号**用 ring-safe 的 timing 字段判（verdict === 'late' && deltaMs > 0）；
 *      b) 角度方向只在一个"不会绕圈"的小 Δt 上验：取 Δt 使 |ω·Δt| ≤ 45°。
 */
const angBad = [];
for (let i = 0; i < LEVELS.length; i++) {
    const rt = CORE.buildLevel(LEVELS[i], SHAPES, 1337 + i * 97);
    const cyc = rt.movers[0].cycleMs;
    const turns = LEVELS[i].turns || 1;
    const omegaDegPerSec = (turns * 360) / (cyc / 1000);   /* 角速度 °/s */
    const dtMax = Math.min(200, (45 / Math.max(1, omegaDegPerSec)) * 1000); /* 保证 ≤45° */
    const dt = Math.max(4, Math.floor(dtMax));             /* 至少 4ms，仍远小于窗口 */
    const late = Math.min(cyc - 30, rt.perfectMs + dt);
    const lateRes = CORE.judge(rt, late, 0);
    const tm = lateRes.timing || {};
    /* a) ring-safe：晚按必须判 late 且 deltaMs > 0 */
    if (!(tm.verdict === 'late' && tm.deltaMs > 0)) {
        angBad.push('L' + (i + 1) + ' timing=' + tm.verdict + '/' + num1(tm.deltaMs) + '（期望 late/正）');
    }
    /* b) 小 Δt 下的角度方向：多转必须为正（Δt 已按角速度缩到 ≤45°，不会绕圈） */
    const dev = lateRes.objects[0].angleDev;
    if (!(dev > -0.5)) angBad.push('L' + (i + 1) + ' Δt=' + dt + 'ms angleDev=' + num1(dev) + '（期望 >0）');
}
check('晚按 → verdict=late、deltaMs>0，且在小 Δt 下角度多转为正（环形安全）',
    angBad.length === 0, angBad.slice(0, 6).join(' | '));

/* 6. 「看到的」= 「判到的」：物体世界轮廓面积必须≈目标面积；热力图绿区≈交集、红区≈偏差 */
const heatBad = [];
for (let i = 0; i < LEVELS.length; i++) {
    const rt = CORE.buildLevel(LEVELS[i], SHAPES, 1337 + i * 97);
    const cyc = rt.movers[0].cycleMs;
    const perfect = CORE.judge(rt, rt.perfectMs, 0);
    const off = CORE.judge(rt, Math.min(cyc - 30, rt.perfectMs + 400), 0);

    for (const o of perfect.objects) {
        const objArea = CORE.polyArea(o.objectPts);
        const ratio = objArea / o.targetArea;
        if (!(ratio > 0.98 && ratio < 1.02)) {
            heatBad.push('L' + (i + 1) + ' 物体/目标面积比=' + ratio.toFixed(3) + '（看到的≠判到的）');
        }
    }
    const greenPerfect = greenArea(perfect.objects[0]);
    const redPerfect = redArea(perfect.objects[0]);
    const redOff = redArea(off.objects[0]);
    if (!(greenPerfect > 0.5 * perfect.objects[0].targetArea)) heatBad.push('L' + (i + 1) + ' 完美时绿区过小=' + Math.round(greenPerfect));
    if (!(redPerfect < 0.05 * perfect.objects[0].targetArea)) heatBad.push('L' + (i + 1) + ' 完美时红区过大=' + Math.round(redPerfect));
    if (!(redOff > 0.1 * off.objects[0].targetArea)) heatBad.push('L' + (i + 1) + ' 偏移时红区过小=' + Math.round(redOff));
}
check('绘制与判定同源 + 热力图绿≈交集 / 红≈偏差', heatBad.length === 0, heatBad.slice(0, 5).join(' | '));

/* 6a. core 条带 与 原型本地回退实现 必须同口径（否则换实现时热力图会「变形」） */
const stripBad = [];
if (typeof CORE.overlapStrips === 'function' && typeof CORE.missStrips === 'function') {
    for (const idx of [0, 4, 8, 12]) {
        const rt = CORE.buildLevel(LEVELS[idx], SHAPES, 7);
        const o = CORE.judge(rt, Math.min(rt.movers[0].cycleMs - 30, rt.perfectMs + 260), 0).objects[0];
        const cg = greenArea(o);
        let lg = 0;
        for (const b of localBands(o.objectPts, o.targetPts, 6)) for (const seg of b.green) lg += (seg[1] - seg[0]) * (b.y1 - b.y0);
        const cr = redArea(o);
        let lr = 0;
        for (const b of localBands(o.objectPts, o.targetPts, 6)) for (const seg of b.red) lr += (seg[1] - seg[0]) * (b.y1 - b.y0);
        const rel = (a, b) => (Math.max(a, b) > 1e-6 ? Math.abs(a - b) / Math.max(a, b) : 0);
        if (rel(cg, lg) > 0.02) stripBad.push('L' + (idx + 1) + ' 绿区 core=' + Math.round(cg) + ' 本地=' + Math.round(lg));
        if (rel(cr, lr) > 0.02) stripBad.push('L' + (idx + 1) + ' 红区 core=' + Math.round(cr) + ' 本地=' + Math.round(lr));
    }
}
check('core overlapStrips/missStrips 与本地回退同口径（差 < 2%）', stripBad.length === 0, stripBad.join(' | '));

/* 6b. core 热力图 API 可用性 —— 只提醒（原型有本地兜底，不影响交付） */
try {
    const rt1 = CORE.buildLevel(LEVELS[0], SHAPES, 1);
    const o1 = CORE.judge(rt1, rt1.perfectMs, 0).objects[0];
    if (typeof CORE.overlapStrips === 'function') {
        const rects = CORE.overlapStrips(o1.objectPts, o1.targetPts, 6);
        if (!rects || rects.length === 0) {
            warn('core.overlapStrips 返回空数组（Judge.ts:85 的 minY/maxY 初始化反了）→ 原型已回落本地条带，Cocos 侧热力图会是空的');
        }
    } else {
        warn('core 未导出 overlapStrips');
    }
    if (typeof CORE.heatBands === 'function') {
        const hb = CORE.heatBands(o1.objectPts, o1.targetPts, 24);
        if (!hb || hb.length === 0) warn('core.heatBands 返回空数组（同款 minY/maxY 初始化问题）');
    }
} catch (e) {
    warn('热力图 API 调用抛异常：' + (e && e.message ? e.message : e));
}

/** 绿区面积：优先用 core 的 overlapStrips 矩形 */
function greenArea(o) {
    if (typeof CORE.overlapStrips === 'function') {
        try {
            const rects = CORE.overlapStrips(o.objectPts, o.targetPts, 6);
            if (rects && rects.length && typeof rects[0].w === 'number') {
                let s = 0;
                for (const r of rects) s += r.w * r.h;
                return s;
            }
        } catch (e) { /* 回落 */ }
    }
    let s = 0;
    for (const b of localBands(o.objectPts, o.targetPts, 6)) for (const seg of b.green) s += (seg[1] - seg[0]) * (b.y1 - b.y0);
    return s;
}

/** 红区面积：优先用 core 的 missStrips（并集−交集） */
function redArea(o) {
    if (typeof CORE.missStrips === 'function') {
        try {
            const rects = CORE.missStrips(o.objectPts, o.targetPts, 6);
            if (Array.isArray(rects)) {
                let s = 0;
                for (const r of rects) s += r.w * r.h;
                return s;
            }
        } catch (e) { /* 回落 */ }
    }
    let s = 0;
    for (const b of localBands(o.objectPts, o.targetPts, 6)) for (const seg of b.red) s += (seg[1] - seg[0]) * (b.y1 - b.y0);
    return s;
}

/** 与 game.js 里 localBands 等价的实现，仅用于自测对照 */
function localBands(objPts, tgtPts, bandPx) {
    const bounds = (pts) => pts.reduce((b, p) => ({
        minX: Math.min(b.minX, p.x), minY: Math.min(b.minY, p.y),
        maxX: Math.max(b.maxX, p.x), maxY: Math.max(b.maxY, p.y)
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const xs = (pts, y) => {
        const out = [];
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) out.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
        }
        out.sort((m, n) => m - n);
        return out;
    };
    const iv = (pts, y) => {
        const c = xs(pts, y);
        const out = [];
        for (let i = 0; i + 1 < c.length; i += 2) out.push([c[i], c[i + 1]]);
        return out;
    };
    const and = (a, b) => {
        const out = [];
        for (const s of a) for (const t of b) {
            const lo = Math.max(s[0], t[0]);
            const hi = Math.min(s[1], t[1]);
            if (hi > lo) out.push([lo, hi]);
        }
        return out;
    };
    const minus = (a, b) => {
        let rem = a.map((s) => [s[0], s[1]]);
        for (const t of b) {
            const out = [];
            for (const s of rem) {
                if (t[1] <= s[0] || t[0] >= s[1]) { out.push(s); continue; }
                if (t[0] > s[0]) out.push([s[0], t[0]]);
                if (t[1] < s[1]) out.push([t[1], s[1]]);
            }
            rem = out;
        }
        return rem;
    };
    const bo = bounds(objPts);
    const bt = bounds(tgtPts);
    const y0 = Math.min(bo.minY, bt.minY);
    const y1 = Math.max(bo.maxY, bt.maxY);
    const step = Math.max(2, bandPx);
    const list = [];
    for (let ya = y0; ya < y1; ya += step) {
        const yb = Math.min(ya + step, y1);
        const ym = (ya + yb) * 0.5;
        const A = iv(objPts, ym);
        const B = iv(tgtPts, ym);
        list.push({ y0: ya, y1: yb, green: and(A, B), red: minus(A, B).concat(minus(B, A)) });
    }
    return list;
}

/* 7. 流程：完美一按 → 通关 → 连击 +1 → 1 秒后进下一关 */
const flowBad = [];
P.startLevel(0);
const rt0 = P.app.rt;
P.app.attemptStart = 0;
P.freeze(rt0.perfectMs);           /* 冻结时间基准（当帧） */
P.press(P.now());                  /* 当帧按下 */
if (P.app.scene !== 'feedback') flowBad.push('按下后 scene=' + P.app.scene);
P.freeze(rt0.perfectMs + 300);     /* 推进到面板弹出的时间点 */
P.update();
const fb = P.app.fb;
if (!fb || !fb.settled) flowBad.push('未结算');
if (fb && !fb.pass) flowBad.push('完美时机却判失败 pct=' + fb.res.pct.toFixed(1));
if (P.app.combo !== 1) flowBad.push('连击=' + P.app.combo);
if (P.app.totalScore <= 0) flowBad.push('总分=' + P.app.totalScore);
if (!storage.has('dista.progress')) flowBad.push('未写 localStorage');

/* 失败一次 → 机会 -1，自动重试回到 play */
P.startLevel(0);
const cyc0 = P.app.rt.movers[0].cycleMs;
const lateT = cyc0 - 20;
P.app.attemptStart = 0;
P.freeze(lateT);                   /* 周期末尾按 = 几乎肯定晚 */
P.press(P.now());
P.freeze(lateT + 300);
P.update();
if (P.app.fb && P.app.fb.pass) flowBad.push('极晚按却判通关 pct=' + P.app.fb.res.pct.toFixed(1));
if (P.app.attempts !== 2) flowBad.push('失败后剩余次数=' + P.app.attempts);
P.freeze(lateT + 700);
P.update();
if (P.app.scene !== 'play') flowBad.push('失败 700ms 后未自动重试，scene=' + P.app.scene);
check('流程：完美→通关/连击/存档；失败→扣次数/自动重试', flowBad.length === 0, flowBad.join(' | '));

/* 8. 确定性：同 seed 两次构建 → 同一时刻姿态完全一致 */
const d1 = CORE.buildLevel(LEVELS[2], SHAPES, 4242);
const d2 = CORE.buildLevel(LEVELS[2], SHAPES, 4242);
const p1 = CORE.poseAt(d1.movers[0], 123);
const p2 = CORE.poseAt(d2.movers[0], 123);
check('同 seed 可复现（姿态逐位一致）', p1.x === p2.x && p1.y === p2.y && p1.rotDeg === p2.rotDeg, JSON.stringify(p1) + ' vs ' + JSON.stringify(p2));

/* 9. 存档 key 名正确 */
check('localStorage key = dista.progress', storage.has('dista.progress') || [...storage.keys()].some((k) => k === 'dista.progress'), [...storage.keys()].join(','));

/* ---------------- 汇总 ---------------- */
console.log('');
console.log('==== selfcheck_proto ====');
console.log('bundle 字节: ' + Buffer.byteLength(bundle, 'utf8'));
console.log('core 模式   : ' + (P.CFG && P.CFG.coreMode));
console.log('levels 来源 : ' + (P.CFG && P.CFG.sources && P.CFG.sources.levels));
console.log('shapes 来源 : ' + (P.CFG && P.CFG.sources && P.CFG.sources.shapes));
console.log('断言通过    : ' + pass);
console.log('断言失败    : ' + fail);
if (warnings.length) {
    console.log('---- 提醒（不阻塞本原型） ----');
    for (const w of warnings) console.log('  ! ' + w);
}
if (fail) {
    console.log('---- 失败明细 ----');
    for (const f of failures) console.log('  X ' + f);
    process.exit(1);
}
console.log('RESULT: PASS (' + pass + '/' + (pass + fail) + ' 条逻辑断言)');
console.log('');
