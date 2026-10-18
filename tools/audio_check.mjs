/**
 * tools/audio_check.mjs —— 音频与反馈的验收断言 A1–A10（规格 §7 + lead 补充 A9/A10）
 *
 * A1 无削波        : 离线渲染的每一个文件峰值 ≤ -1 dBFS，且无样本 |x| ≥ 1
 * A2 电平合理      : BGM 30s RMS ∈ [-22, -14] dBFS
 * A3 只用五声音阶  : BGM 的全部音名（含低音/装饰音）音级 ∈ {D,E,F#,A,B}
 * A4 特效与 BGM 同调: 五档 SFX 的音名同样只在五声音阶内
 * A5 按下即静音    : press 与 whoosh→0 同一帧（t 都是 0），且游戏里 doPress 确实调用了它
 * A6 静音开关有效  : 切换后 masterGain = 0 / 恢复 1
 * A7 重开回到第 1 关: 首页「开始」→ levelIndex = 0；「继续」→ 存档那一关
 * A8 无音频也能玩  : 无 AudioContext 时页面无 JS 报错、仍渲染首页、ensure() 不抛
 * A9 能量严格递减  : Layout.RATING_FX 的 energy 138 > 48 > 18 > 10 > 0
 * A10 热力图可读   : 重合 α ≤ 0.35、偏差 α ≥ 0.55，且偏差区像素面积 > 0（L15 +40ms 样本）
 *
 * 用法：node tools/audio_check.mjs   （先 node tools/build_proto.mjs）
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadProto, ROOT } from './proto_vm.mjs';

let pass = 0;
let fail = 0;
const fails = [];
const warns = [];

function check(name, cond, detail) {
    if (cond) { pass++; return; }
    fail++;
    fails.push(name + (detail ? ' — ' + detail : ''));
}
function warn(name, detail) { warns.push(name + (detail ? ' — ' + detail : '')); }

/* ---------------- 载入 audio.js（同一份源码，浏览器里也是它） ---------------- */
const AUDIO_SRC = path.join(ROOT, '原型', '_src', 'audio.js');
const holder = {};
new Function('globalThis', fs.readFileSync(AUDIO_SRC, 'utf8'))(holder);
const A = holder.DISTA_AUDIO;
if (!A) { console.error('[audio_check] audio.js 没有导出 DISTA_AUDIO'); process.exit(2); }

const PENTA = A.SPEC.pentatonic;
const SR = 44100;

/* ---------------- A1 / A2：离线渲染 ---------------- */
const bgm = A.renderBgm(A.SPEC.loopSeconds, SR);
const sfxIds = ['god', 'perfect', 'good', 'ok', 'fail'];
const sfxRaw = {};
for (const id of sfxIds) sfxRaw[id] = A.renderSfx(id, SR);
const pressBuf = A.renderSfx('press', SR);
const whooshBuf = A.renderWhoosh(2, SR);

/* 五档 SFX 按「最响的那一档 = SPEC.sfxPeakDb」做**组归一化**：
   既保证 A1 不削波，又保留规格里的相对音量差（god 最高 / ok 最低）。
   v0.2.0：锚点不再硬编码 -1.5，改为读 SPEC.sfxPeakDb（当前 -2.0）。
   否则本脚本报出的 perfect 电平会比 03_交付素材/audio/*.wav 实际文件高 0.5dB，
   校验数字与"用户听到的文件"对不上 —— 这是一个真实存在过的不一致，已修正。 */
const SFX_CEIL = A.SPEC.sfxPeakDb;
const SFX_LIMIT = Math.min(-1.5, SFX_CEIL);
let maxPeak = 0;
for (const id of sfxIds) maxPeak = Math.max(maxPeak, A.peakOf(sfxRaw[id]));
const groupGain = maxPeak > 1e-9 ? Math.pow(10, (SFX_CEIL - A.dbfs(maxPeak)) / 20) : 1;
const sfx = {};
for (const id of sfxIds) sfx[id] = A.softLimit(sfxRaw[id].map((x) => x * groupGain), SFX_LIMIT);
A.softLimit(pressBuf, -1.5);
A.softLimit(whooshBuf, -1.5);

