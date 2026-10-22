#!/usr/bin/env node
/**
 * tools/autoplay.mjs —— CDP 自动试玩机：用**真实鼠标点击**驱动 headless Edge，逐关按「完美时机」
 *
 *   为什么要它：`?press=` / `?autoplay=1` 都靠页面内 setTimeout 自触发，无头下抖几十毫秒，
 *   而且不是真输入（走的是 doPress 而不是 pointerdown 事件链）。本工具从外部按**墙钟**计时，
 *   用 Input.dispatchMouseEvent 发真实按下，判定链与玩家手点完全同一条：pointerdown → handlePressAt → doPress。
 *
 * 用法
 *   node tools/autoplay.mjs                                  # L1–L60 各 1 次
 *   node tools/autoplay.mjs --levels=1,10,50 --repeat=3      # 抽查 3 关，每关连跑 3 次（验可复现）
 *   node tools/autoplay.mjs --levels=1-60 --tag=full         # 全量并给截图加后缀
 *   node tools/autoplay.mjs --headful                        # 看得见的窗口（排障用）
 *   node tools/autoplay.mjs --no-shot --no-diag              # 不截图、不跑预检（快）
 *
 * 参数
 *   --levels=1-60|1,5,9   关卡（默认 1-60）
 *   --repeat=N            每关跑几次（默认 1）；run 0 用主截图名，run>0 追加 _r{n}
 *   --out=<dir>           截图目录（默认 03_交付素材/autoplay）
 *   --json=<file>         结果 JSON（默认 <out>/_results.json）
 *   --tag=<str>           截图文件名后缀（重跑时用来保留上一轮截图）
 *   --port=9223           CDP 端口（**不要用 9222**：会和别的调试会话打架）
 *   --headful             非无头（默认 --headless=new）
 *   --no-warmup           不做「首击解锁音频」的预热点击（会把首击判成一次按下，见下）
 *   --no-shot / --no-diag / --keep-open
 *
 * ── 三个必须先知道的实现事实（本工具据此设计，改判定前请先读） ────────────────────
 * 1) **可玩入口是 `?start=N`，不是 `?screen=play&lvl=N`。**
 *    `?screen=play` 走 applyDebug() 的「截图分支」：它把 timeFreeze 钉在 cyc*frac 上
 *    （game.js applyDebug → `timeFreeze = cyc * frac`），时钟不走 ⇒ 点什么、什么时候点都是同一帧，
 *    只能看不能玩。真试玩是 v0.9.1 的 `?start=N`（startRun + `timeFreeze = null`）。
 *    本工具用 `?start=N`；`--diag` 会顺手把 `?screen=play` 的「时钟不走」实测一遍写进 JSON。
 * 2) **直链进关后的第一下点击会被吞。** handlePressAt 里 `_firstGesture = _unlocked && !app.audioGestureDone`
 *    （D-128）：`?start=N` 是"无手势开局"，第一次点击只用来解锁 AudioContext，`if (_firstGesture) return;`
 *    直接返回、不判。玩家从首页点进去不会遇到（首页那下已解锁），走试玩链接的玩家会遇到。
 *    本工具每关都新开页面 ⇒ 每关都必须先打一发预热点击，否则「完美时机」那一发会被吞掉。
 *    若 headless 里 AudioContext 起不来（unlock 返回 false），预热点击**会**被当真按下 → 本工具检测到
 *    就 `restartLevel()` 复位再来，并在结果里记 `warmupJudged: true`（这种情况说明无头与真浏览器路径不同）。
 * 3) **错拍关（phase2>0，L50/L60）必须按两次。** 第一次定格 ≈200ms 后解冻，且 `attemptStart` 被
 *    +DESYNC_FREEZE_MS 推后 ⇒ 第二次的完美时刻**必须解冻后重新读** `perfectPressClockMs(1)`，不能沿用开局算的值。
 *
 * 判定口径（只读，不参与修改）：CORE.judge / CORE.judgeNearest / duoVerdict，pct = 轮廓重合面积百分比。
 * 本工具只报告"点下去发生了什么"，不改任何玩法参数。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDGE = process.env.DISTA_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML = path.join(ROOT, '原型', 'dista_prototype.html');
const DEFAULT_OUT = path.join(ROOT, '03_交付素材', 'autoplay');
const CLICK = { x: 360, y: 640 };
const RATINGS = [
    { id: 'god', min: 95 }, { id: 'perfect', min: 80 }, { id: 'good', min: 60 }, { id: 'ok', min: 40 }, { id: 'fail', min: 0 }
];

/* ══════════════════════════ 0. 杂项 ══════════════════════════ */
const perf = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const n1 = (v) => (typeof v === 'number' && isFinite(v) ? String(Math.round(v * 10) / 10) : String(v));
const tierOf = (pct) => (RATINGS.find((r) => pct >= r.min) || RATINGS[RATINGS.length - 1]).id;

function parseArgs(argv) {
    const out = { levels: '1-60', repeat: 1, out: DEFAULT_OUT, json: null, tag: '', port: 9223, headful: false, warmup: true, shot: true, diag: true, keepOpen: false, verbose: false };
    for (const raw of argv) {
        const a = String(raw);
        if (!a.startsWith('--')) continue;
        const [k, ...rest] = a.slice(2).split('=');
        const v = rest.join('=');
        switch (k) {
            case 'levels': out.levels = v; break;
            case 'repeat': out.repeat = Math.max(1, parseInt(v, 10) || 1); break;
            case 'out': out.out = path.resolve(ROOT, v); break;
            case 'json': out.json = path.resolve(ROOT, v); break;
            case 'tag': out.tag = v; break;
            case 'port': out.port = parseInt(v, 10) || 9223; break;
            case 'headful': out.headful = true; break;
            case 'no-warmup': out.warmup = false; break;
            case 'no-shot': out.shot = false; break;
            case 'no-diag': out.diag = false; break;
            case 'keep-open': out.keepOpen = true; break;
            case 'verbose': out.verbose = true; break;
            default: console.warn('[warn] 未知参数 --' + k);
        }
    }
    if (!out.json) out.json = path.join(out.out, '_results.json');
    return out;
}

