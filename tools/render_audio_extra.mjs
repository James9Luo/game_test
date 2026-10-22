/**
 * tools/render_audio_extra.mjs —— 新增音频批次（2026-10-22）
 *
 * 目标：在**不改动、不覆盖**任何既有产物的前提下，再产出 3 套 BGM + 7 条特效音。
 *
 * 做法：
 *   - 复用 原型/_src/audio.js 的**同一套渲染引擎**（音色族 TONE、反馈延迟混响、
 *     包络语义、renderBgm 的无缝绕回、sfxEvents 的尾音让位），
 *     本文件只负责"新曲子 / 新音效的音符表"；
 *   - 通过给 `A.BGM_TRACKS` / `A.SFX` **挂新条目**接入，
 *     所以 原型/_src/audio.js 与既有 WAV 一个字节都没动；
 *   - 产物全部用**新文件名**落在 03_交付素材/audio/。
 *
 * 新增 BGM（都满足 audio_check.mjs A12x 的硬约束：75~80BPM / 8 小节无缝 /
 *          500ms 动态 ≤7dB / 接缝跳变 ≤4dB / 低频冲击 ≤12dB / D 大调五声音阶）：
 *   bgm_v4_spring_79bpm.wav  「春日微风」 79BPM  8 小节  24.30s  钢琴 + 风铃 + 暖垫
 *   bgm_v5_rain_76bpm.wav     「雨落窗台」 76BPM  8 小节  25.26s  音乐盒 + 雨声底噪
 *   bgm_v6_night_77bpm.wav    「夜行列车」 77BPM  8 小节  24.94s  低频嗡鸣 + 远处钟音
 *
 * 新增 SFX（接道具收集 / 漂流瓶 / 季节切换 / 连击 这些新系统的音）：
 *   sfx_cue 预备拍 · sfx_collect 拾取道具 · sfx_bottle 漂流瓶 · sfx_unlock 解锁新道具
 *   sfx_season 季节更替 · sfx_combo 连击达成 · sfx_ui 界面轻触
 *
 * 用法：node tools/render_audio_extra.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './proto_vm.mjs';

const OUT_DIR = path.join(ROOT, '03_交付素材', 'audio');
const SR = 44100;

/* ------------------------------------------------------------------
 * 0. 载入既有引擎（与浏览器 / tools/render_audio.mjs 同一份源码）
 * ------------------------------------------------------------------ */
const holder = {};
new Function('globalThis', fs.readFileSync(path.join(ROOT, '原型', '_src', 'audio.js'), 'utf8'))(holder);
const A = holder.DISTA_AUDIO;
if (!A) {
    console.error('[render_audio_extra] audio.js 没有导出 DISTA_AUDIO');
    process.exit(2);
}

/* 循环出血长度：与 audio.js 的 BLEED 保持一致（延迟混响收敛约 2.3s，3.0s 够） */
const BLEED = 3.0;

/* ------------------------------------------------------------------
 * 1. 新 BGM 的音符表
 *
 * 三条铁律沿用规格 §0（既然是同一个游戏，音不能跑出家族）：
 *   调式  D 大调五声音阶 {D, E, F#, A, B}（含低音与装饰音）
 *   音色  只用 TONE 预设（pluck / pad / mallet / sub）+ 带通噪声
 *   混响  与全部既有音效共用同一条反馈延迟（renderBgm 内部已做）
 *
 * 与既有两套的区分点（不能只是"同一首换了速度"）：
 *   minimal 80BPM  右手 3 颗/小节，2 音垫，无高声部
 *   lofi    75BPM  右手 4 颗/小节 + 刷镲 + 黑胶底噪
 *   ambient 78BPM  右手 2 颗/小节，3 音垫（1.6s 慢起音），零噪声
 *   ── 新增 ──
 *   spring  79BPM  右手 3 颗/小节（浮在反拍）+ **风铃高声部** + 根音+五度低音，无噪声
 *   rain    76BPM  右手 2 颗/小节（音乐盒音色）+ **雨声底噪**（带通噪声 + 零星雨滴）
 *   night   77BPM  右手 1 颗/小节 + **sub 低频嗡鸣** + 远处钟音（mallet）
 * ------------------------------------------------------------------ */

/** 长音（pad / bass）的 T60 = sustainK × 一圈长度。
 *  既有三套用 4×（一圈掉 15dB）：旋律密时接缝被旋律盖住，没问题。
 *  新三套的旋律更稀（雨/夜各 1~2 颗/小节），若长音也掉 15dB，
 *  圈尾的铺底会比圈头低一大截 → 听得出"每 25 秒塌一下"。
 *  所以这里把系数调大（掉 3~10dB），让**长音自己托住接缝**。 */
function sustainT60(loopSec, k) { return loopSec * k; }