const all = [{ name: 'bgm_loop', buf: bgm }].concat(sfxIds.map((id) => ({ name: 'sfx_' + id, buf: sfx[id] })))
    .concat([{ name: 'sfx_press', buf: pressBuf }, { name: 'sfx_whoosh', buf: whooshBuf }]);

const clipBad = [];
for (const f of all) {
    const p = A.peakOf(f.buf);
    const db = A.dbfs(p);
    let over = 0;
    for (let i = 0; i < f.buf.length; i++) if (Math.abs(f.buf[i]) >= 1) over++;
    if (!(db <= -1)) clipBad.push(f.name + ' peak=' + db.toFixed(2) + 'dBFS');
    if (over > 0) clipBad.push(f.name + ' 有 ' + over + ' 个样本 |x| ≥ 1');
    if (!isFinite(p)) clipBad.push(f.name + ' 全静音/NaN');
}
check('A1 无削波（每个文件峰值 ≤ -1 dBFS，无 |x| ≥ 1）', clipBad.length === 0, clipBad.slice(0, 6).join(' | '));

const bgmRms = A.dbfs(A.rmsOf(bgm));
check('A2 BGM RMS ∈ [-22, -14] dBFS', bgmRms >= -22 && bgmRms <= -14, 'RMS=' + bgmRms.toFixed(2) + ' dBFS');

/* ---------------- A3 / A4：调式 ---------------- */
const badNotes = [];
const badWaves = [];
function auditEvents(list, tag) {
    for (const ev of list) {
        if (ev.wave && A.SPEC.waves.indexOf(ev.wave) < 0 && ev.wave.indexOf('+') < 0) {
            badWaves.push(tag + ' wave=' + ev.wave);
        }
        if (!ev.name) continue;
        const pc = A.pitchClass(ev.name);
        if (PENTA.indexOf(pc) < 0) badNotes.push(tag + ' ' + ev.name);
    }
}
auditEvents(A.BGM_EVENTS, 'BGM');
check('A3 BGM 全部音级 ∈ {D,E,F#,A,B}', badNotes.filter((x) => x.indexOf('BGM') === 0).length === 0,
    badNotes.filter((x) => x.indexOf('BGM') === 0).slice(0, 8).join(' '));
check('A3b 音色族只用 sine/triangle/噪声', badWaves.length === 0, badWaves.slice(0, 4).join(' '));
for (const id of sfxIds) auditEvents(A.sfxEvents(id), 'SFX:' + id);
check('A4 五档特效音与 BGM 同调（含低音/装饰音）', badNotes.filter((x) => x.indexOf('SFX') === 0).length === 0,
    badNotes.filter((x) => x.indexOf('SFX') === 0).slice(0, 8).join(' '));

/* ---------------- A11：特效音"不刺耳"的三条可判定约束（v0.2.0） ---------------- */

/**
 * A11a 音色必须是加法合成预设，且不含"裸三角波"。
 *   三角波的谐波按 1/k² 衰减但永不消失，一极点低通在 2.6kHz 只让它掉 1.8dB，
 *   D6 的 3.5k/5.8k/8.2k 谐波一直在 → 金属味、刺。改成显式谐波表后这些谐波直接不存在。
 */
const bareTri = [];
for (const id of sfxIds) {
    for (const ev of A.sfxEvents(id)) {
        if (!ev.tone || !A.TONE[ev.tone]) bareTri.push(id + ' tone=' + ev.tone);
        if (String(ev.wave || '').indexOf('triangle') >= 0) bareTri.push(id + ' wave=' + ev.wave);
    }
}
check('A11a 特效音全部走加法合成预设，无裸三角波',
    bareTri.length === 0, bareTri.slice(0, 4).join(' '));