function parseLevels(spec) {
    const list = [];
    for (const part of String(spec).split(',')) {
        const p = part.trim();
        if (!p) continue;
        const m = p.match(/^(\d+)\s*-\s*(\d+)$/);
        if (m) {
            const a = Math.min(+m[1], +m[2]);
            const b = Math.max(+m[1], +m[2]);
            for (let i = a; i <= b; i++) list.push(i);
        } else if (/^\d+$/.test(p)) list.push(+p);
    }
    return [...new Set(list)].filter((n) => n >= 1 && n <= 60).sort((x, y) => x - y);
}

function sha1File(f) {
    const h = crypto.createHash('sha1');
    h.update(fs.readFileSync(f));
    return h.digest('hex');
}

function fileUrl(levelId, search) {
    const p = HTML.replace(/\\/g, '/');
    return 'file:///' + (p.startsWith('/') ? p.slice(1) : p) + '?' + search + '&lvl=' + levelId;
}

/* ══════════════════════════ 1. 极简 CDP 客户端（Node 24 自带 WebSocket） ══════════════════════════ */
class CDP {
    constructor(ws) {
        this.ws = ws;
        this.nextId = 0;
        this.pending = new Map();
        this.handlers = new Map();
        this.closed = false;
        ws.addEventListener('message', (ev) => {
            let msg;
            try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')); } catch (e) { return; }
            if (msg.id != null) {
                const p = this.pending.get(msg.id);
                if (!p) return;
                this.pending.delete(msg.id);
                if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
                else p.resolve(msg.result);
                return;
            }
            const hs = this.handlers.get(msg.method);
            if (hs) for (const h of hs.slice()) { try { h(msg.params); } catch (e) { /* 吃掉 */ } }
        });
        ws.addEventListener('close', () => {
            this.closed = true;
            for (const [, p] of this.pending) p.reject(new Error('WS 已关闭'));
            this.pending.clear();
        });
    }

    static async connect(url, timeoutMs = 12000) {
        const ws = new WebSocket(url);
        await new Promise((resolve, reject) => {
            const to = setTimeout(() => reject(new Error('WS 连接超时 ' + url)), timeoutMs);
            ws.addEventListener('open', () => { clearTimeout(to); resolve(); }, { once: true });
            ws.addEventListener('error', (e) => { clearTimeout(to); reject(new Error('WS 连接失败: ' + (e && e.message ? e.message : url))); }, { once: true });
        });
        return new CDP(ws);
    }

    send(method, params = {}, timeoutMs = 15000) {
        if (this.closed) return Promise.reject(new Error('CDP 已关闭: ' + method));
        return new Promise((resolve, reject) => {
            const id = ++this.nextId;
            const to = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP 超时 ' + method)); }, timeoutMs);
            this.pending.set(id, {
                resolve: (v) => { clearTimeout(to); resolve(v); },
                reject: (e) => { clearTimeout(to); reject(e); }
            });
            try { this.ws.send(JSON.stringify({ id, method, params })); } catch (e) { clearTimeout(to); reject(e); }
        });
    }

    on(method, fn) {
        if (!this.handlers.has(method)) this.handlers.set(method, []);
        this.handlers.get(method).push(fn);
        return () => {
            const hs = this.handlers.get(method) || [];
            const i = hs.indexOf(fn);
            if (i >= 0) hs.splice(i, 1);
        };
    }

    once(method, timeoutMs = 12000) {
        return new Promise((resolve, reject) => {
            let off = () => {};
            const to = setTimeout(() => { off(); reject(new Error('等待事件超时 ' + method)); }, timeoutMs);
            off = this.on(method, (p) => { clearTimeout(to); off(); resolve(p); });
        });
    }

    close() { try { this.ws.close(); } catch (e) { /* 吃掉 */ } }
}

async function fetchJson(url, timeoutMs = 2000) {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), timeoutMs);
    try {
        const r = await fetch(url, { signal: ac.signal });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.json();
    } finally { clearTimeout(to); }
}

/* ══════════════════════════ 2. Edge 起停 ══════════════════════════ */
async function launchEdge(opts, log) {
    if (!fs.existsSync(EDGE)) throw new Error('找不到 Edge: ' + EDGE);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dista_autoplay_'));
    const args = [
        '--remote-debugging-port=' + opts.port,
        '--user-data-dir=' + profile,
        '--window-size=720,1280',
        '--force-device-scale-factor=1',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-features=CalculateNativeWinOcclusion',
        '--mute-audio',
        '--hide-scrollbars',
        'about:blank'
    ];
    if (!opts.headful) args.unshift('--headless=new');
    log('启动 Edge：' + (opts.headful ? 'headful' : 'headless=new') + ' port=' + opts.port + ' profile=' + profile);
    const child = spawn(EDGE, args, { stdio: 'ignore', windowsHide: true });
    child.on('error', (e) => log('[edge] spawn error: ' + e.message));

    const base = 'http://127.0.0.1:' + opts.port;
    const t0 = perf();
    let version = null;
    while (perf() - t0 < 20000) {
        try {
            version = await fetchJson(base + '/json/version', 1200);
            if (version && version.webSocketDebuggerUrl) break;
        } catch (e) { /* 还没起来 */ }
        await sleep(120);
    }
    if (!version) { try { child.kill(); } catch (e) {} throw new Error('Edge CDP 端口没起来（' + base + '）'); }

    let target = null;
    for (let i = 0; i < 60 && !target; i++) {
        try {
            const list = await fetchJson(base + '/json/list', 1200);
            target = (list || []).find((t) => t.type === 'page');
        } catch (e) { /* 等 */ }
        if (!target) await sleep(100);
    }
    if (!target) { try { child.kill(); } catch (e) {} throw new Error('拿不到 page target（/json/list 为空）'); }

    return { child, profile, version, target, base };
}