/* ---------- V4「春日微风」79BPM ---------- */
function buildSpringEvents() {
    var ev = [];
    var beat = 60 / 79;
    var bar = beat * 4;
    var bars = 8;
    var loop = bars * bar;
    var T60 = sustainT60(loop, 6);          /* 一圈掉 10dB */

    var harm = [
        { pad: ['D4', 'F#4', 'A4'], root: 'D3', fifth: 'A3' },
        { pad: ['D4', 'F#4', 'A4'], root: 'D3', fifth: 'A3' },
        { pad: ['B3', 'D4', 'F#4'], root: 'B2', fifth: 'F#3' },
        { pad: ['B3', 'D4', 'F#4'], root: 'B2', fifth: 'F#3' },
        { pad: ['A3', 'D4', 'E4'], root: 'A2', fifth: 'E3' },
        { pad: ['A3', 'D4', 'E4'], root: 'A2', fifth: 'E3' },
        { pad: ['B3', 'D4', 'F#4'], root: 'B2', fifth: 'F#3' },
        { pad: ['B3', 'D4', 'F#4'], root: 'B2', fifth: 'F#3' }
    ];

    /* 右手浮在**反拍**上（1.1 / 2.1 / 3.1 拍）：比 minimal 的 1.0/2.2/3.0 更"飘"，
       听感是"有人在慢慢弹，不是在打拍子"。
       落点为什么不是 1.5/2.5/3.5：那样每小节末尾会空出 1.5s（没有音符的空档），
       500ms 窗口的动态实测 6.77dB —— 在 7dB 红线内但只剩 0.2dB 余量，比既有三套都大。
       整体提前 0.4 拍后空档缩到 1.1s，动态降到 5.97dB，而"浮在反拍"的特征不变
       （实测见 temp/audio_spring_probe.mjs 的变体对照）。 */
    var line = [
        [['A4', 1.1, -3], ['B4', 2.1, -5], ['D5', 3.1, -7]],
        [['B4', 1.1, -4], ['A4', 2.1, -6], ['F#4', 3.1, -9]],
        [['E4', 1.1, -3], ['F#4', 2.1, -6], ['A4', 3.1, -8]],
        [['F#4', 1.1, -4], ['E4', 2.1, -6], ['D4', 3.1, -9]],
        [['E4', 1.1, -3], ['A4', 2.1, -5], ['B4', 3.1, -8]],
        [['A4', 1.1, -4], ['F#4', 2.1, -6], ['E4', 3.1, -9]],
        [['D4', 1.1, -3], ['E4', 2.1, -6], ['B3', 3.1, -9]],
        [['B3', 1.1, -4], ['D4', 2.1, -6], ['A4', 3.1, -9]]
    ];

    /* 风铃：每 2 小节一颗，落在小节最末尾（3.8 拍），音区 A5/F#5/D5。
       电平 -24dB：风铃是"几乎听不见但耳朵会抓住"的那一层；
       再响一点就会把 500ms 动态顶到 7dB 红线（实测 -22dB 时动态 6.8dB）。 */
    var chimes = [
        { b: 1, n: 'A5' }, { b: 3, n: 'F#5' }, { b: 5, n: 'A5' }, { b: 7, n: 'D5' }
    ];

    for (var b = 0; b < bars; b++) {
        var t0 = b * bar;
        var h = harm[b];

        ev.push({
            name: h.root, t: t0, dur: bar + BLEED,
            tone: 'pluck', freq: A.hz(h.root), cents: 0,
            gainDb: -20, air: -46, env: { a: 0.060, d: T60, hold: true }, kind: 'bass'
        });
        ev.push({
            name: h.fifth, t: t0 + beat * 2, dur: bar * 0.5,
            tone: 'pluck', freq: A.hz(h.fifth), cents: 2,
            gainDb: -25, air: -48, env: { a: 0.040, d: T60, hold: true }, kind: 'bass'
        });

        for (var p = 0; p < h.pad.length; p++) {
            ev.push({
                name: h.pad[p], t: t0 + p * 0.12, dur: bar + BLEED,
                tone: 'pad', freq: A.hz(h.pad[p]), cents: 4,
                gainDb: -27, env: { a: 1.00, d: T60, hold: true }, kind: 'pad'
            });
        }

        for (var q = 0; q < line[b].length; q++) {
            var n = line[b][q];
            ev.push({
                name: n[0], t: t0 + n[1] * beat, dur: 1.8,
                tone: 'pluck', freq: A.hz(n[0]), cents: 3,
                gainDb: -13 + n[2], air: -42, env: { a: 0.007, d: 2.4 }, kind: 'pluck'
            });
        }
    }

    for (var c = 0; c < chimes.length; c++) {
        var ch = chimes[c];
        ev.push({
            name: ch.n, t: ch.b * bar + beat * 3.8, dur: 1.4,
            tone: 'mallet', freq: A.hz(ch.n), cents: 4,
            gainDb: -24, air: -46, env: { a: 0.004, d: 1.6 }, kind: 'chime'
        });
    }

    return { events: ev, bpm: 79, bars: bars, barSeconds: bar, loopSeconds: loop };
}