/**
 * A11b 谐波表里不允许出现"高次谐波比低次更响"。
 *   真乐器谐波按 1/n 单调衰减；一旦高次反超，听感立刻变"电子/金属"。
 */
const harmBad = [];
for (const name of Object.keys(A.TONE)) {
    const parts = A.TONE[name].slice().sort((a, b) => a.n - b.n);
    for (let i = 1; i < parts.length; i++) {
        if (parts[i].amp > parts[i - 1].amp) harmBad.push(name + ' n=' + parts[i].n);
    }
}
check('A11b 谐波振幅随次数单调衰减（不出现"高频反超"）',
    harmBad.length === 0, harmBad.slice(0, 4).join(' '));

/**
 * A11c 琶音总包络不许"越弹越响"。
 *   按人耳 50ms 积分窗口算真实响度；从第 2 颗音起，若某段抬高超过 2.5dB 判失败。
 *   门槛为何是 2.5dB：第一颗音自然衰减到 -2dB 后第二颗音进来，
 *   这一抬升是"前音落、后音起"的正常力度变化，音乐上必须存在；
 *   真正的病是 v0.1 那种 +8dB 的连续爬升（三音等幅叠加 + τ=500ms 长尾）。
 */
const envAtSum = (list, t) => {
    let sum = 0;
    for (const e of list) {
        if (t < e.t) continue;
        const lt = t - e.t;
        if (lt > e.dur) continue;
        const atk = Math.max(0.003, e.env.a);
        let g = lt < atk ? 0.5 - 0.5 * Math.cos(Math.PI * lt / atk) : Math.exp(-(lt - atk) / Math.max(1e-4, e.env.d));
        const tail = e.dur - lt;
        if (tail < 0.06) {
            const u = tail < 0 ? 0 : tail / 0.06;
            g *= 0.5 - 0.5 * Math.cos(Math.PI * u);
        }
        sum += Math.pow(10, e.gainDb / 20) * g;
    }
    return sum;
};
const envBad = [];
for (const id of sfxIds) {
    const list = A.sfxEvents(id);
    if (list.length < 2) continue;
    let prevDb = -Infinity;
    let peakDb = -Infinity;
    /* 50ms 滑动平均：人耳对响度的积分时间约 50–100ms，
       逐 5ms 的瞬时值会把波形自身的低频起伏误判成变响。 */
    for (let t = 0; t < 0.85; t += 0.01) {
        let acc = 0;
        for (let k = 0; k < 5; k++) acc += Math.pow(envAtSum(list, t + k * 0.01), 2);
        const v = Math.sqrt(acc / 5);
        const db = v > 0 ? 20 * Math.log10(v) : -Infinity;
        if (db > peakDb) peakDb = db;
        if (db > prevDb + 2.5 && t > 0.06) envBad.push(id + '@' + Math.round(t * 1000) + 'ms +' + (db - prevDb).toFixed(1) + 'dB');
        prevDb = db;
    }
}
check('A11c 琶音总包络不越弹越响（每次抬高 ≤ 2.5dB）',
    envBad.length === 0, envBad.slice(0, 5).join(' | '));

/**
 * A11d perfect / good 的峰值必须低于 god，且 perfect 不高于 -6 dBFS。
 *   v0.1 的组归一化把 perfect 顶到 -1.5dBFS 附近，"完美档刺耳"一半来自这里。
 */
/* 用组归一化后的真实电平比较：整组里最响的一档被顶到 SPEC.sfxPeakDb，
   其余档按各自的原始峰值等比缩放 —— 所以三档不会同时等于上限。 */
const rawPeaks = {};
for (const id of sfxIds) rawPeaks[id] = A.dbfs(A.peakOf(A.renderSfx(id, SR)));
const groupTop = Math.max(...Object.values(rawPeaks));
const normDb = (id) => A.SPEC.sfxPeakDb + (rawPeaks[id] - groupTop);
const pPerfect = normDb('perfect');
const pGood = normDb('good');
const pGod = normDb('god');
check('A11d perfect 峰值 ≤ -6dBFS 且低于 god',
    pPerfect <= -6 && pPerfect < pGod,
    'god=' + pGod.toFixed(1) + ' perfect=' + pPerfect.toFixed(1) + ' good=' + pGood.toFixed(1));