async function shutdownEdge(ctx) {
    if (!ctx) return;
    try { await ctx.cdp.send('Browser.close', {}, 3000); } catch (e) { /* 可能已经关了 */ }
    try { ctx.cdp.close(); } catch (e) {}
    await sleep(300);
    try { if (ctx.child && !ctx.child.killed) ctx.child.kill(); } catch (e) {}
    await sleep(200);
    try { if (ctx.profile) fs.rmSync(ctx.profile, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { /* 无头残留文件锁时忽略 */ }
}

/* ══════════════════════════ 3. 页面求值 / 输入 ══════════════════════════ */
async function evalValue(cdp, expr, timeoutMs = 8000) {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false, includeCommandLineAPI: false }, timeoutMs);
    if (r && r.exceptionDetails) {
        const d = r.exceptionDetails;
        throw new Error('页面求值异常: ' + (d.exception && (d.exception.description || d.exception.value) || d.text || 'unknown'));
    }
    return r ? r.result.value : undefined;
}

async function click(cdp) {
    // mousePressed 才是被判的那一下（pointerdown → handlePressAt → doPress）
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: CLICK.x, y: CLICK.y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: CLICK.x, y: CLICK.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' });
}

async function capture(cdp, file) {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return fs.statSync(file).size;
}

/* ══════════════════════════ 4. 页面内状态快照（一段表达式，别拆开） ══════════════════════════ */
const STATE_EXPR = `(() => {
  const P = window.__PROTO__;
  if (!P || !P.app) return { ok: false };
  const a = P.app, fb = a.fb, rt = a.rt || {}, mv = rt.movers || [], d = a.def || {};
  const shp = P.shapes || {};
  const shName = (id) => (shp[id] && shp[id].name) ? shp[id].name : (id || null);
  const rate = (fb && fb.res && typeof fb.res.pct === 'number') ? fb.res.pct : null;
  const num = (x) => (typeof x === 'number' && isFinite(x)) ? x : null;
  return {
    ok: true,
    scene: a.scene, phase: a.phase, lvl: a.lvl, mode: a.mode, attempts: a.attempts,
    gestureDone: !!a.audioGestureDone,
    isDesync: (typeof P.isDesync === 'function') ? !!P.isDesync() : null,
    desyncPhase: (typeof P.desyncPhase === 'function') ? P.desyncPhase(d) : null,
    freezeMs: num(P.DESYNC_FREEZE_MS),
    timeLimitMs: a.timeLimitMs,
    now: num(P.now()),
    perfNow: (typeof performance !== 'undefined' && performance.now) ? performance.now() : null,
    clockFrozenNow: (() => { try { return Math.abs(P.now() - performance.now()) > 0.5; } catch (e) { return null; } })(),
    attemptStart: num(a.attemptStart),
    perfect0: (typeof P.perfectPressClockMs === 'function') ? num(P.perfectPressClockMs(0)) : null,
    perfect1: (mv.length > 1 && typeof P.perfectPressClockMs === 'function') ? num(P.perfectPressClockMs(1)) : null,
    frozen: Array.isArray(a.frozen) ? a.frozen.map(Boolean) : null,
    judgedCount: Array.isArray(a.desyncJudged) ? a.desyncJudged.length : 0,
    judgedArr: Array.isArray(a.desyncJudged) ? a.desyncJudged.map((x) => ({ moverIndex: x.moverIndex, pct: num(x.pct) })) : null,
    pressGlow: num(a.pressGlow),
    desyncPausedMs: num(a.desyncPausedMs),
    hasJudgeNearest: !!(P.CORE && typeof P.CORE.judgeNearest === 'function'),
    def: {
      id: d.id, name: d.name || null, variant: d.variant || null,
      phase2: (d.phase2 !== undefined ? d.phase2 : d.phase_2) || 0,
      passRate: (typeof d.passRate === 'number' ? d.passRate : 0.6),
      star3Rate: (typeof d.star3Rate === 'number' ? d.star3Rate : 0.93),
      cycleMs: num(d.cycleMs), turns: num(d.turns), season: num(d.season),
      shapeId: d.shapeId || null, shapeId2: d.shapeId2 || null,
      prop: shName(d.shapeId), prop2: shName(d.shapeId2)
    },
    movers: mv.map((m) => ({
      cycleMs: num(m.cycleMs), speedStage: num(m.speedStage),
      offsetMs: num(m.timing && m.timing.offsetMs),
      perfectMs: num(m.timing && m.timing.perfectMs)
    })),
    theory: {
      /* 单物体关用 judge（pct 直接可比）；双物体关 judge 会两个 mover 一起平均 → 必须用 judgeNearest 逐个看 */
      pctPerfect0: (() => { try { return (mv.length > 1) ? num(P.CORE.judgeNearest(rt, P.moverPerfectMs(0), [], 0).pct) : num(P.CORE.judge(rt, P.moverPerfectMs(0), 0).pct); } catch (e) { return null; } })(),
      pctPerfect1: (() => { try { return mv.length > 1 ? num(P.CORE.judgeNearest(rt, P.moverPerfectMs(1), [0], 0).pct) : null; } catch (e) { return null; } })()
    },
    fb: fb ? {
      revealed: !!fb.revealed, settled: !!fb.settled, pass: !!fb.pass, tier: fb.tier || null,
      pct: rate, deltaMs: num(fb.res && fb.res.timing && fb.res.timing.deltaMs),
      pressMs: num(fb.pressMs), t0: num(fb.t0), resolveAt: num(fb.resolveAt),
      verdict: (fb.res && fb.res.timing && fb.res.timing.verdict) || null,
      attemptsLeft: fb.attemptsLeft, stars: fb.stars, gain: fb.gain,
      desync: !!fb.desync, desyncDone: !!fb.desyncDone, moverIndex: (fb.moverIndex === undefined ? null : fb.moverIndex),
      timeout: !!fb.timeout
    } : null,
    error: document.documentElement.getAttribute('data-js-error') || null,
    errbar: (() => { const e = document.getElementById('errbar'); return e && e.textContent ? String(e.textContent).slice(0, 200) : null; })(),
    view: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    canvas: (() => { const c = document.getElementById('cv'); return c ? { w: c.width, h: c.height } : null; })()
  };
})()`;