/* ---------- V5「雨落窗台」76BPM ---------- */
function buildRainEvents() {
    var ev = [];
    var beat = 60 / 76;
    var bar = beat * 4;
    var bars = 8;
    var loop = bars * bar;
    var T60 = sustainT60(loop, 12);         /* 一圈掉 5dB */

    var harm = [
        { pad: ['D4', 'A4'], root: 'D3' },
        { pad: ['B3', 'F#4'], root: 'B2' },
        { pad: ['A3', 'E4'], root: 'A2' },
        { pad: ['D4', 'A4'], root: 'D3' }
    ];

    /* 音乐盒：mallet 音色（1/4/6 谐波，"略空"的纯音），每小节 2 颗 */
    var line = [
        [['A4', 1.2, -4], ['F#4', 3.0, -8]],
        [['E4', 1.2, -4], ['D4', 3.0, -9]],
        [['F#4', 1.2, -4], ['E4', 3.0, -8]],
        [['D4', 1.2, -5], ['B3', 3.0, -9]],
        [['A4', 1.2, -4], ['E4', 3.0, -8]],
        [['F#4', 1.2, -4], ['D4', 3.0, -9]],
        [['E4', 1.2, -5], ['B3', 3.0, -9]],
        [['D4', 1.2, -4], ['A4', 3.0, -8]]
    ];

    for (var b = 0; b < bars; b++) {
        var t0 = b * bar;
        var h = harm[b % harm.length];

        ev.push({
            name: h.root, t: t0, dur: bar + BLEED,
            tone: 'pluck', freq: A.hz(h.root), cents: 0,
            gainDb: -22, air: -48, env: { a: 0.070, d: T60, hold: true }, kind: 'bass'
        });

        for (var p = 0; p < h.pad.length; p++) {
            ev.push({
                name: h.pad[p], t: t0 + p * 0.14, dur: bar + BLEED,
                tone: 'pad', freq: A.hz(h.pad[p]), cents: 3,
                gainDb: -28, env: { a: 1.30, d: T60, hold: true }, kind: 'pad'
            });
        }

        for (var q = 0; q < line[b].length; q++) {
            var n = line[b][q];
            ev.push({
                name: n[0], t: t0 + n[1] * beat, dur: 1.6,
                tone: 'mallet', freq: A.hz(n[0]), cents: 2,
                gainDb: -13 + n[2], air: -44, env: { a: 0.010, d: 1.8 }, kind: 'pluck'
            });
        }
    }

    /* 雨声底噪：一条持续带通噪声（1500→4500 缓慢上扫，模拟雨势渐强）。
       电平 -42dB：比旋律低约 26dB，是"垫在下面"的存在感，不是前景。
       T60 取 20×一圈（=一圈只掉 3dB），否则雨会随循环越来越小。 */
    ev.push({
        name: null, t: 0, dur: loop + BLEED,
        wave: 'noise', gainDb: -42, env: { a: 1.20, d: loop * 20, hold: true },
        band: { f0: 1500, f1: 4500, q: 0.5 }, kind: 'rain'
    });

    /* 零星雨滴：稀疏的高频短噪声，用固定种子保证可复现 */
    var seed = 0x5A1F;
    function rnd() {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
    }
    for (var v = 1.1; v < loop - 0.4; v += 1.3 + rnd() * 1.4) {
        ev.push({
            name: null, t: v, dur: 0.03,
            wave: 'noise', gainDb: -48 - rnd() * 4, env: { a: 0.001, d: 0.10 },
            band: { f0: 3800, f1: 6500, q: 1.6 }, kind: 'drip'
        });
    }

    return { events: ev, bpm: 76, bars: bars, barSeconds: bar, loopSeconds: loop };
}

/* ---------- V6「夜行列车」77BPM ---------- */
function buildNightEvents() {
    var ev = [];
    var beat = 60 / 77;
    var bar = beat * 4;
    var bars = 8;
    var loop = bars * bar;
    var T60 = sustainT60(loop, 20);         /* 一圈掉 3dB */

    var harm = [
        { pad: ['D4', 'F#4', 'A4'], root: 'D3' },
        { pad: ['B3', 'D4', 'F#4'], root: 'B2' },
        { pad: ['A3', 'D4', 'E4'], root: 'A2' },
        { pad: ['B3', 'D4', 'F#4'], root: 'B2' }
    ];

    /* 右手：每小节只有 1 颗，落在第 2.2 拍（离开正拍，像远处的车声） */
    var line = [
        ['A4', 2.2, -4], ['F#4', 2.2, -5], ['E4', 2.2, -5], ['D4', 2.2, -6],
        ['A4', 2.2, -4], ['F#4', 2.2, -6], ['E4', 2.2, -6], ['D4', 2.2, -5]
    ];

    /* 远处钟音：每 2 小节一颗，mallet 音色，音区分散（D5 / A5 / F#5 / B4） */
    var bells = [
        { b: 1, n: 'D5' }, { b: 3, n: 'A5' }, { b: 5, n: 'F#5' }, { b: 7, n: 'B4' }
    ];

    for (var b = 0; b < bars; b++) {
        var t0 = b * bar;
        var h = harm[b % harm.length];

        /* 低频嗡鸣：sub 音色（只有基频 + 0.1 的 2 次），长音，-22dB。
           这里是"夜行"的底：不是鼓点，是车身共振。 */
        ev.push({
            name: h.root, t: t0, dur: bar + BLEED,
            tone: 'sub', freq: A.hz(h.root), cents: 0,
            gainDb: -22, env: { a: 0.35, d: T60, hold: true }, kind: 'bass'
        });

        for (var p = 0; p < h.pad.length; p++) {
            ev.push({
                name: h.pad[p], t: t0 + p * 0.15, dur: bar + BLEED,
                tone: 'pad', freq: A.hz(h.pad[p]), cents: 5,
                gainDb: -27, env: { a: 1.40, d: T60, hold: true }, kind: 'pad'
            });
        }

        var n = line[b];
        ev.push({
            name: n[0], t: t0 + n[1] * beat, dur: 1.8,
            tone: 'pluck', freq: A.hz(n[0]), cents: 3,
            gainDb: -10 + n[2], air: -44, env: { a: 0.008, d: 2.2 }, kind: 'pluck'
        });
    }

    for (var c = 0; c < bells.length; c++) {
        var bl = bells[c];
        ev.push({
            name: bl.n, t: bl.b * bar + beat * 3.7, dur: 1.6,
            tone: 'mallet', freq: A.hz(bl.n), cents: 3,
            gainDb: -19, air: -46, env: { a: 0.004, d: 1.8 }, kind: 'chime'
        });
    }

    return { events: ev, bpm: 77, bars: bars, barSeconds: bar, loopSeconds: loop };
}

/* ------------------------------------------------------------------
 * 2. 新 SFX 的音符表
 *
 * 全部用既有 TONE 预设（mallet / pad / 噪声），所以自动满足 A11a（无裸三角波）、
 * A11b（谐波单调衰减）、A11c（琶音不越弹越响）。
 * 音名全在 D 大调五声音阶内 → 自动满足 A4（与 BGM 同调）。
 *
 * 对应的新系统：
 *   cue     预备拍      —— 物体进入接近段时给一个轻点，帮助玩家对拍
 *   collect 拾取道具    —— 道具收集系统（v0.9）拾到一件
 *   bottle  漂流瓶      —— 漂流瓶社交系统（v0.8）放瓶 / 收到瓶
 *   unlock  解锁新道具  —— 图鉴点亮新剪影
 *   season  季节更替    —— 四季关卡切换（v0.4）
 *   combo   连击达成    —— 连击里程碑
 *   ui      界面轻触    —— 菜单点击（比 press 更轻更短，音色区隔开）
 * ------------------------------------------------------------------ */