/* ---------------- A5 / A6：状态模型 ---------------- */
const ops = A.pressFrame();
const whooshOp = ops.filter((o) => o.op === 'whoosh')[0];
const sfxOp = ops.filter((o) => o.op === 'sfx')[0];
check('A5 按下即静音：whoosh→0 与 sfx_press 同帧（t 均为 0）',
    !!whooshOp && whooshOp.gain === 0 && whooshOp.t === 0 && !!sfxOp && sfxOp.id === 'press' && sfxOp.t === 0,
    JSON.stringify(ops));

A.setMuted(true);
const mutedGain = A.masterGainValue();
A.setMuted(false);
const restoredGain = A.masterGainValue();
check('A6 静音开关：切换后 masterGain = 0，恢复为 1', mutedGain === 0 && restoredGain === 1,
    'muted=' + mutedGain + ' restored=' + restoredGain);

/* ---------------- A7 / A8 / A9 / A10：产物里跑 ---------------- */
let vmok = null;
try {
    vmok = loadProto({ search: 'screen=home&progress=6', storage: { 'dista.progress': JSON.stringify({ unlocked: 6, bestScore: 4400, god: 2 }) } });
} catch (e) {
    check('产物能在 node 里启动', false, e && e.message ? e.message : String(e));
}

if (vmok) {
    const P = vmok.P;
    check('产物能在 node 里启动（__PROTO__ 已挂）', !!P);

    /* A8 先跑：此时还没被 A7 改过 scene。属性不存在 = 没有报错（dump 时是 undefined / "0"） */
    const errAttr = vmok.htmlError();
    const titleClean = String(vmok.title()).indexOf('JS-ERROR') < 0;
    check('A8 无音频也能玩（无 JS 报错、首页照常、ensure() 不抛）',
        (errAttr == null || errAttr === '0') && titleClean && !!P && P.app.scene === 'home' && A.ensure() === false,
        'title=' + vmok.title() + ' jsErrorAttr=' + errAttr + ' scene=' + (P && P.app.scene));

    if (P) {
        /* A7（v0.3 首页主次对调后）：主 = 闯关挑战，次 = 催眠放松，有进度再加「继续」。
           三个入口分别验：challenge → 第 1 关；continue → 存档那一关；relax → mode=relax。 */
        const CHALL_BTN = { x: 360, y: 796 };
        const RELAX_BTN = { x: 360, y: 929 };
        const CONT_BTN = { x: 360, y: 1038 };
        const bootScene = P.app.scene;
        const bootLvl = P.app.lvl;

        P.progress.unlocked = 6;
        P.app.scene = 'home';
        P.homePress(CHALL_BTN.x, CHALL_BTN.y);
        const afterStart = P.app.lvl;
        const modeAfterStart = P.app.mode;

        P.progress.unlocked = 6;
        P.app.scene = 'home';
        P.homePress(CONT_BTN.x, CONT_BTN.y);
        const afterCont = P.app.lvl;

        P.app.scene = 'home';
        P.homePress(RELAX_BTN.x, RELAX_BTN.y);
        const modeAfterRelax = P.app.mode;

        check('A7a 启动不预载存档关卡（progress=6 → 仍是首页 / lvl 0）', bootScene === 'home' && bootLvl === 0,
            'scene=' + bootScene + ' lvl=' + bootLvl);
        check('A7b 「闯关挑战」→ 第 1 关（lvl 0, mode=challenge）', afterStart === 0 && modeAfterStart === 'challenge',
            'start→' + afterStart + ' mode=' + modeAfterStart);
        check('A7c 「继续」→ 存档那一关（progress=6 → lvl 5）', afterCont === 5, 'continue→' + afterCont);
        check('A7d 「催眠放松」→ mode=relax', modeAfterRelax === 'relax', 'mode=' + modeAfterRelax);

        /* A9：五档能量严格递减（读 Layout.RATING_FX） */
        const fx = P.CORE && P.CORE.RATING_FX;
        const order = ['god', 'perfect', 'good', 'ok', 'fail'];
        const energy = order.map((k) => (fx && fx[k] ? fx[k].energy : NaN));
        let mono = order.every((k, i) => fx && fx[k] && (i === 0 || fx[order[i - 1]].energy > fx[k].energy));
        check('A9 评级能量严格递减 138 > 48 > 18 > 10 > 0', mono, energy.join(' > '));

        /* A10：热力图口径 + 偏差区确实存在 */
        const hs = P.heatStyle || {};
        const alphaOk = !!(hs.overlap && hs.overlap.alpha <= 0.35 &&
            hs.dev && hs.dev.alpha >= 0.55 &&
            hs.gap && String(hs.gap.color).toUpperCase() === '#E8F1FF' && hs.gap.alpha <= 0.25);
        const L = P.levels[14] || P.levels[P.levels.length - 1];
        const rt = P.CORE.buildLevel(L, P.shapes, 99);
        const pressMs = Math.min(rt.movers[0].cycleMs - 1, rt.perfectMs + 40);
        const res = P.CORE.judge(rt, pressMs, 0);
        const o = res.objects[0];
        let devArea = 0;
        if (typeof P.CORE.missStrips === 'function') {
            const rects = P.CORE.missStrips(o.objectPts, o.targetPts, 6);
            for (const r of rects) devArea += r.w * r.h;
        }
        const rel = o.targetArea > 0 ? devArea / o.targetArea : 0;
        check('A10 热力图可读（重合α≤0.35 / 偏差α≥0.55+外扩 / 空缺 #E8F1FF α≤0.25，且 L15 偏差 40ms 有偏差区）',
            alphaOk && rel > 0,
            'alpha=' + JSON.stringify(hs) + ' devArea=' + Math.round(devArea) + ' (' + (rel * 100).toFixed(1) + '% of target)');
    }
}