const state = (cdp) => evalValue(cdp, STATE_EXPR);

async function waitFor(cdp, pred, timeoutMs, intervalMs = 20) {
    const t0 = perf();
    let last = null;
    while (perf() - t0 < timeoutMs) {
        last = await state(cdp);
        if (last && last.ok && pred(last)) return last;
        await sleep(intervalMs);
    }
    return null;
}

/** 量一下无头下的 rAF 节奏：帧太长会让"按一下就闪过去"的冻结状态被轮询漏掉 */
async function measureFps(cdp, windowMs = 500) {
    const expr = `new Promise((resolve) => {
        let n = 0; const t0 = performance.now();
        const step = () => { n += 1; if (performance.now() - t0 < ${windowMs}) requestAnimationFrame(step); else resolve(n / ((performance.now() - t0) / 1000)); };
        requestAnimationFrame(step);
    })`;
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, windowMs + 8000);
    return r && r.result ? Math.round(r.result.value * 10) / 10 : null;
}

/* ══════════════════════════ 5. 时钟同步 + 到点开火 ══════════════════════════ */
/**
 * 页面 performance.now() 与 Node performance.now() 的偏移（取 RTT 最小的一次，NTP 式）。
 * 游戏时钟 now() 在 ?start=N 下就是 performance.now()，所以拿它当"墙钟 ms"。
 */
async function syncClock(cdp, samples = 9) {
    let best = null;
    for (let i = 0; i < samples; i++) {
        const t0 = perf();
        const p = await evalValue(cdp, 'performance.now()');
        const t1 = perf();
        const rtt = t1 - t0;
        const off = p - (t0 + t1) / 2;
        if (!best || rtt < best.rtt) best = { rtt, off, at: t1 };
        if (i < samples - 1) await sleep(25);
    }
    return best;
}

/**
 * 等到 Node 时钟 == nodeTime（长时间用 setTimeout，最后 20ms 自旋）。
 * 自旋会卡住 Node 事件循环 —— 这里的调用点故意不依赖这期间到达的 WS 响应。
 */
async function waitUntilNode(nodeTime) {
    const gap = nodeTime - perf();
    if (gap > 20) await sleep(gap - 20);
    while (perf() < nodeTime) { /* spin */ }
    return perf();
}

/**
 * 在「页面时钟 ≈ pageTarget」时把一次真实点击送到渲染进程。
 *
 * 为什么不直接在 Node 里掐表点：headless 下渲染主线程常被 rAF 占着，
 * 点击从 CDP 送到渲染进程后还要等当前帧跑完才被处理 —— 实测系统偏差 +17…+56ms，
 * 而且随关卡画量变化，靠固定提前量补不回来。
 *
 * 做法（自旋屏障）：先让**页面自己**自旋到目标时刻（while(performance.now()<t){}），
 * 再把点击发过去。点击到达时主线程正卡在自旋里 → 排在该 task 之后 →
 * 自旋一结束立刻被处理，于是"按下时刻"由页面时钟决定，与 Node 抖动无关。
 * 只要点击落在 [自旋开始, 目标] 这个窗口里，落点就都是目标时刻。
 *
 * 窗口宽度就是可靠性：无头下 rAF 只有 ~27fps（实测），一帧 40ms、偶尔 100ms+，
 * 自旋命令本身也会被这一帧挡住。所以 spinLead 要给到 150ms（挡得住 100ms 的长帧），
 * pressLead 40ms（点击在自旋中段到达）。首轮用 70/25 时 L12 晚了 107ms、L41 晚了 47ms —— 就是长帧吃掉了自旋。
 */
async function firePressAt(cdp, ctx, pageTarget, clockOff) {
    const spinAt = pageTarget - ctx.spinLead;
    await waitUntilNode(spinAt - clockOff);
    const endAt = pageTarget - ctx.spinEndOffset;
    const expr = '(()=>{var t=' + endAt + ';var s=performance.now();while(performance.now()<t){}return performance.now()-s;})()';
    cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }, 4000).catch(() => {});
    await waitUntilNode(pageTarget - clockOff - ctx.pressLead);
    await click(cdp);
}

/* ══════════════════════════ 6. 单关流程 ══════════════════════════ */
function shotName(opts, id, pass, runIdx) {
    const tag = opts.tag ? '_' + opts.tag : '';
    const r = runIdx > 0 ? '_r' + runIdx : '';
    return 'L' + String(id).padStart(2, '0') + '_' + (pass ? 'pass' : 'fail') + r + tag + '.png';
}

/**
 * 跑一关。返回一条 trial 记录（绝不抛异常，异常也记成一条记录，报告里才能看到"哪关坏了"）。
 */