const NEW_SFX_DEFS = {
    cue: {
        id: 'cue', label: '预备拍', gainDb: 0, dur: 0.30,
        tone: 'mallet', env: { a: 0.005, d: 0.30 },
        notes: [{ n: 'D5', at: 0, dur: 0.30, level: 1.00 }]
    },
    collect: {
        id: 'collect', label: '拾取道具', gainDb: -3, dur: 0.75,
        tone: 'mallet', env: { a: 0.006, d: 0.55 },
        notes: [
            { n: 'A4', at: 0.000, dur: 0.75, level: 1.00 },
            { n: 'D5', at: 0.080, dur: 0.60, level: 0.94 },
            { n: 'F#5', at: 0.160, dur: 0.50, level: 0.88 }
        ]
    },
    bottle: {
        id: 'bottle', label: '漂流瓶', gainDb: -6, dur: 0.90,
        tone: 'mallet', env: { a: 0.010, d: 0.80 },
        notes: [
            { n: 'D5', at: 0.000, dur: 0.90, level: 1.00 },
            { n: 'F#5', at: 0.140, dur: 0.70, level: 0.80 }
        ]
    },
    unlock: {
        id: 'unlock', label: '解锁新道具', gainDb: 0, dur: 1.10,
        tone: 'mallet', env: { a: 0.004, d: 0.70 },
        notes: [
            { n: 'D5', at: 0.000, dur: 1.10, level: 1.00 },
            { n: 'F#5', at: 0.070, dur: 0.95, level: 0.95 },
            { n: 'A5', at: 0.140, dur: 0.85, level: 0.90 },
            { n: 'D5', at: 0.260, dur: 0.80, level: 0.86 }
        ]
    },
    season: {
        id: 'season', label: '季节更替', gainDb: -5, dur: 2.40,
        tone: 'pad', env: { a: 1.30, d: 2.60 },
        notes: [
            { n: 'D4', at: 0.000, dur: 0.80, level: 1.00 },
            { n: 'A4', at: 0.600, dur: 2.40, level: 0.70 }
        ]
    },
    combo: {
        id: 'combo', label: '连击达成', gainDb: -4, dur: 0.60,
        tone: 'mallet', env: { a: 0.004, d: 0.45 },
        notes: [
            { n: 'E5', at: 0.000, dur: 0.60, level: 1.00 },
            { n: 'A5', at: 0.070, dur: 0.45, level: 0.92 },
            { n: 'B5', at: 0.140, dur: 0.40, level: 0.85 }
        ]
    },
    ui: {
        id: 'ui', label: '界面轻触', gainDb: -19, dur: 0.05,
        kind: 'noise', band: { f0: 2800, f1: 2800, q: 1.0 }, env: { a: 0.001, d: 0.22 },
        notes: []
    }
};
const NEW_SFX_IDS = ['cue', 'collect', 'bottle', 'unlock', 'season', 'combo', 'ui'];

/* ------------------------------------------------------------------
 * 3. 挂进既有引擎（不写回 audio.js —— 这里只挂到内存里的对象上）
 * ------------------------------------------------------------------ */
const NEW_BGM = [
    { id: 'spring', file: 'bgm_v4_spring_79bpm.wav', label: 'V4 春日微风 · 79BPM', build: buildSpringEvents, mood: '白天 / 春天 / 明亮', hasPercussion: false },
    { id: 'rain', file: 'bgm_v5_rain_76bpm.wav', label: 'V5 雨落窗台 · 76BPM', build: buildRainEvents, mood: '雨天窗边 / 最安静', hasPercussion: 'rain' },
    { id: 'night', file: 'bgm_v6_night_77bpm.wav', label: 'V6 夜行列车 · 77BPM', build: buildNightEvents, mood: '长夜 / 助眠', hasPercussion: false }
];

for (var i = 0; i < NEW_BGM.length; i++) {
    var t = NEW_BGM[i];
    var r = t.build();
    A.BGM_TRACKS[t.id] = {
        id: t.id, label: t.label, bpm: r.bpm, bars: r.bars, barSeconds: r.barSeconds,
        loopSeconds: r.loopSeconds, wrapSeconds: BLEED, events: r.events,
        mood: t.mood, hasPercussion: t.hasPercussion
    };
}
for (var s = 0; s < NEW_SFX_IDS.length; s++) {
    A.SFX[NEW_SFX_IDS[s]] = NEW_SFX_DEFS[NEW_SFX_IDS[s]];
}

/* ------------------------------------------------------------------
 * 4. WAV 写出（16-bit PCM mono，与既有交付物同格式）
 * ------------------------------------------------------------------ */