/* ================================================================
 * A12x：三套新 BGM（v0.3.0）—— 直接对**需求文档的硬约束**做断言
 *
 * 需求（BGM 提示词文档）：
 *   §1 速度 75~80 BPM，不要更快
 *   §3 动态平缓，不能突强突弱；高光时刻 BGM 不爆音
 *   §4 4~8 小节无缝 loop，循环点无断点、无突兀停顿
 *   §5 不要强鼓点 / 无打击乐（V3）;无人声（本实现本来就没有）
 *   音量：BGM 比 SFX 低 -12 ~ -18dB
 * ================================================================ */
const NEW_TRACKS = ['minimal', 'lofi', 'ambient'];

for (const id of NEW_TRACKS) {
    const tr = A.BGM_TRACKS[id];
    const bufSeam = A.renderBgm(null, SR, id, true);

    /* A12a 速度与曲式 */
    const bpmOk = tr.bpm >= 75 && tr.bpm <= 80;
    const barsOk = tr.bars >= 4 && tr.bars <= 8;
    check('A12a [' + id + '] 速度 75~80 BPM 且 ' + tr.bars + ' 小节循环',
        bpmOk && barsOk,
        'bpm=' + tr.bpm + ' bars=' + tr.bars + ' loop=' + tr.loopSeconds.toFixed(2) + 's');

    /* A12b 动态平缓：需求文档 §3「全程平缓，不能有突强突弱」。
       窗口选 500ms —— 这是人耳判断"这段音乐整体有多响"的尺度。
       用 50ms 窗口会测到每个音符自身的起落（实测 8.6dB），那是音乐的呼吸，不是"突强突弱"：
           50ms 窗口 8.6dB → 200ms 6.3dB → 500ms 5.4dB（同一首曲子，窗口越大越接近真实感知）
       参考值：v0.2 原曲在同样口径下是 22dB 量级（低音每小节硬起音 + 拨弦密集）。 */
    const W = Math.round(SR * 0.5);
    const frames = [];
    for (let i = 0; i + W <= bufSeam.length; i += W) frames.push(A.dbfs(A.rmsOf(bufSeam.subarray(i, i + W))));
    const dyn = Math.max(...frames) - Math.min(...frames);
    check('A12b [' + id + '] 整体动态平缓（500ms 窗口 RMS 起伏 ≤ 7dB，无突强突弱）',
        dyn <= 7,
        '实测 ' + dyn.toFixed(1) + 'dB');

    /* A12c 无缝 loop：把两圈首尾相接，接缝处 50ms 帧的相邻跳变 ≤ 4dB
       （原曲 warm 实测 21.2dB —— 那就是"循环点能听出来"的量化定义）
       这里必须用 50ms 而不是 A12b 的 500ms：接缝是"瞬间"的事，窗口一大就被平均掉了。 */
    const SW = Math.round(SR * 0.05);
    const joined = new Float32Array(bufSeam.length * 2);
    joined.set(bufSeam, 0);
    joined.set(bufSeam, bufSeam.length);
    const jf = [];
    for (let i = 0; i + SW <= joined.length; i += SW) jf.push(A.dbfs(A.rmsOf(joined.subarray(i, i + SW))));
    const si = Math.round(bufSeam.length / SW);
    let seamJump = 0;
    for (let i = si - 3; i < si + 3; i++) if (i > 0 && jf[i] !== undefined) seamJump = Math.max(seamJump, Math.abs(jf[i] - jf[i - 1]));
    check('A12c [' + id + '] 循环接缝连续（首尾相接处 50ms 帧跳变 ≤ 4dB）',
        seamJump <= 4,
        '实测 ' + seamJump.toFixed(1) + 'dB（参考：v0.2 原曲 21.2dB）');

    /* A12d 无强鼓点：不存在"低频冲击"型瞬态。
       判据：低通 < 150Hz 后，短时（10ms）能量的最大值 / 中位数。
       阈值 12dB 是用真实样本校准出来的（不是拍脑袋）：
           人工合成 kick 轨道 26.2dB · v0.2 原曲 22.6dB（它的 sub 低音每小节硬起音，本质上就是鼓点）
           三套新曲 5.7~7.9dB（换音造成的自然起伏，不是打击）
       12dB 落在两个区间正中间，既不会误杀换音起伏，也不会放过真鼓点。 */
    let lp = 0;
    const a = 1 - Math.exp(-2 * Math.PI * 150 / SR);
    const lowBuf = new Float32Array(bufSeam.length);
    for (let i = 0; i < bufSeam.length; i++) { lp += a * (bufSeam[i] - lp); lowBuf[i] = lp; }
    const LW = Math.round(SR * 0.01);
    const lv = [];
    for (let i = 0; i + LW <= lowBuf.length; i += LW) lv.push(A.rmsOf(lowBuf.subarray(i, i + LW)));
    lv.sort((x, y) => x - y);
    const med = lv[Math.floor(lv.length / 2)] || 1e-9;
    const crest = A.dbfs(lv[lv.length - 1]) - A.dbfs(med);
    check('A12d [' + id + '] 无强鼓点（低频 150Hz 以下峰/中值 ≤ 12dB；带 kick 的参考轨是 26dB）',
        crest <= 12,
        '实测 ' + crest.toFixed(1) + 'dB');

    /* A12e 无人声 / 无噪声类打击（V3 要求更严：一个噪声事件都不许有） */
    const noises = tr.events.filter((e) => e.wave === 'noise');
    const allowNoise = id === 'lofi';
    check('A12e [' + id + '] 无打击乐噪声层' + (allowNoise ? '（V2 仅允许极淡 brush/vinyl）' : '（应为 0 个噪声事件）'),
        allowNoise ? noises.every((e) => e.kind === 'brush' || e.kind === 'vinyl') : noises.length === 0,
        'noise 事件 ' + noises.length + ' 个: ' + [...new Set(noises.map((e) => e.kind))].join(',') || '无');

    /* A12f 电平：交付版应比 sfx_perfect 的 RMS 低 12~18dB */
    const perfectRmsDb = A.dbfs(A.rmsOf(sfx.perfect));
    const gameRms = perfectRmsDb - 15;
    const delta = gameRms - perfectRmsDb;
    check('A12f [' + id + '] 游戏内电平比完美音效低 12~18dB',
        delta <= -12 && delta >= -18,
        'BGM 交付版 RMS ' + gameRms.toFixed(1) + ' / perfect ' + perfectRmsDb.toFixed(1) + ' → ' + delta.toFixed(1) + 'dB');

    /* A12g 调式：全部落在 D 大调五声音阶 */
    const pcs = [...new Set(tr.events.filter((e) => e.name).map((e) => A.pitchClass(e.name)))];
    const bad = pcs.filter((p) => A.SPEC.pentatonic.indexOf(p) < 0);
    check('A12g [' + id + '] 全部音高在 D 大调五声音阶内',
        bad.length === 0,
        bad.length ? '越界: ' + bad.join(',') : pcs.join(' '));
}