async function runTrial(cdp, opts, levelId, runIdx, ctx) {
    const t0 = perf();
    const rec = {
        level: levelId, run: runIdx, ok: false, outcome: 'unknown', pass: null, tier: null, pct: null,
        deltaMs: null, theory: null, presses: [], shot: null, shotBytes: 0, ms: 0,
        warmupJudged: false, warmupSwallowed: false, retries: 0, anomalies: [], errors: []
    };
    const mark = (a) => { if (!rec.anomalies.includes(a)) rec.anomalies.push(a); };

    try {
        /* 6.1 新开页面：?start=N（真试玩入口），每关一个干净页面 */
        const url = fileUrl(levelId, 'start=' + levelId);
        rec.url = url;
        const loaded = cdp.once('Page.loadEventFired', 15000);
        await cdp.send('Page.navigate', { url }, 15000);
        await loaded;

        let st = await waitFor(cdp, (s) => s.scene === 'play' || s.scene === 'feedback', 6000);
        if (!st) { mark('页面没进 play'); rec.outcome = 'no-scene'; rec.errors.push('6s 内没到 play'); return rec; }
        rec.def = st.def; rec.movers = st.movers; rec.isDesync = st.isDesync; rec.theory = st.theory;
        if (st.error) { mark('js-error'); rec.errors.push(st.error); }
        if (st.def && st.def.id !== levelId) { mark('关号不符'); rec.errors.push('期望 L' + levelId + '，页面是 L' + st.def.id); }

        /* 6.2 预热点击：直链进关第一下只解锁音频、不判（D-128） */
        if (opts.warmup && !st.gestureDone) {
            await click(cdp);
            const after = await state(cdp);
            if (after && after.ok && after.fb) {
                rec.warmupJudged = true;               // 无头下音频没解锁：这一下被当真按下了
                mark('预热点击被判定');
                const settled = await waitFor(cdp, (s) => !!s.fb && s.fb.revealed, 3000);
                if (!settled) { mark('预热后卡在 feedback'); rec.outcome = 'stuck'; return rec; }
                await evalValue(cdp, 'window.__PROTO__.restartLevel(), true');
                st = await waitFor(cdp, (s) => s.scene === 'play' && !s.fb, 3000);
                if (!st) { mark('预热后回不到 play'); rec.outcome = 'stuck'; return rec; }
            } else {
                rec.warmupSwallowed = true;           // 预期路径：第一下被吞，不扣次数
            }
        }

        /* 6.3/6.4 按下：目标是 perfectPressClockMs(idx) + k*cycle（加整周期不改变相位，只把时间点推远） */
        const pressOnce = async (idx) => {
            // 每次按下前重测一遍页面↔Node 的时钟偏移：rAF 满载时单次 RTT 会到 20ms，隔关复用旧偏移会偏
            const clk = await syncClock(cdp, 5);
            if (!rec.clock) rec.clock = { rttMin: clk.rtt, rttMs: [] };
            rec.clock.rttMs.push(Math.round(clk.rtt * 10) / 10);
            if (clk.rtt < rec.clock.rttMin) rec.clock.rttMin = clk.rtt;
            const s0 = await state(cdp);
            if (!s0 || !s0.ok) throw new Error('读不到 __PROTO__');
            const cyc = (s0.movers && s0.movers[0] && s0.movers[0].cycleMs) || s0.def.cycleMs || 2000;
            const perfect = idx === 0 ? s0.perfect0 : s0.perfect1;
            if (!isFinite(perfect)) throw new Error('perfectPressClockMs(' + idx + ') 不是数字: ' + perfect);
            const now = s0.now;
            const minLead = idx === 0 ? 400 : 320;                   // 留出余量：别在"读完就算"的同一毫秒开火
            const k = Math.max(0, Math.ceil((now + minLead - perfect) / cyc));
            const target = perfect + k * cyc;

            await firePressAt(cdp, ctx, target, clk.off);

            /* 等"这一下被判了"。不能只看 scene==='feedback'：错拍关的冻结只有 200ms，
               无头下 rAF 可能慢到一帧 100ms+，轮询会从缝里漏过去（实测漏了两次）。
               所以按**持久状态**判：单物体关看 app.fb（doPress 里同步建的），
               错拍关看 desyncJudged 条数（解冻后仍留着）。 */
            const judged0 = s0.judgedCount || 0;
            const got = await waitFor(cdp, (s) => (!!s.fb) || s.scene === 'feedback' || (s.judgedCount || 0) > judged0, 900);
            if (!got) {
                rec.retries += 1;
                mark('点击没被吃到');
                const after = await state(cdp);
                rec.missState = after && {
                    scene: after.scene, phase: after.phase, now: after.now, attemptStart: after.attemptStart,
                    frozen: after.frozen, judged: after.judgedCount, pressGlow: after.pressGlow,
                    gestureDone: after.gestureDone, hasJudgeNearest: after.hasJudgeNearest,
                    clockFrozenNow: after.clockFrozenNow, error: after.error, errbar: after.errbar,
                    target, pressTargetPage: target
                };
                return null;
            }
            /* 取这一下的 pct / Δ：fb 还在就直接读；已经解冻回 play 的，用 desyncJudged + pressGlow 复原 */
            const fb = got.fb || {};
            let pct = fb.pct, tier = fb.tier, deltaMs = fb.deltaMs, moverIndex = fb.moverIndex, verdict = fb.verdict;
            if (typeof pct !== 'number') {
                const rec2 = await state(cdp);
                const judged = Array.isArray(rec2 && rec2.judgedArr) ? rec2.judgedArr : null;
                const lastJudged = judged && judged.length ? judged[judged.length - 1] : null;
                if (lastJudged) {
                    pct = lastJudged.pct;
                    moverIndex = lastJudged.moverIndex;
                    tier = tierOf(pct);
                    const pressGlow = (rec2 && rec2.pressGlow) || got.pressGlow;
                    const cyc2 = (rec2.movers && rec2.movers[0] && rec2.movers[0].cycleMs) || cyc;
                    const perfMs = (rec2.movers && rec2.movers[moverIndex] && rec2.movers[moverIndex].perfectMs) || 0;
                    const pressMs = (((pressGlow - s0.attemptStart) % cyc2) + cyc2) % cyc2;
                    let d = (pressMs - perfMs) % cyc2;
                    if (d > cyc2 / 2) d -= cyc2;
                    if (d < -cyc2 / 2) d += cyc2;
                    deltaMs = d;
                    verdict = Math.abs(d) <= 16.7 ? 'onTime' : d < 0 ? 'early' : 'late';
                }
            }
            const p = {
                idx, target, deltaMs, pct, tier, moverIndex, verdict,
                pressClock: fb.pressMs, t0: fb.t0, frozen: got.frozen, judged: got.judgedCount,
                reconstructed: typeof fb.pct !== 'number'
            };
            rec.presses.push(p);
            // 自适应：晚到了就把自旋结束点往前挪（spinEndOffset += 0.5*err）
            if (typeof deltaMs === 'number') {
                ctx.spinEndOffset = clamp(ctx.spinEndOffset + 0.5 * clamp(deltaMs, -30, 30), -10, 12);
                if (Math.abs(deltaMs) > 12) {
                    // 长帧把自旋挤掉了：把屏障加宽再试（这是工具自保，不是判定口径）
                    ctx.spinLead = clamp(ctx.spinLead + 40, 150, 260);
                    ctx.pressLead = clamp(ctx.pressLead + 10, 40, 80);
                }
                if (Math.abs(deltaMs) > 20) mark('点击时间屏障失效（工具噪声）');
            }
            return got;
        };

        let got = await pressOnce(0);
        if (!got) {
            // 一次重试（下一周期再打一发），仍失败就记异常退出
            got = await pressOnce(0);
            if (!got) { mark('点击两次都没被吃到'); rec.outcome = 'no-press'; return rec; }
        }

        /* 6.5 错拍关：等解冻 → 重读第二次的完美时刻 → 第二次按下 */
        if (st.isDesync) {
            const backToPlay = await waitFor(cdp, (s) => s.scene === 'play' && !s.fb, Math.max(1500, (st.freezeMs || 200) * 4));
            if (!backToPlay) { mark('第一次定格后没解冻'); rec.outcome = 'stuck'; return rec; }
            const got2 = await pressOnce(1);
            if (!got2) {
                mark('第二次点击没被吃到');
                rec.outcome = 'no-press-2';
                return rec;
            }
        }

        /* 6.6 等结算面板（fb.revealed） */
        const revealed = await waitFor(cdp, (s) => !!s.fb && s.fb.revealed === true, 4000, 16);
        if (!revealed) {
            const stuck = await state(cdp);
            mark('卡在 feedback 不结算');
            if (stuck && stuck.fb && stuck.fb.desync) mark('错拍冻结没走完');
            rec.outcome = 'stuck';
            rec.debug = { scene: stuck && stuck.scene, phase: stuck && stuck.phase, fb: stuck && stuck.fb };
            return rec;
        }
        const fb = revealed.fb;
        rec.pass = !!fb.pass;
        rec.tier = fb.tier;
        rec.pct = fb.pct;
        rec.deltaMs = fb.deltaMs;
        rec.stars = fb.stars;
        rec.attemptsLeft = fb.attemptsLeft;
        rec.outcome = fb.pass ? 'pass' : 'fail';

        /* 6.7 截图（面板刚滑出就拍，别等 autoNext 把场景带走） */
        if (opts.shot) {
            const name = shotName(opts, levelId, rec.pass, runIdx);
            const file = path.join(opts.out, name);
            rec.shot = name;
            rec.shotBytes = await capture(cdp, file);
            if (rec.shotBytes < 5000) mark('截图偏小');
        }

        /* 6.8 程序化一致性检查（代替人眼核对 HUD） */
        const passRate = revealed.def.passRate;
        const star3 = revealed.def.star3Rate;
        const allFrozen = Array.isArray(revealed.frozen) ? revealed.frozen.every(Boolean) : null;
        if (st.isDesync) rec.desyncAllFrozen = allFrozen;
        if (typeof rec.pct === 'number') {
            /* 错拍关的评级走 duoVerdict：没过关时会把 pct 压到 passRate 以下再取档（所以 tier='fail'）
               —— 这里必须照抄那条口径，否则会把正确实现误判成"评级与 pct 不符" */
            const effPct = (st.isDesync && !(allFrozen && rec.pct >= passRate * 100))
                ? Math.min(rec.pct, passRate * 100 - 1e-9)
                : rec.pct;
            const expectTier = tierOf(effPct);
            if (expectTier !== rec.tier) { mark('评级与 pct 不符'); rec.errors.push('tier=' + rec.tier + ' 但 pct=' + n1(rec.pct) + (effPct !== rec.pct ? '(按 duoVerdict 压到 ' + n1(effPct) + ')' : '') + ' 应=' + expectTier); }
            const expectPass = rec.pct >= passRate * 100 && (!st.isDesync || allFrozen === true);
            if (expectPass !== rec.pass) { mark('pass 与 pct/passRate 不符'); rec.errors.push('pass=' + rec.pass + ' 但 pct=' + n1(rec.pct) + ' vs 门槛 ' + n1(passRate * 100) + (st.isDesync ? '；全定格=' + allFrozen : '')); }
            if (rec.pass && !(rec.stars > 0)) mark('过了但 0 星');
            if (!rec.pass && rec.stars > 0) mark('没过却有星');
            if (rec.tier === 'god' && rec.pct < 95) mark('god 但 pct<95');
            if (rec.pass && rec.pct >= star3 * 100 && rec.stars !== 3) mark('pct 达三星线但不是三星');
        }
        if (fb.timeout) mark('超时结算');
        if (st.isDesync) {
            if (rec.presses.length >= 2 && allFrozen === false) mark('两次按了仍没全定格');
            if (rec.presses.length >= 2 && allFrozen && !rec.pass) mark('两次都定格且都判定，仍 fail');
            rec.pressMovers = rec.presses.map((p) => p.moverIndex);
            if (rec.presses.length >= 2 && rec.pressMovers[0] === rec.pressMovers[1]) mark('两次定格到同一个物体');
        }
        if (revealed.error) mark('js-error');
    } catch (e) {
        rec.errors.push(String(e && e.message ? e.message : e));
        rec.outcome = rec.outcome === 'unknown' ? 'error' : rec.outcome;
        if (!rec.anomalies.length) rec.anomalies.push('工具异常');
    } finally {
        rec.ms = Math.round(perf() - t0);
        rec.ok = rec.outcome === 'pass' || rec.outcome === 'fail';
    }
    return rec;
}