function writeWav(file, buf, sampleRate) {
    const n = buf.length;
    const bytes = Buffer.alloc(44 + n * 2);
    bytes.write('RIFF', 0);
    bytes.writeUInt32LE(36 + n * 2, 4);
    bytes.write('WAVE', 8);
    bytes.write('fmt ', 12);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(sampleRate, 24);
    bytes.writeUInt32LE(sampleRate * 2, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36);
    bytes.writeUInt32LE(n * 2, 40);
    for (let k = 0; k < n; k++) {
        let v = Math.max(-1, Math.min(1, buf[k]));
        bytes.writeInt16LE(Math.round(v * 32767), 44 + k * 2);
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    return bytes.length;
}

/* ------------------------------------------------------------------
 * 5. 渲染
 * ------------------------------------------------------------------ */
const rows = [];
function emit(name, buf, tag) {
    const file = path.join(OUT_DIR, name);
    const bytes = writeWav(file, buf, SR);
    rows.push({
        name, tag: tag || '',
        sec: (buf.length / SR).toFixed(2),
        peak: A.dbfs(A.peakOf(buf)).toFixed(2),
        rms: A.dbfs(A.rmsOf(buf)).toFixed(2),
        kb: (bytes / 1024).toFixed(1)
    });
    return file;
}

/* BGM：先出试听版（RMS -18dBFS），再整体缩放出游戏内版。
   游戏内电平与既有两套完全同口径：比 sfx_perfect 的 RMS 低 15dB。
   ⚠ 参照的 perfect 必须用**组归一化之后**的 RMS（与 tools/render_audio.mjs 一致）：
     组归一化把最响的 god 顶到 SPEC.sfxPeakDb，其余档按比例缩放，
     perfect 因此比原始渲染低约 1.8dB。直接用原始 RMS 会让新文件比老文件低 1.8dB。 */
const RATING_IDS = ['god', 'perfect', 'good', 'ok', 'fail'];
const rawRating = {};
for (const id of RATING_IDS) rawRating[id] = A.renderSfx(id, SR);
let ratingTop = 0;
for (const id of RATING_IDS) ratingTop = Math.max(ratingTop, A.peakOf(rawRating[id]));
const ratingGain = Math.pow(10, (A.SPEC.sfxPeakDb - A.dbfs(ratingTop)) / 20);
const perfectRms = A.dbfs(A.rmsOf(rawRating.perfect)) + 20 * Math.log10(ratingGain);
const BGM_GAME_RMS = perfectRms - 15;

const rendered = {};
for (const t of NEW_BGM) {
    const preview = A.renderBgm(null, SR, t.id, true);
    const game = new Float32Array(preview.length);
    const g = Math.pow(10, (BGM_GAME_RMS - A.dbfs(A.rmsOf(preview))) / 20);
    for (let k = 0; k < preview.length; k++) game[k] = preview[k] * g;
    rendered[t.id] = { preview, game };
    emit(t.file.replace('.wav', '_preview.wav'), preview, '试听');
    emit(t.file, game, '游戏内');
}

/* SFX：新增的这一组做**组内归一化**（最响的一条 unlock 落到 -10.5dBFS），
   组内相对电平由各自的 gainDb 表达；不与既有的五档评级音混为一组，
   免得把"解锁新道具"抬到 god 那一档的高度。
   -10.5 的理由：必须低于 perfect 档（-9.4dBFS），
   否则奖励音会盖过"完美定格"这个核心反馈 —— 层级一乱，玩家听不出差别。 */
const NEW_SFX_CEIL = -10.5;
const rawSfx = {};
for (const id of NEW_SFX_IDS) rawSfx[id] = A.renderSfx(id, SR);
let sfxTop = 0;
for (const id of NEW_SFX_IDS) sfxTop = Math.max(sfxTop, A.peakOf(rawSfx[id]));
const sfxGain = sfxTop > 1e-9 ? Math.pow(10, (NEW_SFX_CEIL - A.dbfs(sfxTop)) / 20) : 1;
for (const id of NEW_SFX_IDS) {
    const scaled = new Float32Array(rawSfx[id].length);
    for (let k = 0; k < rawSfx[id].length; k++) scaled[k] = rawSfx[id][k] * sfxGain;
    emit('sfx_' + id + '.wav', A.softLimit(scaled, -1.5), '特效');
}

/* ------------------------------------------------------------------
 * 6. 断言（沿用 tools/audio_check.mjs 的 A1 / A3 / A4 / A12x 口径）
 * ------------------------------------------------------------------ */
let pass = 0, fail = 0;
const fails = [];
function check(name, cond, detail) {
    if (cond) { pass++; return; }
    fail++;
    fails.push(name + (detail ? ' — ' + detail : ''));
}

/* --- A1 无削波 --- */
const allFiles = [
    { name: 'BGM(3 套 × 2 版)', buf: rendered.spring.game },
    { name: 'BGM rain', buf: rendered.rain.game },
    { name: 'BGM night', buf: rendered.night.game }
].concat(NEW_SFX_IDS.map((id) => ({
    name: 'sfx_' + id,
    buf: A.softLimit(Float32Array.from(rawSfx[id], (x) => x * sfxGain), -1.5)
})));
const clipBad = [];
for (const f of allFiles) {
    const db = A.dbfs(A.peakOf(f.buf));
    let over = 0;
    for (let k = 0; k < f.buf.length; k++) if (Math.abs(f.buf[k]) >= 1) over++;
    if (!(db <= -1)) clipBad.push(f.name + ' peak=' + db.toFixed(2));
    if (over > 0) clipBad.push(f.name + ' |x|≥1 × ' + over);
}
check('A1 无削波（峰值 ≤ -1dBFS，无 |x| ≥ 1）', clipBad.length === 0, clipBad.slice(0, 6).join(' | '));

/* --- A3/A4 调式 --- */
const PENTA = A.SPEC.pentatonic;
const badNotes = [];
for (const t of NEW_BGM) {
    for (const ev of A.BGM_TRACKS[t.id].events) {
        if (!ev.name) continue;
        if (PENTA.indexOf(A.pitchClass(ev.name)) < 0) badNotes.push(t.id + ' ' + ev.name);
    }
}
for (const id of NEW_SFX_IDS) {
    for (const ev of A.sfxEvents(id)) {
        if (!ev.name) continue;
        if (PENTA.indexOf(A.pitchClass(ev.name)) < 0) badNotes.push('sfx_' + id + ' ' + ev.name);
    }
}
check('A3/A4 全部音高 ∈ D 大调五声音阶 {D,E,F#,A,B}', badNotes.length === 0, badNotes.slice(0, 8).join(' '));

/* --- A11a 走加法合成预设（噪声型除外） --- */
const badTone = [];
for (const id of NEW_SFX_IDS) {
    const def = NEW_SFX_DEFS[id];
    if (def.kind === 'noise') continue;
    for (const ev of A.sfxEvents(id)) {
        if (!ev.tone || !A.TONE[ev.tone]) badTone.push(id + ' tone=' + ev.tone);
    }
}
check('A11a 新增特效音全部走加法合成预设，无裸三角波', badTone.length === 0, badTone.slice(0, 4).join(' '));

/* --- A11c 琶音总包络不越弹越响（每 10ms 步进抬高 ≤ 2.5dB） --- */
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
for (const id of NEW_SFX_IDS) {
    const list = A.sfxEvents(id);
    if (list.length < 2) continue;
    let prevDb = -Infinity;
    for (let t = 0; t < 1.6; t += 0.01) {
        let acc = 0;
        for (let k = 0; k < 5; k++) acc += Math.pow(envAtSum(list, t + k * 0.01), 2);
        const v = Math.sqrt(acc / 5);
        const db = v > 0 ? 20 * Math.log10(v) : -Infinity;
        if (db > prevDb + 2.5 && t > 0.06) envBad.push(id + '@' + Math.round(t * 1000) + 'ms +' + (db - prevDb).toFixed(1) + 'dB');
        prevDb = db;
    }
}
check('A11c 新增特效音总包络不越弹越响（每步 ≤ 2.5dB）', envBad.length === 0, envBad.slice(0, 5).join(' | '));

/* --- A12x 三套新 BGM 的硬约束 --- */
const metrics = {};
for (const t of NEW_BGM) {
    const tr = A.BGM_TRACKS[t.id];
    const buf = rendered[t.id].preview;

    const bpmOk = tr.bpm >= 75 && tr.bpm <= 80;
    const barsOk = tr.bars >= 4 && tr.bars <= 8;
    check('A12a [' + t.id + '] 75~80BPM 且 4~8 小节', bpmOk && barsOk,
        'bpm=' + tr.bpm + ' bars=' + tr.bars + ' loop=' + tr.loopSeconds.toFixed(2) + 's');

    /* A12b 动态：500ms 窗口 RMS 起伏 ≤ 7dB */
    const W = Math.round(SR * 0.5);
    const frames = [];
    for (let i = 0; i + W <= buf.length; i += W) frames.push(A.dbfs(A.rmsOf(buf.subarray(i, i + W))));
    const dyn = Math.max(...frames) - Math.min(...frames);
    check('A12b [' + t.id + '] 500ms 动态 ≤ 7dB', dyn <= 7, '实测 ' + dyn.toFixed(1) + 'dB');

    /* A12c 接缝：两圈首尾相接，缝处 50ms 帧跳变 ≤ 4dB */
    const SW = Math.round(SR * 0.05);
    const joined = new Float32Array(buf.length * 2);
    joined.set(buf, 0);
    joined.set(buf, buf.length);
    const jf = [];
    for (let i = 0; i + SW <= joined.length; i += SW) jf.push(A.dbfs(A.rmsOf(joined.subarray(i, i + SW))));
    const si = Math.round(buf.length / SW);
    let seamJump = 0;
    for (let i = si - 3; i < si + 3; i++) if (i > 0 && jf[i] !== undefined) seamJump = Math.max(seamJump, Math.abs(jf[i] - jf[i - 1]));
    check('A12c [' + t.id + '] 循环接缝跳变 ≤ 4dB', seamJump <= 4, '实测 ' + seamJump.toFixed(1) + 'dB');

    /* A12d 低频冲击：≤150Hz 的 10ms RMS 峰/中值 ≤ 12dB */
    let lp = 0;
    const a = 1 - Math.exp(-2 * Math.PI * 150 / SR);
    const lowBuf = new Float32Array(buf.length);
    for (let i = 0; i < buf.length; i++) { lp += a * (buf[i] - lp); lowBuf[i] = lp; }
    const LW = Math.round(SR * 0.01);
    const lv = [];
    for (let i = 0; i + LW <= lowBuf.length; i += LW) lv.push(A.rmsOf(lowBuf.subarray(i, i + LW)));
    lv.sort((x, y) => x - y);
    const med = lv[Math.floor(lv.length / 2)] || 1e-9;
    const crest = A.dbfs(lv[lv.length - 1]) - A.dbfs(med);
    check('A12d [' + t.id + '] 无强鼓点（低频峰/中值 ≤ 12dB）', crest <= 12, '实测 ' + crest.toFixed(1) + 'dB');

    /* A12f 游戏内电平比 perfect 低 15dB */
    const gameRms = A.dbfs(A.rmsOf(rendered[t.id].game));
    check('A12f [' + t.id + '] 游戏内电平 = perfect − 15dB',
        Math.abs((gameRms - perfectRms) - (-15)) < 0.2, 'BGM ' + gameRms.toFixed(1) + ' / perfect ' + perfectRms.toFixed(1));

    metrics[t.id] = { dyn, seamJump, crest, loop: tr.loopSeconds, bpm: tr.bpm };
}

/* --- 新增 BGM 之间要有可辨识的差异（不能只是同一首换速度） --- */
{
    const feat = {};
    for (const t of NEW_BGM) {
        const ev = A.BGM_TRACKS[t.id].events;
        feat[t.id] = {
            melody: ev.filter((e) => e.kind === 'pluck').length,
            chime: ev.filter((e) => e.kind === 'chime').length,
            noise: ev.filter((e) => e.wave === 'noise').length,
            bass: ev.filter((e) => e.kind === 'bass').length
        };
    }
    /* 既有三套的右手音符数（用于"不是同一首换速度"的对照） */
    const oldMelody = {};
    for (const id of ['minimal', 'lofi', 'ambient']) {
        oldMelody[id] = A.BGM_TRACKS[id].events.filter((e) => e.kind === 'pluck').length;
    }
    const distinct =
        feat.rain.noise > 0 && feat.spring.noise === 0 && feat.night.noise === 0 &&
        feat.spring.chime > 0 && feat.night.chime > 0 &&
        feat.night.melody < feat.spring.melody && feat.spring.melody < oldMelody.lofi &&
        feat.rain.melody < oldMelody.ambient + 1;
    console.log('  对照（既有）: ' + Object.keys(oldMelody).map((k) => k + ' 旋律 ' + oldMelody[k]).join(' · '));
    check('新增三套互相可辨识（rain 带雨声 / spring 有风铃 / night 最稀）', distinct,
        JSON.stringify(feat));
    for (const t of NEW_BGM) {
        const f = feat[t.id];
        console.log('  特征 [' + t.id + '] 旋律 ' + f.melody + ' · 风铃 ' + f.chime + ' · 噪声 ' + f.noise + ' · 低音 ' + f.bass);
    }
}

/* --- 新增 SFX 的电平不得盖过评级音 --- */
{
    const oldPeaks = {};
    for (const id of RATING_IDS) oldPeaks[id] = A.dbfs(A.peakOf(rawRating[id]));
    const top = Math.max(...Object.values(oldPeaks));
    const normDb = (id) => A.SPEC.sfxPeakDb + (oldPeaks[id] - top);
    const bad = [];
    for (const id of NEW_SFX_IDS) {
        const p = A.dbfs(A.peakOf(rawSfx[id])) + 20 * Math.log10(sfxGain);
        if (p > normDb('perfect')) bad.push(id + ' ' + p.toFixed(1) + 'dBFS > perfect ' + normDb('perfect').toFixed(1));
    }
    check('新增特效音峰值不高于 perfect 档（不盖过评级反馈）', bad.length === 0, bad.join(' | '));
    console.log('  评级音峰值: ' + RATING_IDS.map((id) => id + ' ' + normDb(id).toFixed(1)).join(' · ') + ' dBFS');
    console.log('  新增音峰值: ' + NEW_SFX_IDS.map((id) => id + ' ' + (A.dbfs(A.peakOf(rawSfx[id])) + 20 * Math.log10(sfxGain)).toFixed(1)).join(' · ') + ' dBFS');
}

/* --- 雨声层占比：确认"雨"是垫底而不是前景 ---
   注意：renderBgm 会把 RMS 归一到 -18dBFS，直接比"带雨/不带雨"的成品 RMS
   永远等于 0（归一化把差异抹平了）。所以这里**绕开归一化**，
   直接用同一套事件渲染路径分别算"雨层"和"音乐层"的原始 RMS 再比。 */
{
    const tr = A.BGM_TRACKS.rain;
    const noiseEv = tr.events.filter((e) => e.wave === 'noise');
    const musicEv = tr.events.filter((e) => e.wave !== 'noise');
    function rawRmsDb(events, sec) {
        const buf = A.renderEvents(events, sec, SR);
        A.applyFeedbackDelay(buf, SR);
        return A.dbfs(A.rmsOf(buf));
    }
    const bedDb = rawRmsDb(noiseEv, tr.loopSeconds);
    const musicDb = rawRmsDb(musicEv, tr.loopSeconds);
    const diff = bedDb - musicDb;
    console.log('  雨声层占比: 雨层 RMS ' + bedDb.toFixed(2) + ' dBFS / 音乐层 ' + musicDb.toFixed(2) + ' dBFS → 雨声低 ' + (-diff).toFixed(1) + 'dB');
    check('雨声是垫底（雨层 RMS 比音乐层低 12~26dB）', diff <= -12 && diff >= -26, diff.toFixed(1) + 'dB');
}

/* --- 与既有交付物对照：确认新文件的电平口径与老文件完全一致 --- */
function readWavStats(file) {
    if (!fs.existsSync(file)) return null;
    const b = fs.readFileSync(file);
    const n = (b.length - 44) / 2;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = b.readInt16LE(44 + i * 2) / 32767;
    return { peak: A.dbfs(A.peakOf(out)), rms: A.dbfs(A.rmsOf(out)), sec: n / SR };
}
{
    console.log('  与既有交付物对照（BGM 游戏内版电平）:');
    const olds = ['bgm_v1_minimal_80bpm.wav', 'bgm_v2_lofi_75bpm.wav', 'bgm_v3_ambient_78bpm.wav'];
    for (const f of olds) {
        const st = readWavStats(path.join(OUT_DIR, f));
        if (st) console.log('    ' + f.padEnd(30) + '峰值 ' + st.peak.toFixed(2) + ' / RMS ' + st.rms.toFixed(2) + ' dBFS');
    }
    for (const t of NEW_BGM) {
        const st = readWavStats(path.join(OUT_DIR, t.file));
        if (st) console.log('    ' + t.file.padEnd(30) + '峰值 ' + st.peak.toFixed(2) + ' / RMS ' + st.rms.toFixed(2) + ' dBFS  ← 新增');
    }
    const ref = readWavStats(path.join(OUT_DIR, 'bgm_v1_minimal_80bpm.wav'));
    const lvlBad = [];
    for (const t of NEW_BGM) {
        const st = readWavStats(path.join(OUT_DIR, t.file));
        if (ref && st && Math.abs(st.rms - ref.rms) > 0.3) lvlBad.push(t.file + ' RMS ' + st.rms.toFixed(2) + ' vs 既有 ' + ref.rms.toFixed(2));
    }
    check('新增 BGM 游戏内电平与既有三套一致（同口径 ±0.3dB）', lvlBad.length === 0, lvlBad.join(' | '));

    console.log('  与既有交付物对照（音效峰值 / RMS）:');
    for (const f of ['sfx_god.wav', 'sfx_perfect.wav', 'sfx_good.wav', 'sfx_ok.wav', 'sfx_fail.wav', 'sfx_press.wav', 'sfx_whoosh.wav']) {
        const st = readWavStats(path.join(OUT_DIR, f));
        if (st) console.log('    ' + f.padEnd(18) + '峰值 ' + st.peak.toFixed(2) + ' / RMS ' + st.rms.toFixed(2) + ' dBFS');
    }
    for (const id of NEW_SFX_IDS) {
        const st = readWavStats(path.join(OUT_DIR, 'sfx_' + id + '.wav'));
        if (st) console.log('    ' + ('sfx_' + id + '.wav').padEnd(18) + '峰值 ' + st.peak.toFixed(2) + ' / RMS ' + st.rms.toFixed(2) + ' dBFS  ← 新增');
    }
}

/* --- 分层电平：每层单独渲染，确认"陪衬层真的在下面" ---
   既有三套一起列出来当**校准基准**：新曲子的层次关系要和老曲子同一个量级，
   而不是各层各自好看、叠起来互相盖。 */
{
    console.log('  分层电平（RMS，括号内 = 相对该曲旋律层）:');
    const ids = ['minimal', 'lofi', 'ambient'].concat(NEW_BGM.map((t) => t.id));
    const profiles = {};
    for (const id of ids) {
        const tr = A.BGM_TRACKS[id];
        const kinds = [...new Set(tr.events.map((e) => e.kind))];
        const st = {};
        for (const k of kinds) {
            const evs = tr.events.filter((e) => e.kind === k);
            const buf = A.renderEvents(evs, tr.loopSeconds, SR);
            A.applyFeedbackDelay(buf, SR);
            st[k] = A.dbfs(A.rmsOf(buf));
        }
        const ref = st.pluck !== undefined ? st.pluck : st.bass;
        const line = kinds.map((k) => k + ' ' + st[k].toFixed(1) + '(' + (st[k] - ref).toFixed(0) + ')').join(' · ');
        console.log('    ' + (id + (NEW_BGM.some((t) => t.id === id) ? ' ←新增' : '')).padEnd(16) + line);
        /* 铺底（bass+pad 的平均）比旋律层高多少 —— 衡量"旋律会不会被埋掉" */
        const bed = kinds.filter((k) => k === 'bass' || k === 'pad');
        if (bed.length && st.pluck !== undefined) {
            const bedDb = bed.reduce((a, k) => a + st[k], 0) / bed.length;
            profiles[id] = bedDb - st.pluck;
        }
    }
    console.log('  铺底高于旋律层: ' + Object.keys(profiles).map((k) => k + ' ' + profiles[k].toFixed(1) + 'dB').join(' · '));
    /* 校准依据：既有三套是 6~14dB。新曲若明显更高（>16dB），旋律会被铺底埋掉。 */
    const bedBad = [];
    for (const t of NEW_BGM) {
        if (profiles[t.id] > 16) bedBad.push(t.id + ' 铺底高 ' + profiles[t.id].toFixed(1) + 'dB（既有 6~14dB）');
    }
    check('新增 BGM 铺底不压过旋律（铺底高于旋律 ≤ 16dB）', bedBad.length === 0, bedBad.join(' | '));
}

/* ------------------------------------------------------------------
 * 7. 清单 + 报告
 * ------------------------------------------------------------------ */
const manifest = {
    generatedAt: '2026-10-22',
    note: '本批为**新增**资产，未改动任何既有文件；BGM 与 SFX 共用 audio.js 的音色族与混响。',
    sampleRate: SR,
    format: '16-bit PCM mono',
    bgm: NEW_BGM.map((t) => {
        const tr = A.BGM_TRACKS[t.id];
        return {
            id: t.id, label: t.label, mood: t.mood, bpm: tr.bpm, bars: tr.bars,
            loopSeconds: +tr.loopSeconds.toFixed(2),
            file: t.file, previewFile: t.file.replace('.wav', '_preview.wav'),
            melodyNotes: tr.events.filter((e) => e.kind === 'pluck').length,
            chimeNotes: tr.events.filter((e) => e.kind === 'chime').length,
            noiseEvents: tr.events.filter((e) => e.wave === 'noise').length,
            metrics: {
                dynamic500msDb: +metrics[t.id].dyn.toFixed(1),
                seamJumpDb: +metrics[t.id].seamJump.toFixed(1),
                lowFreqCrestDb: +metrics[t.id].crest.toFixed(1)
            }
        };
    }),
    sfx: NEW_SFX_IDS.map((id) => {
        const def = NEW_SFX_DEFS[id];
        const notes = A.sfxEvents(id).map((e) => e.name).filter(Boolean);
        const row = rows.find((r) => r.name === 'sfx_' + id + '.wav');
        return {
            id, label: def.label, file: 'sfx_' + id + '.wav',
            dur: def.dur, tone: def.tone || def.kind, notes,
            peakDbfs: row ? +row.peak : null, rmsDbfs: row ? +row.rms : null
        };
    })
};
fs.writeFileSync(path.join(OUT_DIR, 'audio_extra_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

console.log('');
console.log('==== render_audio_extra ====');
console.log('输出目录: ' + OUT_DIR);
console.log('采样率  : ' + SR + ' Hz / 16-bit / mono');
console.log('--------------------');
console.log('文件'.padEnd(32) + '用途'.padEnd(8) + '秒'.padEnd(8) + '峰值dBFS'.padEnd(12) + 'RMS dBFS'.padEnd(12) + 'KB');
for (const r of rows) {
    console.log(r.name.padEnd(32) + r.tag.padEnd(8) + r.sec.padEnd(8) + r.peak.padEnd(12) + r.rms.padEnd(12) + r.kb);
}
console.log('--------------------');
console.log('断言: ' + pass + ' 通过 / ' + fail + ' 失败');
if (fails.length) {
    for (const f of fails) console.log('  [FAIL] ' + f);
} else {
    console.log('  全部通过');
}
console.log('');
console.log('RESULT: WROTE ' + rows.length + ' files (new only, nothing overwritten)');
console.log('');