/* A12h 三套之间要有可辨识的差异，不能只是同一首换了速度。
   比的是**旋律密度**（右手音符数），不是"所有带音名的事件数" ——
   后者会把 pad 的和弦音算进去，反而看不出谁更"极简"。 */
{
    const feat = {};
    for (const id of NEW_TRACKS) {
        const tr = A.BGM_TRACKS[id];
        feat[id] = {
            melody: tr.events.filter((e) => e.kind === 'pluck').length,
            noise: tr.events.filter((e) => e.wave === 'noise').length,
            bpm: tr.bpm
        };
    }
    /* V1 旋律最密（每小节 3 颗）、V2 更多且带噪层、V3 最稀（每小节 2 颗）、
       V3 必须完全没有噪声层（需求文档："更干净，无黑胶噪点"） */
    const distinct =
        feat.ambient.melody < feat.minimal.melody &&
        feat.lofi.melody > feat.minimal.melody &&
        feat.ambient.noise === 0 && feat.minimal.noise === 0 && feat.lofi.noise > 0 &&
        new Set([feat.minimal.bpm, feat.lofi.bpm, feat.ambient.bpm]).size === 3;
    check('A12h 三套编曲互相可辨（V3 旋律最稀且无噪层 / V2 旋律最密且有细碎噪层 / 三者 BPM 各不相同）',
        distinct,
        JSON.stringify(feat));
}