/* ══════════════════════════ 7. 预检：把「文档说的入口」实测一遍 ══════════════════════════ */
async function diagScreenPlay(cdp) {
    const out = { note: '?screen=play&lvl=N 是截图冻结分支：timeFreeze 被钉住 → 时钟不走、点击时刻与画面无关' };
    try {
        const url = fileUrl(1, 'screen=play');
        out.url = url;
        const loaded = cdp.once('Page.loadEventFired', 15000);
        await cdp.send('Page.navigate', { url }, 15000);
        await loaded;
        const s1 = await waitFor(cdp, (s) => s.scene === 'play' || s.scene === 'home', 6000);
        await sleep(450);
        const s2 = await state(cdp);
        out.now1 = s1 && s1.now;
        out.now2 = s2 && s2.now;
        out.clockFrozen = !!(s1 && s2 && s1.now === s2.now);
        out.scene = s2 && s2.scene;
        out.gestureDoneBefore = s2 && s2.gestureDone;
        // 冻结点上真点两下（第一下可能只解锁音频）：看它判在什么时刻 —— 证明「什么时候点都判在冻结帧」
        await click(cdp);
        await sleep(60);
        await click(cdp);
        const after = await waitFor(cdp, (s) => !!s.fb, 1500);
        out.pressJudged = !!(after && after.fb);
        out.pressClock = after && after.fb && after.fb.pressMs;
        out.frozenClock = s2 && s2.now;
        out.pressAtFrozenFrame = !!(after && after.fb && Math.abs(out.pressClock - out.frozenClock) < 0.5);
        out.tier = after && after.fb && after.fb.tier;
        out.pct = after && after.fb && after.fb.pct;
    } catch (e) {
        out.error = String(e && e.message ? e.message : e);
    }
    return out;
}