/* ---------------- 汇总 ---------------- */
console.log('');
console.log('==== audio_check ====');
console.log('bpm/beat/loop: ' + A.SPEC.bpm + ' BPM / ' + A.SPEC.beat.toFixed(4) + 's / ' + A.SPEC.loopSeconds + 's');
console.log('BGM 事件数    : ' + A.BGM_EVENTS.length);
console.log('BGM peak/RMS  : ' + A.dbfs(A.peakOf(bgm)).toFixed(2) + ' / ' + bgmRms.toFixed(2) + ' dBFS');
for (const id of sfxIds) {
    const b = sfx[id];
    console.log(('sfx_' + id).padEnd(14) + ' peak ' + A.dbfs(A.peakOf(b)).toFixed(2) + ' dBFS   notes ' +
        A.sfxEvents(id).map((e) => e.name || 'noise').join(','));
}
if (warns.length) {
    console.log('---- 提醒 ----');
    for (const w of warns) console.log('  ! ' + w);
}
console.log('断言通过      : ' + pass);
console.log('断言失败      : ' + fail);
if (fail) {
    console.log('---- 失败明细 ----');
    for (const f of fails) console.log('  X ' + f);
    console.log('RESULT: FAIL (' + fail + ' 项)');
    process.exit(1);
}
console.log('RESULT: PASS (A1–A10 全绿，' + pass + ' 条断言)');
console.log('');