/** 顺手验一下任务书里提到的 `?autoplay=1&press=0.5`（页面内 setTimeout 自动按一次）到底有没有生效 */
async function diagAutoplay(cdp) {
    const out = { note: '?autoplay=1 分支要求 app.scene===\'play\'，但无 ?screen= 时 applyDebug 走首页开场 → 观察它是否真的按过一次' };
    try {
        const url = fileUrl(1, 'autoplay=1&press=0.5');
        out.url = url;
        const loaded = cdp.once('Page.loadEventFired', 15000);
        await cdp.send('Page.navigate', { url }, 15000);
        await loaded;
        await sleep(2200);                       // cyc*0.5 ≈ 1.6s 后应触发
        const s = await state(cdp);
        out.scene = s && s.scene;
        out.lvl = s && s.lvl;
        out.pressGlow = s && s.pressGlow;
        out.fb = s && s.fb ? { pct: s.fb.pct, tier: s.fb.tier, revealed: s.fb.revealed } : null;
        out.judgedOrNot = !!(s && s.fb);
    } catch (e) {
        out.error = String(e && e.message ? e.message : e);
    }
    return out;
}

/* ══════════════════════════ 8. 主流程 ══════════════════════════ */
async function main() {
    const opts = parseArgs(process.argv.slice(2));
    const levels = parseLevels(opts.levels);
    if (!levels.length) throw new Error('--levels 解析不出关卡: ' + opts.levels);
    if (!fs.existsSync(HTML)) throw new Error('找不到原型产物: ' + HTML + '（先 node tools/build_proto.mjs）');
    fs.mkdirSync(opts.out, { recursive: true });

    const log = (m) => console.log(m);
    const htmlHash = sha1File(HTML);
    const htmlStat = fs.statSync(HTML);
    const meta = {
        startedAt: new Date().toISOString(),
        levels: levels,
        repeat: opts.repeat,
        edge: EDGE,
        headless: !opts.headful,
        click: CLICK,
        html: { path: path.relative(ROOT, HTML).replace(/\\/g, '/'), sha1: htmlHash, bytes: htmlStat.size, mtime: htmlStat.mtime.toISOString() },
        node: process.version,
        platform: os.platform() + ' ' + os.release()
    };
    log('原型产物 sha1=' + htmlHash.slice(0, 12) + '  ' + htmlStat.size + 'B  mtime=' + htmlStat.mtime.toISOString());
    log('关卡：' + levels.join(',') + '  每关 ' + opts.repeat + ' 次  截图 → ' + path.relative(ROOT, opts.out));

    let ctx = null;
    const trials = [];
    const preflight = {};
    try {
        ctx = await launchEdge(opts, log);
        const cdp = await CDP.connect(ctx.target.webSocketDebuggerUrl);
        ctx.cdp = cdp;
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
        // headless=new 的 --window-size 会把窗口边框算进去（实测 680×1149），这里强制成设计尺寸 720×1280@1
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: 720, height: 1280, deviceScaleFactor: 1, mobile: false,
            screenWidth: 720, screenHeight: 1280, screenOrientation: { type: 'portraitPrimary', angle: 0 }
        });
        log('Edge ' + (ctx.version.Browser || '?') + '  target=' + ctx.target.id);

        // 视口自检：点击坐标 (360,640) 依赖 720×1280@dpr1
        const probe = await evalValue(cdp, '({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, ua: navigator.userAgent })');
        preflight.viewport = probe;
        if (!(probe.w === 720 && probe.h === 1280)) log('[warn] 视口不是 720×1280：' + probe.w + '×' + probe.h);
        else log('视口 = 720×1280 dpr=' + probe.dpr);

        if (opts.diag) {
            preflight.screenPlay = await diagScreenPlay(cdp);
            const sp = preflight.screenPlay;
            log('预检 ?screen=play：时钟' + (sp.clockFrozen ? '不走（冻结截图分支）' : '在走') +
                '；冻结时点击 ' + (sp.pressJudged ? ('被判 tier=' + sp.tier + ' pct=' + n1(sp.pct) + '，按下时刻=' + n1(sp.pressClock) + (sp.pressAtFrozenFrame ? ' = 冻结帧' : ' ≠ 冻结帧')) : '没被判'));
            preflight.fps = await measureFps(cdp);
            log('预检 无头 rAF：' + preflight.fps + ' fps（帧越长，"按一下就闪过"的状态越容易被轮询漏掉）');
            preflight.autoplay = await diagAutoplay(cdp);
            const ap = preflight.autoplay;
            log('预检 ?autoplay=1&press=0.5：scene=' + (ap.scene || '?') + ' lvl=' + (ap.lvl === undefined ? '?' : ap.lvl) +
                ' 是否判过=' + (ap.judgedOrNot ? '是' : '否') + '（pressGlow=' + n1(ap.pressGlow) + '）');
        }

        const total = levels.length * opts.repeat;
        let done = 0;
        if (opts.diag) { preflight.fpsOnLevel = await measureFps(cdp); log('预检 关卡页 rAF：' + preflight.fpsOnLevel + ' fps'); }
        for (let runIdx = 0; runIdx < opts.repeat; runIdx++) {
            for (const lv of levels) {
                const rec = await runTrial(cdp, opts, lv, runIdx, { spinLead: 150, pressLead: 40, spinEndOffset: 0.4 });
                trials.push(rec);
                done += 1;
                const tagTxt = rec.ok ? rec.outcome : ('[' + rec.outcome + ']');
                log(
                    '[' + done + '/' + total + '] L' + String(lv).padStart(2, '0') +
                    (opts.repeat > 1 ? ' r' + runIdx : '') + '  ' + tagTxt +
                    '  tier=' + (rec.tier || '-') + '  pct=' + (typeof rec.pct === 'number' ? n1(rec.pct) : '-') +
                    '  Δ=' + (typeof rec.deltaMs === 'number' ? (rec.deltaMs > 0 ? '+' : '') + n1(rec.deltaMs) + 'ms' : '-') +
                    '  ' + rec.ms + 'ms' +
                    (rec.warmupJudged ? '  [预热被判定]' : '') +
                    (rec.anomalies.length ? '  ⚠ ' + rec.anomalies.join(' / ') : '')
                );
                if (opts.verbose && rec.errors.length) for (const e of rec.errors) log('        · ' + e);
            }
        }

        const htmlHashEnd = sha1File(HTML);
        meta.htmlUnchangedDuringRun = htmlHashEnd === htmlHash;

        /* 汇总 */
        const first = trials.filter((t) => t.run === 0);
        const passN = first.filter((t) => t.outcome === 'pass').length;
        const failN = first.filter((t) => t.outcome === 'fail').length;
        const badN = first.filter((t) => !t.ok).length;
        const tierCount = {};
        for (const t of first) if (t.tier) tierCount[t.tier] = (tierCount[t.tier] || 0) + 1;
        const deltas = trials.map((t) => t.deltaMs).filter((x) => typeof x === 'number').sort((a, b) => a - b);
        const abs = deltas.map(Math.abs).sort((a, b) => a - b);
        const pctl = (arr, q) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(q * (arr.length - 1)))] : null);
        const summary = {
            trials: trials.length,
            pass: passN, fail: failN, notOk: badN,
            tierCount,
            timing: {
                samples: deltas.length, meanAbsMs: abs.length ? Math.round(abs.reduce((a, b) => a + b, 0) / abs.length * 10) / 10 : null,
                p50AbsMs: abs.length ? Math.round(pctl(abs, 0.5) * 10) / 10 : null,
                p95AbsMs: abs.length ? Math.round(pctl(abs, 0.95) * 10) / 10 : null,
                minMs: deltas.length ? deltas[0] : null, maxMs: deltas.length ? deltas[deltas.length - 1] : null
            },
            failLevels: first.filter((t) => t.outcome === 'fail').map((t) => t.level),
            notOkLevels: first.filter((t) => !t.ok).map((t) => t.level)
        };

        const outJson = { meta, preflight, summary, trials };
        fs.mkdirSync(path.dirname(opts.json), { recursive: true });
        fs.writeFileSync(opts.json, JSON.stringify(outJson, null, 2), 'utf8');

        log('');
        log('── 汇总 ── pass ' + passN + ' / fail ' + failN + ' / 工具异常 ' + badN + '（共 ' + trials.length + ' 次按下轮次）');
        log('评级分布：' + Object.entries(tierCount).map(([k, v]) => k + '=' + v).join('  '));
        log('点击精度：|Δ| 均值 ' + summary.timing.meanAbsMs + 'ms  p50 ' + summary.timing.p50AbsMs + 'ms  p95 ' + summary.timing.p95AbsMs + 'ms');
        if (summary.failLevels.length) log('fail 关：' + summary.failLevels.join(', '));
        if (summary.notOkLevels.length) log('工具异常关：' + summary.notOkLevels.join(', '));
        const withAnomalies = trials.filter((t) => t.anomalies.length);
        if (withAnomalies.length) {
            log('异常标记：');
            for (const t of withAnomalies) log('  L' + t.level + (t.run ? ' r' + t.run : '') + ' → ' + t.anomalies.join(' / ') + (t.errors.length ? '  (' + t.errors.join('; ') + ')' : ''));
        }
        log('结果 JSON：' + path.relative(ROOT, opts.json));
    } finally {
        if (ctx && !opts.keepOpen) await shutdownEdge(ctx);
        else if (ctx && opts.keepOpen) console.log('[keep-open] 浏览器留着，端口 ' + opts.port + '；结果已写盘');
    }
    return 0;
}

main().then((code) => process.exit(code || 0)).catch((e) => {
    console.error('[autoplay] 失败：' + (e && e.stack ? e.stack : e));
    process.exit(1);
});
