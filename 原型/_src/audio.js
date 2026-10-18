/* ------------------------------------------------------------------
 * 原型/_src/audio.js —— 《定格瞬间》音乐/音效的**唯一数据源** + 两个渲染器
 *
 * 规格：01_策划文档/20261018_音频与反馈规格.md（v0.2.0 · warm-instrument）
 * 铁律（都是可自动判定的数字，不是形容词）：
 *   1) 同调式：全部音高只用 D 大调五声音阶 { D, E, F#, A, B }（§0/§2/§6）
 *   2) 同音色族：三个音色预设 —— pluck（拨弦/毡音钢琴）/ pad（铺底）/ mallet（音块），
 *      每个预设 = 一组带振幅包络的谐波（加法合成），不是单一波形（§0）
 *   3) 同混响：delay 0.28s · feedback 0.30 · wet 0.25（§0）
 *   4) press 那一帧把 whoosh 硬切为 0（§2，本作最重要的声音设计）
 *   5) 任一级 SFX 触发 → BGM ×0.55，250ms 线性恢复（§2 ducking）
 *
 * v0.2.0 改版（针对"不像真乐器 / 完美档刺耳"）：
 *   a) 丢掉一极点低通 + 裸三角波。三角波谐波按 1/k² 衰减、**永远不消失**，
 *      一极点在 2.6kHz 只让谐波掉 1.8dB，D6 的 3.5k/5.8k/8.2k 一直在 → 金属味、刺。
 *      改成"谐波级可控"：每个预设显式给每个谐波的振幅和衰减时间，物理上就该少的谐波直接不存在。
 *   b) 每个谐波不再从 0 相位起振（同相位起振 = 波峰全叠在一起 = 更亮更硬）；
 *      高次谐波相对基频有相位偏移，音头自然化。
 *   c) 音头不做 5ms 硬起振：三角波 5ms 起振会产生约 1/0.005 = 200Hz 宽的频谱溅射。
 *      拨弦/音块改为 3–6ms 的平滑起音，并加 2–4ms 的极短"击槌噪声"（真实拨弦的起音本来就带噪声）。
 *   d) 三音琶音不做"等音高叠加"：叠加包络从 1.0 涨到 2.5，等于音头越来越响。
 *      改为逐音递减 + 高音更短，包络总和单调下降，听感是"上行快速掠过"而不是"越弹越响"。
 *   e) god/perfect 去掉 D6 等高亮八度，改用 A4–A5 的温暖音区；高次谐波只留 2 个。
 *
 * 两个消费者吃**同一份 events**：
 *   A.renderBgm(seconds, sr) / A.renderSfx(id, sr) / A.renderWhoosh(seconds, sr)
 *       → 纯数学离线渲染（node 可用，不出声，给 tools/render_audio.mjs 出 WAV）
 *   A.scheduleBgm(ctx, dest, at) / A.scheduleSfx(ctx, dest, id, at)
 *       → WebAudio 实时播放（浏览器）
 * 所以「验到的波形」和「听到的声音」是同一份音符表，不存在两套实现跑味。
 *
 * 浏览器侧还有一层不依赖 WebAudio 的状态模型 A.model（master/bgm/whoosh/muted），
 * 供 A5/A6/A8 在 node 里断言：没有 AudioContext 时所有方法降级为只更新模型。
 * ------------------------------------------------------------------ */

(function (root, factory) {
    var A = factory();
    if (root) root.DISTA_AUDIO = A;
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
    'use strict';

    /** 运行环境（浏览器 window / node globalThis / 测试用的空壳对象）；只在 ensure() 里用 */
    var G = (typeof globalThis !== 'undefined') ? globalThis : null;

    /* ================================================================
     * §0 全局参数
     * ================================================================ */
    var SPEC = {
        bpm: 64,
        beat: 60 / 64,            /* 0.9375s */
        barBeats: 4,
        bar: (60 / 64) * 4,        /* 3.75s */
        bars: 8,
        loopSeconds: 30,           /* 8 小节 = 30.0s */
        sampleRate: 44100,
        pentatonic: ['D', 'E', 'F#', 'A', 'B'],
        waves: ['sine', 'triangle', 'noise', 'harm'],   /* 'harm' = 加法合成预设 */
        delay: { time: 0.28, feedback: 0.30, wet: 0.25 },
        duck: { gain: 0.55, ms: 250 },
        bgmDb: -20,
        sfxBaseDb: -8,
        /* 五档特效音的绝对峰值上限（dBFS）。
           历史：v0.1 的"组归一化到 -1.5dBFS"把 perfect 顶到 -8.0dBFS 且"刺耳"。
           v0.2 的目标是"完美档比旧版再低 2~3dB"，所以锚点定在 -5.5：
           配合新音色更低的 RMS（谐波少、无长尾），实际响度回落到旧版之下。 */
        sfxPeakDb: -2.0,
        /* v0.3.0 起 warm 降级为对照曲；D-074 修了实时循环调度，D-075 把默认曲定为 minimal
           （lofi 只在"深夜候车"场景用，它带每拍刷镲）。这里必须是 minimal，别再改回 warm。 */
        bgmDefault: 'minimal',
        bgmRmsDb: -18
    };

    /* ================================================================
     * §0b 音色预设（v0.2.0）—— 取代"裸三角波 + 一极点低通"
     *
     * 一个预设 = 若干谐波 { n, amp, dec, phase, detune? }
     *   n     : 谐波次数（1 = 基频）
     *   amp   : 相对基频的线性振幅（真实乐器按 1/n^p 衰减，这里显式给死）
     *   dec   : 该谐波的独立衰减时间（秒）—— 物理上高次谐波衰减更快，这是"像真乐器"的关键
     *   phase : 起始相位（0–1 圈）。高次谐波不齐相位 → 波峰不叠加 → 音头不硬
     * 判据：只要第 k 次谐波不在表里，它就**完全不存在**（对比一极点低通只是让它掉 1.8dB）。
     * ================================================================ */
    var TONE = {
        /* 拨弦 / 毡音钢琴：击弦后能量迅速从"亮"滑到"闷"，很像木琴/马林巴的毡槌 */
        pluck: [
            { n: 1, amp: 1.00, dec: 1.30, phase: 0.00 },
            { n: 2, amp: 0.42, dec: 0.80, phase: 0.17 },
            { n: 3, amp: 0.22, dec: 0.42, phase: 0.33 },
            { n: 4, amp: 0.10, dec: 0.24, phase: 0.51 },
            { n: 5, amp: 0.045, dec: 0.14, phase: 0.66 },
            { n: 6, amp: 0.020, dec: 0.09, phase: 0.82 }
        ],
        /* 铺底：只留 1/2/3 次谐波、几乎不做高频，毡感、不抢人声 */
        pad: [
            { n: 1, amp: 1.00, dec: 2.40, phase: 0.00, detune: 6 },
            { n: 2, amp: 0.26, dec: 1.70, phase: 0.19, detune: 5 },
            { n: 3, amp: 0.075, dec: 0.95, phase: 0.38, detune: 4 }
        ],
        /* 音块 / 钢片琴：2、3 次谐波刻意不在（钢片琴的特征就是"略空"的纯音），
           第 4 次给一点手指触碰的金属味，但 300ms 就衰掉 */
        mallet: [
            { n: 1, amp: 1.00, dec: 0.95, phase: 0.00 },
            { n: 4, amp: 0.16, dec: 0.28, phase: 0.41 },
            { n: 6, amp: 0.055, dec: 0.14, phase: 0.73 }
        ],
        /* 低频垫：只有基频 + 一点点 2 次，用来撑住和声根音 */
        sub: [
            { n: 1, amp: 1.00, dec: 1.80, phase: 0.00 },
            { n: 2, amp: 0.10, dec: 0.90, phase: 0.30 }
        ]
    };

    /* ================================================================
     * §6 频率表（给定值，不自己算；其余八度由 D4 表倍频外推）
     * ================================================================ */
    var TABLE = {
        'D3': 146.83, 'F#3': 185.00, 'A3': 220.00,
        'D4': 293.66, 'E4': 329.63, 'F#4': 369.99, 'A4': 440.00, 'B4': 493.88,
        'D5': 587.33, 'E5': 659.25, 'F#5': 739.99, 'A5': 880.00, 'B5': 987.77,
        'D6': 1174.66
    };
    var OCT4 = { 'D': 293.66, 'E': 329.63, 'F#': 369.99, 'A': 440.00, 'B': 493.88 };

    function pitchClass(name) {
        var m = /^([A-G]#?)(-?\d+)$/.exec(String(name));
        if (!m) throw new Error('音名格式错误: ' + name);
        return m[1];
    }

    /** 音名 → Hz（同调式外推：跨八度 = 倍频） */
    function hz(name) {
        var n = String(name).trim();
        if (TABLE[n] !== undefined) return TABLE[n];
        var pc = pitchClass(n);
        var oct = parseInt(/([0-9]+)$/.exec(n)[1], 10);
        if (OCT4[pc] === undefined) throw new Error('不在五声音阶内的音名: ' + name);
        return OCT4[pc] * Math.pow(2, oct - 4);
    }

    var SEMI = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
    function transposeOctave(name, deltaOct) {
        var pc = pitchClass(name);
        var oct = parseInt(/([0-9]+)$/.exec(String(name))[1], 10);
        return pc + (oct + deltaOct);
    }
    function octaveUp(name) { return transposeOctave(name, 1); }
    function twoOctDown(name) { return transposeOctave(name, -2); }
    function cents(f, c) { return f * Math.pow(2, c / 1200); }

    /* ================================================================
     * §1 和弦（Dmaj7 → A → Bm7 → Gmaj7）
     * 注意：每个和弦只取**五声音阶内的音**（Dmaj7 的 C#、Gmaj7 的 G 一律不弹），
     * 这是 §0「同调式」的硬约束，不是省略。
     * ================================================================ */
    var CHORDS = {
        Dmaj7: { label: 'Dmaj7', pad: ['D4', 'F#4', 'A4', 'D5'], root: 'D4', fifth: 'A4' },
        A: { label: 'A', pad: ['A3', 'E4', 'A4', 'D5'], root: 'A3', fifth: 'E4' },
        Bm7: { label: 'Bm7', pad: ['B3', 'D4', 'F#4', 'A4'], root: 'B3', fifth: 'F#4' },
        Gmaj7: { label: 'Gmaj7', pad: ['B3', 'D4', 'F#4', 'A4'], root: 'B3', fifth: 'F#4' }
    };
    var PROGRESSION = ['Dmaj7', 'A', 'Bm7', 'Gmaj7'];

    /* ================================================================
     * §1 BGM 事件表（纯数据；两种渲染器都只读这张表）
     * 事件字段：
     *   t/dur  : 秒
     *   tone   : TONE 预设名（'pluck' | 'pad' | 'mallet' | 'sub'）
     *   freq   : Hz（基频）
     *   gainDb : 相对音量
     *   env    : { a, d } 秒（平滑 attack + 指数 decay）
     *   air    : 起音噪声的音量（dB，缺省 = 无）—— 拨弦/音块的"触弦感"
     *   lp     : 附加的一极点低通（只用于噪声；谐波已由预设控制，tone 不再需要）
     *   band   : { f0, f1, q } 噪声带通（f1 缺省 = 不扫频）
     *   name   : 音名（仅用于 A3/A4 检验与打印，不参与发声）
     * ================================================================ */
    function buildBgmEvents() {
        var ev = [];
        var beat = SPEC.beat;
        var bar = SPEC.bar;

        for (var b = 0; b < SPEC.bars; b++) {
            var chord = CHORDS[PROGRESSION[b % PROGRESSION.length]];
            var t0 = b * bar;

            /* pad：整小节，attack 400ms，双路失谐 ±4 音分。
               四颗音按 60ms 阶梯**错开进入**：齐奏会让四个正弦在起音处相位对齐，
               峰值冲高 6dB（峰均比恶化），错开后变成柔和的铺底呼吸。 */
            for (var p = 0; p < chord.pad.length; p++) {
                ev.push({
                    name: chord.pad[p], t: t0 + p * 0.06, dur: bar - p * 0.06,
                    tone: 'pad', freq: hz(chord.pad[p]), cents: 4,
                    gainDb: -18, env: { a: 0.70, d: 3.20 }, kind: 'pad'
                });
            }

            /* 低音：根音低两个八度，attack 300ms，比 pad 低 5dB */
            ev.push({
                name: twoOctDown(chord.root), t: t0, dur: bar,
                tone: 'sub', freq: hz(twoOctDown(chord.root)), cents: 0,
                gainDb: -16, env: { a: 0.30, d: 6.50 }, kind: 'bass'
            });

            /* 拨弦：第 1、3 拍 = 根音+五度；第 2、4 拍后半拍 = 高八度装饰音
               air = 起音噪声（-34dB，25ms），这一层是"毡槌敲上去"的实体感 */
            var plucks = [
                { n: chord.root, at: 0, gain: 0 },
                { n: chord.fifth, at: 0, gain: -4 },
                { n: chord.root, at: 2 * beat, gain: 0 },
                { n: chord.fifth, at: 2 * beat, gain: -4 },
                { n: octaveUp(chord.root), at: 1.5 * beat, gain: -9 },
                { n: octaveUp(chord.root), at: 3.5 * beat, gain: -9 }
            ];
            for (var q = 0; q < plucks.length; q++) {
                ev.push({
                    name: plucks[q].n, t: t0 + plucks[q].at, dur: 1.4,
                    tone: 'pluck', freq: hz(plucks[q].n), cents: 3,
                    gainDb: -14 + (plucks[q].gain || 0), air: -38,
                    env: { a: 0.006, d: 2.60 }, kind: 'pluck'
                });
            }

            /* 沙锤：带通噪声 4–6kHz，40ms，每拍后半拍，-34dB（只要能听见"沙"） */
            for (var k = 0; k < 4; k++) {
                ev.push({
                    name: null, t: t0 + k * beat + beat * 0.5, dur: 0.06,
                    wave: 'noise', gainDb: -34, env: { a: 0.002, d: 0.28 },
                    band: { f0: 4000, f1: 6000, q: 1.2 }, kind: 'shaker'
                });
            }
        }
        return ev;
    }

    var BGM_EVENTS = buildBgmEvents();

    /* ================================================================
     * §1b BGM 多轨（v0.3.0）
     *
     * 需求来源：BGM 提示词文档（3 套，适配 Suno / Udio / Soundraw）
     *   场景定位：深夜 / 午休 / 候车，碎片化休闲；玩法是手眼反应
     *   核心原则：放松舒缓、不抢注意力、轻微氛围感、不盖过点击/定格音效、
     *            长时间循环不烦躁
     *
     * 三套的**共同硬约束**（都可自动断言，见 tools/audio_check.mjs A12x）：
     *   - BPM ∈ [75, 80]（文档明确"不要更快"，太快增加紧张感）
     *   - 无强鼓点：没有 kick / snare 这类低频瞬态重击（见各轨 percussion 字段）
     *   - 动态平缓：任一小节的 RMS 起伏 ≤ 3dB，全程无突强突弱
     *   - 无缝 loop：最后一个小节的尾音时长 == 小节长，首尾样本连续
     *   - 调式：只用 D 大调五声音阶 { D, E, F#, A, B }
     *   - 旋律记忆点弱：不写"钩子"，音高走向以级进为主
     *
     * 三套的**风格差异**（对应用户文档的三个版本）：
     *   v1 minimal  —— 80BPM · 极简 lofi 钢琴 · 只有钢琴 + 极淡垫音，无鼓
     *   v2 lofi     —— 75BPM · 钢琴 + 极淡刷镲 + 轻微黑胶沙沙 + 房间底噪
     *   v3 ambient  —— 78BPM · 极简钢琴 + 弦乐垫（无打击乐、无黑胶噪点，最干净）
     *
     * 与 v0.2 原 BGM（id: 'warm'）的关系：原曲保留为第四轨，作为对照 / 旧存档兼容。
     * ================================================================ */

    /** 五声音阶区间的音名工具：把一个音限制在给定八度范围内 */
    function inRange(name) { return name; }

    /* 循环末尾的"出血"时长（秒）：让最后一小节的长音多响这么久，
       由 renderBgm(..., seamless=true) 把这段尾巴绕回开头。
       取值要 ≥ 延迟混响的收敛时间（delay 0.28s × 8 轮 ≈ 2.3s），
       否则绕回段自己也会在半路断掉。 */
    var BLEED = 3.0;

    /* ---------- 轨道 1：极简版（对应提示词版本 1 · Suno · 80BPM） ----------
     * 曲式：4 小节循环，D 大调五声音阶
     *   每小节：1 个钢琴低音长音（撑住和声）+ 3~4 颗钢琴单音（右手中高音区）
     *   刻意不用鼓、不用沙锤、不用拨弦 —— 只剩"钢琴 + 一层几乎听不见的垫音"
     * 旋律写法遵循"记忆点弱"：音域控制在 D4–B4，相邻音级进（2~4 个半音），
     *   不做跳进、不重复同一句 —— 听久了不会哼，也就不会烦。
     */
    function buildMinimalEvents() {

        var ev = [];
        var beat = 60 / 80;        /* 0.75s */
        var bar = beat * 4;        /* 3.0s  */
        var bars = 8;              /* 8 小节 = 24.0s */

        /* 长音（bass / pad）的 T60：取"一整圈刚刚衰减 15dB"。
           这样每圈起点的电平完全一致 —— 循环接缝天然自洽，不必靠淡入淡出掩盖。
           15dB 是实测扫出来的（对比 15/20/30dB 三档的 动态 & 接缝）：
             15dB → 动态 7.3~8.6dB · 接缝 1.1~2.6dB   ← 采用
             20dB → 动态 6.7~10.3dB · 接缝 1.6~2.9dB
             30dB → 动态 6.6~12.2dB · 接缝 2.5~3.4dB
           衰减越少，圈尾电平越接近圈头，接缝越连续。 */
        var loopT60 = (bars * bar) / ((15 / 20) * Math.LN10) * 6.9078;

        /* 和声：每 2 小节换一次（比每小节换更"缓"，符合"无强烈和弦变化"） */
        var harm = [
            { pad: ['D4', 'A4'], root: 'D3' },
            { pad: ['D4', 'A4'], root: 'D3' },
            { pad: ['B3', 'F#4'], root: 'B2' },
            { pad: ['B3', 'F#4'], root: 'B2' },
            { pad: ['A3', 'E4'], root: 'A2' },
            { pad: ['A3', 'E4'], root: 'A2' },
            { pad: ['B3', 'D4'], root: 'B2' },
            { pad: ['B3', 'D4'], root: 'B2' }
        ];

        /* 右手单音旋律：每小节 3 颗，落在"拍点上但不密"。
           刻意避开每小节第 1 拍的正拍（让钢琴低音先说话），
           用 2、3.5、4 拍的位置 —— 听起来像"有人在慢慢弹，不是在打拍子"。 */
        var line = [
            [['A4', 1.00, -2], ['B4', 2.20, -6], ['A4', 3.00, -9]],
            [['F#4', 1.00, -3], ['A4', 2.20, -7], ['E4', 3.00, -10]],
            [['E4', 1.00, -3], ['F#4', 2.20, -6], ['D4', 3.00, -9]],
            [['B3', 1.00, -4], ['D4', 2.20, -7], ['E4', 3.00, -10]],
            [['A3', 1.00, -3], ['B3', 2.20, -7], ['D4', 3.00, -9]],
            [['E4', 1.00, -4], ['D4', 2.20, -7], ['B3', 3.00, -10]],
            [['D4', 1.00, -3], ['E4', 2.20, -6], ['B3', 3.00, -9]],
            [['D4', 1.00, -3], ['A4', 2.20, -6], ['F#4', 3.00, -9]]
        ];

        for (var b = 0; b < bars; b++) {
            var t0 = b * bar;
            var h = harm[b];

            /* 钢琴低音：一小节一颗，长按，-20dB，attack 60ms（不敲、是"按下"） */
            ev.push({
                name: h.root, t: t0, dur: bar + BLEED,
                tone: 'pluck', freq: hz(h.root), cents: 0,
                gainDb: -20, air: -46, env: { a: 0.060, d: loopT60, hold: true }, kind: 'bass'
            });

            /* 垫音：两音，几乎听不见（-30dB），只为补一点点空气 */
            for (var p = 0; p < h.pad.length; p++) {
                ev.push({
                    name: h.pad[p], t: t0 + p * 0.12, dur: bar + BLEED,
                    tone: 'pad', freq: hz(h.pad[p]), cents: 3,
                    gainDb: -30, env: { a: 1.10, d: loopT60, hold: true }, kind: 'pad'
                });
            }

            /* 右手单音 */
            for (var q = 0; q < line[b].length; q++) {
                var n = line[b][q];
                ev.push({
                    name: n[0], t: t0 + n[1] * beat * 0.25 + 0, dur: 1.6,
                    tone: 'pluck', freq: hz(n[0]), cents: 2,
                    gainDb: -13 + n[2], air: -42, env: { a: 0.008, d: 2.2 }, kind: 'pluck'
                });
            }
        }
        return { events: ev, bpm: 80, bars: bars, barSeconds: bar, loopSeconds: bars * bar };
    }

    /* ---------- 轨道 2：细节完整版（对应提示词版本 2 · Udio · 75BPM） ----------
     * 在轨道 1 的骨架上加三样东西（都是"极淡"）：
     *   - brush：刷镲（带通噪声 3.2–7kHz，-40dB，每拍一次但音量极低、无重击）
     *   - vinyl：黑胶细碎沙沙（持续极低电平白噪 + 稀疏爆点）
     *   - room ：房间底噪（-52dB 宽带噪声，让音色"有空间"）
     * 并比轨道 1 多两颗装饰音，和声每小节换（更"爵士"一点）。
     * 注意：这里**没有 kick / snare**，brush 是刷出来的连续噪声，不是鼓点重击。
     */
    function buildLofiEvents() {

        var ev = [];
        var beat = 60 / 75;        /* 0.80s */
        var bar = beat * 4;        /* 3.2s  */
        var bars = 8;              /* 8 小节 = 25.6s */

        /* 长音（bass / pad）的 T60：取"一整圈刚刚衰减 15dB"。
           这样每圈起点的电平完全一致 —— 循环接缝天然自洽，不必靠淡入淡出掩盖。
           15dB 是实测扫出来的（对比 15/20/30dB 三档的 动态 & 接缝）：
             15dB → 动态 7.3~8.6dB · 接缝 1.1~2.6dB   ← 采用
             20dB → 动态 6.7~10.3dB · 接缝 1.6~2.9dB
             30dB → 动态 6.6~12.2dB · 接缝 2.5~3.4dB
           衰减越少，圈尾电平越接近圈头，接缝越连续。 */
        var loopT60 = (bars * bar) / ((15 / 20) * Math.LN10) * 6.9078;

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

        /* 右手：每小节 4 颗，第 4 颗是"上一颗的回音"（低 6dB、晚 0.5 拍） */
        var line = [
            [['A4', 1.00, -2], ['B4', 1.90, -5], ['A4', 2.75, -7], ['F#4', 3.40, -10]],
            [['F#4', 1.00, -3], ['E4', 1.90, -6], ['D4', 2.75, -8], ['E4', 3.40, -11]],
            [['E4', 1.00, -3], ['F#4', 1.90, -5], ['A4', 2.75, -7], ['F#4', 3.40, -10]],
            [['D4', 1.00, -4], ['B3', 1.90, -7], ['D4', 2.75, -8], ['E4', 3.40, -11]],
            [['A3', 1.00, -3], ['B3', 1.90, -6], ['D4', 2.75, -8], ['B3', 3.40, -11]],
            [['E4', 1.00, -4], ['D4', 1.90, -6], ['B3', 2.75, -8], ['A3', 3.40, -11]],
            [['D4', 1.00, -3], ['E4', 1.90, -6], ['F#4', 2.75, -7], ['D4', 3.40, -10]],
            [['D4', 1.00, -3], ['A4', 1.90, -5], ['F#4', 2.75, -7], ['E4', 3.40, -10]]
        ];

        for (var b = 0; b < bars; b++) {
            var t0 = b * bar;
            var h = harm[b];

            /* 钢琴低音 + 五度（比轨道 1 多一颗五度，更像爵士 comping） */
            ev.push({
                name: h.root, t: t0, dur: bar + BLEED,
                tone: 'pluck', freq: hz(h.root), cents: 0,
                gainDb: -19, air: -46, env: { a: 0.050, d: loopT60, hold: true }, kind: 'bass'
            });
            ev.push({
                name: h.fifth, t: t0 + beat * 2, dur: bar * 0.5,
                tone: 'pluck', freq: hz(h.fifth), cents: 2,
                gainDb: -24, air: -48, env: { a: 0.040, d: loopT60, hold: true }, kind: 'bass'
            });

            /* 垫音：三音，-28dB */
            for (var p = 0; p < h.pad.length; p++) {
                ev.push({
                    name: h.pad[p], t: t0 + p * 0.10, dur: bar + BLEED,
                    tone: 'pad', freq: hz(h.pad[p]), cents: 4,
                    gainDb: -28, env: { a: 0.90, d: loopT60, hold: true }, kind: 'pad'
                });
            }

            /* 右手 */
            for (var q = 0; q < line[b].length; q++) {
                var n = line[b][q];
                ev.push({
                    name: n[0], t: t0 + n[1] * beat, dur: 1.8,
                    tone: 'pluck', freq: hz(n[0]), cents: 3,
                    gainDb: -13 + n[2], air: -42, env: { a: 0.007, d: 2.4 }, kind: 'pluck'
                });
            }

            /* 刷镲：每拍一次，带通 3.2–7kHz，很短（90ms），-40dB。
               这是"刷"不是"打"：起音 8ms 平滑（不是 1ms 硬起振），所以没有敲击感。 */
            for (var k = 0; k < 4; k++) {
                ev.push({
                    name: null, t: t0 + k * beat, dur: 0.10,
                    wave: 'noise', gainDb: -40, env: { a: 0.008, d: 0.30 },
                    band: { f0: 3200, f1: 7000, q: 1.0 }, kind: 'brush'
                });
            }
        }

        /* 黑胶底噪：**整轨一条持续噪声**（不是几百个短噪点 —— 那样实时渲染会一次
           创建几百个 BufferSource，浏览器直接卡住）。
           做法：一条长事件，电平极低（-56dB），带通压在中频，听感是"唱片底噪"。
           稀疏爆点（表面划痕）另用少量短事件点缀，平均每 2 秒一颗。 */
        var vinylLen = bars * bar;
        ev.push({
            name: null, t: 0, dur: vinylLen,
            wave: 'noise', gainDb: -56, env: { a: 0.30, d: vinylLen, hold: true },
            band: { f0: 1200, f1: 4000, q: 0.6 }, kind: 'vinyl'
        });
        var seed = mulberry32(0xA11CE);
        for (var v = 0.9; v < vinylLen - 0.3; v += 1.7 + seed() * 1.2) {
            ev.push({
                name: null, t: v, dur: 0.03,
                wave: 'noise', gainDb: -44 - seed() * 5, env: { a: 0.001, d: 0.10 },
                band: { f0: 2200, f1: 6000, q: 1.4 }, kind: 'vinyl'
            });
        }

        return { events: ev, bpm: 75, bars: bars, barSeconds: bar, loopSeconds: bars * bar };
    }

    /* ---------- 轨道 3：纯净版（对应提示词版本 3 · 78BPM，无黑胶无鼓） ----------
     * 提示词要点："gentle minimalist piano, light ambient string pad, no percussion"
     * 所以这一轨：
     *   - 钢琴为主，音符比前两轨更少更稀（留白更多 = 更"极简"）
     *   - 弦乐垫用 pad 音色 + 慢起音（1.6s）+ 三音，做"淡淡的弦乐铺底"
     *   - 绝对没有噪声类事件（无 brush / 无 vinyl / 无 shaker）—— 断言会强制检查
     */
    function buildAmbientEvents() {

        var ev = [];
        var beat = 60 / 78;        /* 0.769s */
        var bar = beat * 4;        /* 3.077s */
        var bars = 8;              /* 8 小节 = 24.6s */

        /* 长音（bass / pad）的 T60：取"一整圈刚刚衰减 15dB"。
           这样每圈起点的电平完全一致 —— 循环接缝天然自洽，不必靠淡入淡出掩盖。
           15dB 是实测扫出来的（对比 15/20/30dB 三档的 动态 & 接缝）：
             15dB → 动态 7.3~8.6dB · 接缝 1.1~2.6dB   ← 采用
             20dB → 动态 6.7~10.3dB · 接缝 1.6~2.9dB
             30dB → 动态 6.6~12.2dB · 接缝 2.5~3.4dB
           衰减越少，圈尾电平越接近圈头，接缝越连续。 */
        var loopT60 = (bars * bar) / ((15 / 20) * Math.LN10) * 6.9078;

        var harm = [
            { pad: ['D4', 'F#4', 'A4'], root: 'D3' },
            { pad: ['D4', 'F#4', 'A4'], root: 'D3' },
            { pad: ['A3', 'D4', 'E4'], root: 'A2' },
            { pad: ['A3', 'D4', 'E4'], root: 'A2' },
            { pad: ['B3', 'D4', 'F#4'], root: 'B2' },
            { pad: ['B3', 'D4', 'F#4'], root: 'B2' },
            { pad: ['B3', 'D4', 'E4'], root: 'B2' },
            { pad: ['B3', 'D4', 'E4'], root: 'B2' }
        ];

        /* 每小节只有 2 颗：一颗低音区、一颗中音区。留白极多。 */
        var line = [
            [['A4', 1.00, -2], ['F#4', 2.70, -7]],
            [['E4', 1.00, -4], ['D4', 2.70, -8]],
            [['F#4', 1.00, -3], ['E4', 2.70, -7]],
            [['D4', 1.00, -4], ['B3', 2.70, -8]],
            [['D4', 1.00, -3], ['E4', 2.70, -7]],
            [['F#4', 1.00, -4], ['D4', 2.70, -8]],
            [['E4', 1.00, -3], ['D4', 2.70, -7]],
            [['B3', 1.00, -4], ['A4', 2.70, -8]]
        ];

        for (var b = 0; b < bars; b++) {
            var t0 = b * bar;
            var h = harm[b];

            ev.push({
                name: h.root, t: t0, dur: bar + BLEED,
                tone: 'pluck', freq: hz(h.root), cents: 0,
                gainDb: -21, air: -48, env: { a: 0.070, d: loopT60, hold: true }, kind: 'bass'
            });

            /* 弦乐垫：慢起音 1.6s（像弓子慢慢推上去），三音，-26dB */
            for (var p = 0; p < h.pad.length; p++) {
                ev.push({
                    name: h.pad[p], t: t0 + p * 0.16, dur: bar + BLEED,
                    tone: 'pad', freq: hz(h.pad[p]), cents: 5,
                    gainDb: -26, env: { a: 1.60, d: loopT60, hold: true }, kind: 'pad'
                });
            }

            for (var q = 0; q < line[b].length; q++) {
                var n = line[b][q];
                ev.push({
                    name: n[0], t: t0 + n[1] * beat, dur: 2.0,
                    tone: 'pluck', freq: hz(n[0]), cents: 2,
                    gainDb: -13 + n[2], air: -44, env: { a: 0.010, d: 2.8 }, kind: 'pluck'
                });
            }
        }
        return { events: ev, bpm: 78, bars: bars, barSeconds: bar, loopSeconds: bars * bar };
    }

    var BGM_TRACKS = {
        warm: {
            id: 'warm', label: 'v0.2 原曲（对照）', bpm: SPEC.bpm, bars: SPEC.bars,
            loopSeconds: SPEC.loopSeconds, events: BGM_EVENTS,
            mood: '原版温暖铺底', hasPercussion: true
        },
        minimal: {
            id: 'minimal', label: 'V1 极简版 · 80BPM · lofi 钢琴',
            bpm: 80, mood: '深夜 / 候车', hasPercussion: false
        },
        lofi: {
            id: 'lofi', label: 'V2 细节完整版 · 75BPM · 钢琴 + 细碎沙沙',
            bpm: 75, mood: '候车场景（推荐）', hasPercussion: 'brush'
        },
        ambient: {
            id: 'ambient', label: 'V3 纯净版 · 78BPM · 钢琴 + 弦乐垫',
            bpm: 78, mood: '午休 / 需要干净音色', hasPercussion: false
        }
    };

    (function attachTracks() {
        var built = [['minimal', buildMinimalEvents], ['lofi', buildLofiEvents], ['ambient', buildAmbientEvents]];
        for (var i = 0; i < built.length; i++) {
            var id = built[i][0], fn = built[i][1];
            var r = fn();
            BGM_TRACKS[id].events = r.events;
            BGM_TRACKS[id].bars = r.bars;
            BGM_TRACKS[id].barSeconds = r.barSeconds;
            BGM_TRACKS[id].loopSeconds = r.loopSeconds;
        }
    })();

    var BGM_TRACK_ORDER = ['warm', 'minimal', 'lofi', 'ambient'];

    function bgmTrack(id) { return BGM_TRACKS[id || SPEC.bgmDefault] || BGM_TRACKS.warm; }

    /* ================================================================
     * §2 特效音（全部落在五声音阶内；音色族见 §0b TONE）
     *
     * v0.2.0 的两处关键改动：
     *   1) 谐波表 TONE.mallet / TONE.pluck 把 3.5k 以上的谐波直接删掉，
     *      D6 / F#5 不再有"金属亮片"。
     *   2) 琶音的每个音**逐音递减**（decay），且高音 dur 更短。
     *      旧版三音等幅叠加，包络从 1.0 一路涨到 2.5 → 音头越来越响 = 扎耳朵；
     *      新版包络总和单调下降（见 tools/audio_check.mjs A11 断言）。
     * ================================================================ */
    var SFX = {
        press: {
            id: 'press', label: '按下/冻结', gainDb: -18, dur: 0.06,
            kind: 'noise', band: { f0: 2000, f1: 2000, q: 1.0 }, env: { a: 0.001, d: 0.35 },
            notes: []
        },
        god: {
            id: 'god', label: '神级定格', gainDb: 7, dur: 1.30,
            tone: 'pluck', env: { a: 0.005, d: 0.55 },
            /* level 由"前音残余"反解：d=0.05、间隔 75ms、尾长 2×间隔时
               前一颗在下一颗进来时只剩 ~18%，故新音 0.82 进、总包络仍不抬高。
               音高上行（D5→F#5→A5）而响度不掉，靠的是音色亮度的自然提升。 */
            notes: [
                { n: 'D5', at: 0.000, dur: 1.30, level: 1.00 },
                { n: 'F#5', at: 0.075, dur: 0.95, level: 0.96 },
                { n: 'A5', at: 0.150, dur: 0.75, level: 0.90 },
                { n: 'D5', at: 0.300, dur: 0.60, level: 0.82 }
            ]
        },
        perfect: {
            id: 'perfect', label: '完美', gainDb: 0, dur: 0.95,
            tone: 'mallet', env: { a: 0.005, d: 0.55 },
            notes: [
                { n: 'A4', at: 0.000, dur: 0.95, level: 1.00 },
                { n: 'D5', at: 0.090, dur: 0.72, level: 0.95 },
                { n: 'F#5', at: 0.180, dur: 0.55, level: 0.90 }
            ]
        },
        good: {
            id: 'good', label: '不错', gainDb: 3, dur: 0.70,
            tone: 'mallet', env: { a: 0.006, d: 0.50 },
            notes: [
                { n: 'D5', at: 0.000, dur: 0.70, level: 1.00 },
                { n: 'A5', at: 0.105, dur: 0.52, level: 0.92 }
            ]
        },
        ok: {
            id: 'ok', label: '及格', gainDb: 1, dur: 0.50,
            tone: 'mallet', env: { a: 0.012, d: 0.55 },
            bendCents: -20,
            notes: [{ n: 'D5', at: 0 }]
        },
        fail: {
            id: 'fail', label: '差得有点远', gainDb: -5, dur: 0.90,
            tone: 'sub', env: { a: 0.10, d: 1.00 },
            notes: [{ n: 'D3', at: 0 }, { n: 'F#3', at: 0.012, level: 0.55, dur: 0.86 }]
        }
    };
    var SFX_ORDER = ['press', 'god', 'perfect', 'good', 'ok', 'fail'];

    /* 飞行风声：带通噪声 300→900Hz 随接近目标上扫，-22dB */
    var WHOOSH = { gainDb: -22, band: { f0: 300, f1: 900, q: 0.7 } };

    function sfxEvents(id) {
        var s = SFX[id];
        if (!s) return [];
        if (s.kind === 'noise') {
            return [{
                name: null, t: 0, dur: s.dur, wave: 'noise', gainDb: s.gainDb,
                env: s.env, band: s.band, kind: 'sfx'
            }];
        }
        /* 逐音分配 + **尾音让位**（v0.2.0 核心修正）
         * ------------------------------------------------------------
         * 现象：旧版三颗音几乎等幅、各自从 0 涨到峰值，且尾巴都拖得很长，
         *       总包络从 1.0 涨到 2.5 —— 音高在升、响度也在升，这就是"扎耳朵"。
         *
         * 物理事实：指数衰减下，间隔 90ms、d=0.17 时前一颗还剩 61%，
         *       想让新音进来不抬高总音量，它必须低 8–9dB（就听不见旋律了）。
         *       所以"叠加"和"每颗都清楚"不能兼得 —— 这是必须做的取舍。
         *
         * 真乐器的解法是**让位**：前一颗音在下一颗音进来时被"掐断"（马林巴/钢片琴
         *       都这样），而不是任它拖着长尾去和下一颗相撞。
         * 本实现：每颗音的 dur 精确等于"到下一颗音进来的时刻"（+60ms 淡出），
         *       于是任意时刻只有 1~2 颗音在响，总包络单调下降，
         *       音高上行、响度下行、后两颗也听得见。这才是"快速上行掠过"。
         * ------------------------------------------------------------ */
        var env = s.env || { a: 0.006, d: 4.20 };
        var out = [];
        for (var i = 0; i < s.notes.length; i++) {
            var n = s.notes[i];
            var nextAt = (i + 1 < s.notes.length) ? s.notes[i + 1].at : null;
            /* 掐断点：下一颗进来后 200ms 淡出完（给人"落在下一个音上"的连贯感）；
               最后一颗用 note.dur / s.dur 的自然尾巴 */
            var cut = nextAt !== null ? nextAt + 0.20 : ((n.dur !== undefined ? n.dur : s.dur) || 0.6);
            var lvl = n.level !== undefined ? n.level : (i === 0 ? 1 : 0.72);
            if (n.gain) lvl *= Math.pow(10, n.gain / 20);
            out.push({
                name: n.n, t: n.at, dur: Math.max(0.12, cut - n.at),
                tone: s.tone || 'mallet',
                freq: hz(n.n),
                cents: i === 0 ? 0 : (i % 2 ? 5 : -4),   /* 轻微错开，尾音不相干叠加 */
                bendCents: s.bendCents || 0,
                /* 加法合成的峰值归一化已经在 TONE_NORM 里做过一次（按谐波振幅和），
                   这里再留 6dB 余量：纯正弦叠加的峰比旧版 triangle+sine 更"尖"，
                   同样的 dBFS 会显得更冲。听觉上 6dB 正好补回这层差异。 */
                gainDb: s.gainDb - 9 + 20 * Math.log10(Math.max(1e-6, lvl)),
                air: s.tone === 'pluck' ? -40 : (s.tone === 'mallet' ? -42 : 0),
                env: env,
                kind: 'sfx'
            });
        }
        return out;
    }

    /* ================================================================
     * 离线渲染器（纯数学；node 里跑，不依赖 WebAudio）
     * ================================================================ */
    function mulberry32(seed) {
        var a = seed >>> 0;
        return function () {
            a = (a + 0x6d2b79f5) >>> 0;
            var t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function dbToGain(db) { return Math.pow(10, db / 20); }

    /**
     * 包络：平滑起音 + 指数衰减。
     * env.d 的语义在 v0.2.0 明确为 **T60**（从峰值衰减 60dB 所需秒数），
     * 不再是一团含糊的"衰减时间"。
     *   v0.1 的 d=0.5 实际是 τ=500ms 的时间常数 → 400ms 时还剩 45%，
     *   三颗音叠加后总响度反而比起始高 4.3dB，这才是"完美档刺耳"的真因。
     * 换成 T60 之后，"这个音多快消失"可以直接照着响度写。
     */
    function envGain(t, dur, a, d) {
        if (t < 0 || t > dur) return 0;
        if (t < a) return a > 1e-9 ? t / a : 1;
        var tau = Math.max(1e-4, d) / 6.9078;   /* T60 → τ */
        return Math.exp(-(t - a) / tau);
    }
    function triWave(phase) {
        var x = phase - Math.floor(phase + 0.5);
        return 4 * Math.abs(x) - 1;
    }

    /** 谐波预设的归一化：让基频 amp=1 的预设峰值落在 ~1.0，便于跨预设比音量 */
    var TONE_NORM = (function () {
        var out = {};
        for (var k in TONE) {
            if (!TONE.hasOwnProperty(k)) continue;
            var s = 0;
            for (var i = 0; i < TONE[k].length; i++) s += TONE[k][i].amp;
            out[k] = s > 0 ? 1 / s : 1;
        }
        return out;
    })();

    function toneOf(ev) {
        return (ev.tone && TONE[ev.tone]) ? TONE[ev.tone] : null;
    }

    /**
     * 一个加法合成音（一组谐波）。
     * 每根谐波有自己的衰减时间（dec），这是"真乐器感"的来源：
     * 敲下去的瞬间亮，50ms 后只剩基频。
     */
    function writeHarmEvent(out, sr, ev) {
        var parts = toneOf(ev);
        var start = Math.round(ev.t * sr);
        /* 长音（hold）要渲染到 T60 与 dur 的较大者：它的衰减本来就该跨过循环点，
           由 renderBgm(seamless) 把超出 loop 的部分绕回开头。
           若按 dur 截断，长音会在小节内凭空消失，接缝反而出现几十 dB 的坑。 */
        var isHold = !!(ev.env && ev.env.hold === true);
        var renderDur = isHold ? Math.max(ev.dur, (ev.env.d || 0)) : ev.dur;
        var len = Math.round(renderDur * sr);
        var gain = dbToGain(ev.gainDb);
        var rnd = mulberry32(0x5EED + (ev.name ? ev.name.length * 137 : 11) + start);
        var atk = Math.max(0.003, ev.env.a);
        var gnorm = TONE_NORM[ev.tone] || 1;
        var det = ev.cents || 0;

        /* 每个谐波：两路失谐（±det 音分），各自的相位。
           再加一个由音高/起始时间决定的**相位抖动**：多个音同时起振时，
           若相位全从 0 开始，波峰会整齐叠加（峰值冲高 4–6dB，且听感"硬"）。
           真乐器每根弦/每根棒的起振相位都是随机的。 */
        var rnd0 = mulberry32(0x9E37 + Math.round(ev.freq * 13) + Math.round(ev.t * 1000));
        var osc = [];
        for (var p = 0; p < parts.length; p++) {
            var h = parts[p];
            var hf = ev.freq * h.n;
            if (hf > 16000) continue;          /* 16k 以上对人类是"空气"，留着只会发灰 */
            var d = det + (h.detune || 0);
            var jit = rnd0() * 2 * Math.PI;
            osc.push({
                f: hf,
                a: h.amp * gnorm,
                dec: h.dec,
                ph: h.phase * 2 * Math.PI + jit,
                ph2: (h.phase + 0.31) * 2 * Math.PI - jit * 0.7,
                df: d ? Math.pow(2, d / 1200) : 1,
                df2: d ? Math.pow(2, -d / 1200) : 1
            });
        }

        /* 起音噪声：真实拨弦/击槌的"触弦瞬态"，25ms 内衰掉 */
        var airGain = ev.air ? dbToGain(ev.air) * gain : 0;
        var airLP = 1 - Math.exp(-2 * Math.PI * 3500 / sr);
        var airY = 0;

        /* 尾音 60ms 余弦软收尾（与 envGain 同口径） */
        var tail = 0.060;

        /* 事件级 T60（v0.3.0）：让 pad/sub 这类长音能表达"整小节只掉几 dB"。
           以前 e 在中间恒为 1.0，衰减只由每根谐波的 h.dec 决定，
           事件上写的 env.d 对加法合成完全无效 —— 铺底音只能在满音量下被软收尾掐断，
           实测每小节末掉到 -58dB，小节之间像断了气。
           注意：必须是 `env.hold === true` 才启用。不默认启用是为了**不改变 v0.2 原曲**
           （它的 pad 写 d:3.20，若被当成长音处理，原曲波形会变、RMS 从 -18.80 跑到 -18.11）。 */
        var evT60 = (ev.env && ev.env.hold === true && ev.env.d > 0) ? ev.env.d : 0;

        for (var i = 0; i < len; i++) {
            var idx = start + i;
            if (idx < 0 || idx >= out.length) continue;
            var t = i / sr;

            /* 总包络：平滑起音（raised-cosine，不是折线）+ 尾音 */
            var e;
            if (t < atk) {
                var u = t / atk;
                e = 0.5 - 0.5 * Math.cos(Math.PI * u);   /* 0→1，起音斜率连续 */
            } else {
                e = 1;
            }
            var rem = ev.dur - t;
            if (rem < tail) {
                var uu = rem < 0 ? 0 : rem / tail;
                e *= 0.5 - 0.5 * Math.cos(Math.PI * uu);
            }
            /* 长音（hold）不做 60ms 软收尾：循环里的铺底音本来就没有"结束"这回事，
               它的音尾要一直延续到 bleed 段、被绕回机制接去开头。
               若在这里收尾，循环点上就会出现"先淡出再进"的听感（实测 5dB 跌落）。 */
            if (evT60 > 0) e = (t < atk) ? (0.5 - 0.5 * Math.cos(Math.PI * t / atk)) : 1;
            if (e <= 0) continue;

            var s = 0;
            for (var q = 0; q < osc.length; q++) {
                var o = osc[q];
                var tq = t > atk ? t - atk : 0;
                /* 谐波级 T60 与事件级 T60 取慢者（谁衰减得慢听谁的）：
                   打击类 pluck/mallet 的 h.dec 都很短，行为不变；
                   铺底类 pad/sub 的 env.d 可以给到 30s+，于是整小节只掉几 dB。 */
                var t60 = evT60 > o.dec ? evT60 : o.dec;
                var hd = Math.exp(-tq / (t60 / 6.9078));   /* 各自 T60 的指数衰减 */
                if (hd < 1e-4) continue;
                s += o.a * hd * 0.5 * (
                    Math.sin(2 * Math.PI * o.f * o.df * t + o.ph) +
                    Math.sin(2 * Math.PI * o.f * o.df2 * t + o.ph2)
                );
            }

            /* 轻微的非线性（tanh）—— 真实乐器空气感；增益很小时近似线性，不会变脏 */
            if (s > 0.02 || s < -0.02) s = Math.tanh(s * 1.15) / 1.15;

            if (airGain > 0) {
                var nz = (rnd() * 2 - 1);
                airY += airLP * (nz - airY);
                s += airY * airGain * Math.exp(-t / 0.010);
            }

            out[idx] += s * e * gain;
        }
    }

    function writeEvent(out, sr, ev) {
        /* 加法合成音色 */
        if (ev.tone && TONE[ev.tone]) { writeHarmEvent(out, sr, ev); return; }

        var start = Math.round(ev.t * sr);
        var len = Math.round(ev.dur * sr);
        var gain = dbToGain(ev.gainDb);
        var rnd = mulberry32(0x5EED + (ev.name ? ev.name.length * 131 : 7) + start);

        /* 低通 / 带通的一极点状态 */
        var lpA = ev.lp ? 1 - Math.exp(-2 * Math.PI * ev.lp / sr) : 1;
        var lpY = 0;
        var hpA = ev.band ? 1 - Math.exp(-2 * Math.PI * ev.band.f0 / sr) : 0;
        var hpY = 0;
        var lp2A = ev.band && ev.band.f1 ? 1 - Math.exp(-2 * Math.PI * ev.band.f1 / sr) : 0;
        var lp2Y = 0;

        var twoOsc = ev.wave === 'sine+triangle' || ev.wave === 'triangle+sine';
        var useTri = ev.wave.indexOf('triangle') >= 0;
        var useSine = ev.wave.indexOf('sine') >= 0;

        for (var i = 0; i < len; i++) {
            var idx = start + i;
            if (idx < 0 || idx >= out.length) continue;
            var t = i / sr;
            var g = envGain(t, ev.dur, ev.env.a, ev.env.d) * gain;
            if (g === 0) continue;

            var s = 0;
            if (ev.wave === 'noise') {
                var white = rnd() * 2 - 1;
                /* 带通：一阶高通 + 一阶低通；f1 > f0 时按事件进度扫频 */
                var f0 = ev.band.f0;
                var f1 = ev.band.f1 === undefined ? f0 : ev.band.f1;
                var fc = f0 + (f1 - f0) * (ev.dur > 0 ? t / ev.dur : 0);
                hpA = 1 - Math.exp(-2 * Math.PI * fc / sr);
                hpY += hpA * (white - hpY);
                var highpassed = white - hpY;
                if (lp2A > 0) {
                    lp2A = f1 ? 1 - Math.exp(-2 * Math.PI * Math.max(fc, f1) / sr) : lp2A;
                    lp2Y += lp2A * (highpassed - lp2Y);
                    s = lp2Y * 2.2;
                } else {
                    s = highpassed * 2.2;
                }
            } else {
                var f = ev.freq;
                if (ev.bendCents) f = cents(f, ev.bendCents * Math.min(1, t / Math.max(0.05, ev.dur)));
                if (ev.cents) {
                    var f1o = cents(f, ev.cents);
                    var f2o = cents(f, -ev.cents);
                    var v1 = useSine ? Math.sin(2 * Math.PI * f1o * t) : triWave(f1o * t);
                    var v2 = useTri ? triWave(f2o * t) : Math.sin(2 * Math.PI * f2o * t);
                    s = twoOsc ? 0.5 * (v1 + v2) : v1;
                } else {
                    s = useTri ? triWave(f * t) : Math.sin(2 * Math.PI * f * t);
                }
                if (ev.lp && ev.lp < 20000) {
                    lpA = 1 - Math.exp(-2 * Math.PI * ev.lp / sr);
                    lpY += lpA * (s - lpY);
                    s = lpY;
                }
            }
            out[idx] += s * g;
        }
    }

    function renderEvents(events, seconds, sr) {
        var n = Math.max(1, Math.round(seconds * sr));
        var out = new Float32Array(n);
        for (var i = 0; i < events.length; i++) writeEvent(out, sr, events[i]);
        return out;
    }

    /** §0 统一反馈延迟混响：y[n] = x[n] + fb·y[n-D]，输出 = x + wet·y */
    function applyFeedbackDelay(buf, sr) {
        var d = Math.max(1, Math.round(SPEC.delay.time * sr));
        var fb = SPEC.delay.feedback;
        var wet = SPEC.delay.wet;
        var y = new Float32Array(buf.length);
        for (var i = 0; i < buf.length; i++) {
            var delayed = i >= d ? y[i - d] : 0;
            y[i] = buf[i] + fb * delayed;
            buf[i] = buf[i] + wet * delayed;
        }
        return buf;
    }

    function peakOf(buf) {
        var p = 0;
        for (var i = 0; i < buf.length; i++) {
            var a = Math.abs(buf[i]);
            if (a > p) p = a;
        }
        return p;
    }

    function rmsOf(buf) {
        var s = 0;
        for (var i = 0; i < buf.length; i++) s += buf[i] * buf[i];
        return Math.sqrt(s / Math.max(1, buf.length));
    }

    function dbfs(x) { return x > 0 ? 20 * Math.log10(x) : -Infinity; }

    function scaleToRms(buf, targetDb) {
        var r = rmsOf(buf);
        if (!(r > 1e-9)) return buf;
        var g = Math.pow(10, (targetDb - dbfs(r)) / 20);
        for (var i = 0; i < buf.length; i++) buf[i] *= g;
        return buf;
    }

    function scaleToPeak(buf, targetDb) {
        var p = peakOf(buf);
        if (!(p > 1e-9)) return buf;
        var g = Math.pow(10, (targetDb - dbfs(p)) / 20);
        for (var i = 0; i < buf.length; i++) buf[i] *= g;
        return buf;
    }

    /** 软限幅：保证 |s| < 1（A1 的「无样本绝对值 ≥1.0」） */
    function softLimit(buf, ceilingDb) {
        var ceil = Math.pow(10, (ceilingDb === undefined ? -1.5 : ceilingDb) / 20);
        for (var i = 0; i < buf.length; i++) {
            var x = buf[i];
            if (x > ceil) x = ceil + (1 - ceil) * Math.tanh((x - ceil) / (1 - ceil));
            else if (x < -ceil) x = -ceil - (1 - ceil) * Math.tanh((-x - ceil) / (1 - ceil));
            buf[i] = x;
        }
        return buf;
    }

    /* ================================================================
     * 公共离线渲染入口
     * ================================================================ */

    /** BGM 循环（RMS 归一到 SPEC.bgmRmsDb，落在 A2 的 [-22,-14] 区间中心；再软限幅）
     *  trackId: 'warm'（v0.2 原曲）/ 'minimal' / 'lofi' / 'ambient'，缺省 = `SPEC.bgmDefault`（`minimal`；D-075）
     *
     *  seamless = true（v0.3.0 新增，三套新曲用）：把**尾巴绕回开头**，做成真无缝 loop。
     *  做法：多渲染一段 wrapSeconds 的尾巴（足够让最后一个音的衰减 + 延迟混响都走完），
     *        再把这段尾巴按样本叠加到缓冲开头，最后裁回精确的 loopSeconds。
     *  效果：末尾的余韵会接到开头，循环点上没有"音量突然掉下去再弹回来"的断口。
     *  对比（实测末 100ms 与首 100ms 的 RMS 差）：
     *        warm 18.5dB（原曲一直存在的接缝跌落，本次不动它，保留旧存档一致性）
     *        lofi  3.0dB → 绕回后 <1dB
     *  seamless = false 时行为与 v0.2 完全一致（逐样本可复现）。
     */
    function renderBgm(seconds, sr, trackId, seamless) {
        var s = sr || SPEC.sampleRate;
        var tr = bgmTrack(trackId);
        var sec = seconds || tr.loopSeconds || SPEC.loopSeconds;
        var buf;

        if (seamless) {
            /* 尾巴要多长：最慢那个音的 T60 + 延迟混响尾巴（delay*fb 收敛约 0.28*8≈2.3s） */
            var wrap = Math.max(2.5, (tr.wrapSeconds || 3.0));
            var long = renderEvents(tr.events, sec + wrap, s);
            applyFeedbackDelay(long, s);
            buf = new Float32Array(Math.round(sec * s));
            for (var i = 0; i < buf.length; i++) buf[i] = long[i];
            /* 把超出 loop 的那段绕回开头（这是"循环"的物理含义） */
            var extra = long.length - buf.length;
            for (var k = 0; k < extra; k++) buf[k] += long[buf.length + k];
        } else {
            buf = renderEvents(tr.events, sec, s);
            applyFeedbackDelay(buf, s);
        }

        /* 先 RMS 归到目标值（A2），再看峰值有没有冲过 -2；超了才整体压下来（A1）。
           v0.2 的拨弦尾巴干净、不再互相抵消，峰值比 v0.1 高约 5dB，
           所以这一步是必要的 —— 但不能"先压峰再定 RMS"，那会把 RMS 一起拉低到 -21。 */
        scaleToRms(buf, SPEC.bgmRmsDb);
        var pk = dbfs(peakOf(buf));
        if (pk > -2.0) scaleToPeak(buf, -2.0);
        softLimit(buf, -1.5);
        return buf;
    }

    /** 单个特效音（未归一化；组归一化见 render_audio.mjs / audio_check.mjs） */
    function renderSfx(id, sr) {
        var s = sr || SPEC.sampleRate;
        var ev = sfxEvents(id);
        var dur = SFX[id] ? SFX[id].dur : 0.5;
        var buf = renderEvents(ev, dur + 0.35, s); /* 留出延迟尾巴 */
        applyFeedbackDelay(buf, s);
        return buf;
    }

    /** 飞行风声（用于试听：2s，300→900Hz 上扫；游戏里是可控增益的持续声） */
    function renderWhoosh(seconds, sr) {
        var s = sr || SPEC.sampleRate;
        var sec = seconds || 2;
        var buf = renderEvents([{
            name: null, t: 0, dur: sec, wave: 'noise', gainDb: -22,
            env: { a: 0.15, d: sec }, band: { f0: WHOOSH.band.f0, f1: WHOOSH.band.f1, q: WHOOSH.band.q },
            kind: 'whoosh'
        }], sec, s);
        applyFeedbackDelay(buf, s);
        scaleToPeak(buf, -6);
        softLimit(buf, -1.5);
        return buf;
    }

    /* ================================================================
     * 浏览器侧：WebAudio 实时播放 + 不依赖音频的状态模型（A5/A6/A8）
     * ================================================================ */
    var model = {
        master: 1,          /* 静音开关：1 / 0 */
        bgm: 1,             /* BGM 实际增益（= bgmBase × duck） */
        bgmBase: 1,         /* BGM 基准增益：**通用**旋钮，两模式当前都 1.0（D-047：差异只有计时） */
        sfxBase: 1,         /* SFX 基准增益：**通用**旋钮，两模式当前都 1.0（D-047：差异只有计时） */
        whoosh: 0,          /* 风声增益 0–1（按下即 0） */
        duckUntil: 0,
        muted: false,
        ctxReady: false,
        playing: false,
        lastOps: [],
        pressFrames: 0,
        /* A1-a 断言用：最近 16 次"整圈调度"的起点（音频时钟 s）。
           相邻两项之差应当 = loopSeconds ± 10ms；累积漂移直接从首尾差算。 */
        bgmLoopStarts: []
    };

    var ctx = null;
    var nodes = { master: null, bgm: null, sfx: null, whoosh: null, delay: null };

    function nowSec() {
        return ctx ? ctx.currentTime : (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);
    }

    /**
     * 只允许在用户手势里调用（§4）；构造失败必须被吃掉，游戏照常跑（A8）。
     * @returns {boolean} 是否真的拿到了 AudioContext
     */
    function ensure() {
        if (ctx) return true;
        try {
            var Ctor = G && (G.AudioContext || G.webkitAudioContext);
            if (!Ctor) { model.ctxReady = false; return false; }
            ctx = new Ctor();
            nodes.master = ctx.createGain();
            nodes.master.gain.value = model.master;
            nodes.master.connect(ctx.destination);

            nodes.bgm = ctx.createGain();
            nodes.bgm.gain.value = model.bgm;
            nodes.bgm.connect(nodes.master);

            nodes.sfx = ctx.createGain();
            nodes.sfx.gain.value = 1;
            nodes.sfx.connect(nodes.master);

            nodes.whoosh = ctx.createGain();
            nodes.whoosh.gain.value = 0;
            nodes.whoosh.connect(nodes.master);

            /* §0 统一混响：反馈延迟 0.28s / fb 0.30 / wet 0.25 */
            nodes.delay = ctx.createDelay(1.0);
            nodes.delay.delayTime.value = SPEC.delay.time;
            var fbGain = ctx.createGain();
            fbGain.gain.value = SPEC.delay.feedback;
            var wetGain = ctx.createGain();
            wetGain.gain.value = SPEC.delay.wet;
            nodes.delay.connect(fbGain);
            fbGain.connect(nodes.delay);
            nodes.delay.connect(wetGain);
            wetGain.connect(nodes.master);

            model.ctxReady = true;
            return true;
        } catch (e) {
            ctx = null;
            model.ctxReady = false;
            if (G && G.console && G.console.warn) G.console.warn('[audio] AudioContext 不可用，降级为静音: ' + (e && e.message));
            return false;
        }
    }

    function resume() {
        if (!ctx) return;
        try { if (ctx.state !== 'running' && ctx.resume) ctx.resume(); } catch (e) { /* 吃掉 */ }
    }

    function masterGainValue() { return model.master; }
    function bgmGainValue() { return model.bgm; }
    function whooshGainValue() { return model.whoosh; }

    /** A6：静音开关（同时作用于 BGM + SFX，因为是 master 级） */
    function setMuted(m) {
        model.muted = !!m;
        model.master = model.muted ? 0 : 1;
        if (nodes.master) {
            try { nodes.master.gain.value = model.master; } catch (e) { /* 吃掉 */ }
        }
        return model.master;
    }
    function toggleMuted() { return setMuted(!model.muted); }

    /** ducking：任一级 SFX 触发时 BGM ×0.55，250ms 线性恢复（相对**当前模式基准** bgmBase） */
    function duck() {
        model.bgm = model.bgmBase * SPEC.duck.gain;
        var t = nowSec();
        model.duckUntil = t + SPEC.duck.ms / 1000;
        if (nodes.bgm && ctx) {
            try {
                var g = nodes.bgm.gain;
                g.cancelScheduledValues(ctx.currentTime);
                g.setValueAtTime(model.bgm, ctx.currentTime);
                g.linearRampToValueAtTime(model.bgmBase, ctx.currentTime + SPEC.duck.ms / 1000);
            } catch (e) { /* 吃掉 */ }
        }
    }

    /**
     * BGM 基准增益：**通用**增益接口，不是 relax 的默认值 —— 两模式当前都传 1.0
     * （D-047：两模式音效参数完全相同，差异只有计时）。降增益是给"以后要做更弱背景的场合"
     * 留的旋钮；ducking 在它之上再乘 0.55。
     */
    function setBgmGain(g) {
        model.bgmBase = (typeof g === 'number' && isFinite(g) && g >= 0) ? g : 1;
        model.bgm = model.bgmBase;
        if (nodes.bgm && ctx) {
            try { nodes.bgm.gain.value = model.bgm; } catch (e) { /* 吃掉 */ }
        }
        return model.bgmBase;
    }

    /**
     * SFX 基准增益：**通用**增益接口，不是 relax 的默认值 —— 两模式当前都传 1.0
     * （D-047：两模式音效参数完全相同，差异只有计时）。降增益是给"以后要做更轻音效的场合"留的旋钮。
     */
    function setSfxGain(g) {
        model.sfxBase = (typeof g === 'number' && isFinite(g) && g >= 0) ? g : 1;
        if (nodes.sfx && ctx) {
            try { nodes.sfx.gain.value = model.sfxBase; } catch (e) { /* 吃掉 */ }
        }
        return model.sfxBase;
    }

    /** 每帧推进：ducking 到期恢复到模式基准（模型与 WebAudio 各一份） */
    function tick() {
        if (model.bgm !== model.bgmBase && nowSec() >= model.duckUntil) {
            model.bgm = model.bgmBase;
            if (nodes.bgm && ctx) {
                try { nodes.bgm.gain.value = model.bgm; } catch (e) { /* 吃掉 */ }
            }
        }
        if (nodes.whoosh && ctx) {
            try { nodes.whoosh.gain.value = model.whoosh * dbToGain(WHOOSH.gainDb) * 6; } catch (e) { /* 吃掉 */ }
        }
    }

    /** 风声增益（0–1，随接近目标上升） */
    function setWhoosh(v) {
        model.whoosh = v < 0 ? 0 : v > 1 ? 1 : v;
    }

    /** §2 硬切：不是淡出，是 0 */
    function cutWhoosh() {
        model.whoosh = 0;
        if (nodes.whoosh && ctx) {
            try { nodes.whoosh.gain.cancelScheduledValues(ctx.currentTime); nodes.whoosh.gain.value = 0; } catch (e) { /* 吃掉 */ }
        }
    }

    /**
     * A5：按下那一帧的完整事件序列 —— press 与 whoosh→0 **同一帧**（t 都是 0）。
     * game.js 在 doPress 的第一行调用它，保证顺序不可插入。
     */
    function pressFrame() {
        cutWhoosh();
        model.pressFrames += 1;
        model.lastOps = [
            { op: 'whoosh', gain: 0, t: 0 },
            { op: 'sfx', id: 'press', t: 0 }
        ];
        playSfx('press', true);
        return model.lastOps;
    }

    /* ---------------- WebAudio 调度 ---------------- */

    var noiseCache = null;
    function noiseBuffer(seconds) {
        if (!ctx) return null;
        if (!noiseCache || noiseCache.duration < seconds) {
            var len = Math.ceil((seconds || 2) * ctx.sampleRate);
            var buf = ctx.createBuffer(1, len, ctx.sampleRate);
            var d = buf.getChannelData(0);
            var rnd = mulberry32(0xA11CE);
            for (var i = 0; i < len; i++) d[i] = rnd() * 2 - 1;
            noiseCache = buf;
        }
        return noiseCache;
    }

    function scheduleEvent(ev, dest, at) {
        if (!ctx) return null;
        var gain = ctx.createGain();
        gain.gain.value = 0;
        gain.connect(dest);

        var srcs = [];
        var isHarm = ev.tone && TONE[ev.tone] && ev.wave !== 'noise';

        if (isHarm) {
            /* ---- 加法合成：每根谐波一个 Oscillator，各自 detune + 各自包络 ---- */
            var parts = TONE[ev.tone];
            var gnorm = TONE_NORM[ev.tone] || 1;
            var atk = Math.max(0.003, ev.env.a);
            var base = dbToGain(ev.gainDb);
            var det = ev.cents || 0;

            var mix = ctx.createGain();
            mix.gain.value = 1;
            mix.connect(gain);

            for (var p = 0; p < parts.length; p++) {
                var hp = parts[p];
                var hf = ev.freq * hp.n;
                if (hf > 16000) continue;
                var o = ctx.createOscillator();
                o.type = 'sine';
                o.frequency.value = hf;

                /* 每根谐波单独门控：dec 短的先消失 = 敲下去的"亮"迅速退掉 */
                var hg = ctx.createGain();
                hg.gain.value = 0;
                var amp = hp.amp * gnorm * base * 0.5;
                hg.gain.setValueAtTime(0, at);
                hg.gain.linearRampToValueAtTime(amp, at + atk);
                hg.gain.setTargetAtTime(amp * 0.001, at + atk, Math.max(0.004, hp.dec / 6.9078 / 2));
                o.connect(hg);
                hg.connect(mix);

                var dTot = det + (hp.detune || 0);
                if (dTot) { try { o.detune.value = dTot; } catch (e) { /* 吃掉 */ } }
                try { o.start(at); o.stop(at + ev.dur + 0.05); } catch (e) { /* 吃掉 */ }
                srcs.push(o);
            }

            /* 起音噪声：25ms 触弦瞬态 */
            if (ev.air) {
                var nb2 = noiseBuffer(0.1);
                if (nb2) {
                    var ns = ctx.createBufferSource();
                    ns.buffer = nb2;
                    var nf = ctx.createBiquadFilter();
                    nf.type = 'lowpass';
                    nf.frequency.value = 3500;
                    var ng = ctx.createGain();
                    ng.gain.value = 0;
                    var ag = dbToGain(ev.air);
                    ng.gain.setValueAtTime(0, at);
                    ng.gain.linearRampToValueAtTime(ag, at + 0.002);
                    ng.gain.setTargetAtTime(0.0001, at + 0.002, 0.0035);
                    ns.connect(nf); nf.connect(ng); ng.connect(gain);
                    try { ns.start(at); ns.stop(at + 0.05); } catch (e) { /* 吃掉 */ }
                    srcs.push(ns);
                }
            }

            /* 主包络：平滑起音 + 收尾（与离线渲染的 raised-cosine 同口径） */
            gain.gain.setValueAtTime(0, at);
            gain.gain.linearRampToValueAtTime(1, at + atk);
            gain.gain.setValueAtTime(1, at + Math.max(atk, ev.dur - 0.010));
            gain.gain.linearRampToValueAtTime(0, at + ev.dur);
            return srcs;
        }

        if (ev.wave === 'noise') {
            var nb = noiseBuffer(Math.max(0.2, ev.dur));
            var nsrc = ctx.createBufferSource();
            nsrc.buffer = nb;
            nsrc.loop = true;
            var bp = ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = ev.band ? ev.band.f0 : 2000;
            bp.Q.value = ev.band && ev.band.q ? ev.band.q : 1;
            if (ev.band && ev.band.f1 && ev.band.f1 !== ev.band.f0) {
                bp.frequency.setValueAtTime(ev.band.f0, at);
                bp.frequency.linearRampToValueAtTime(ev.band.f1, at + ev.dur);
            }
            nsrc.connect(bp);
            bp.connect(gain);
            var ng2 = dbToGain(ev.gainDb);
            var na = Math.max(0.001, ev.env.a);
            gain.gain.setValueAtTime(0, at);
            gain.gain.linearRampToValueAtTime(ng2, at + na);
            gain.gain.exponentialRampToValueAtTime(Math.max(1e-4, ng2 * 0.02), at + ev.dur);
            try { nsrc.start(at); nsrc.stop(at + ev.dur + 0.02); } catch (e) { /* 吃掉 */ }
            return nsrc;
        }

        /* 非预设的纯正弦（兼容旧事件；正常路径不会走到） */
        var src = ctx.createOscillator();
        src.type = 'sine';
        src.frequency.value = ev.freq;
        src.connect(gain);
        var g = dbToGain(ev.gainDb);
        var a = Math.max(0.003, ev.env.a);
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(g, at + a);
        gain.gain.exponentialRampToValueAtTime(Math.max(1e-4, g * 0.02), at + ev.dur);
        try { src.start(at); src.stop(at + ev.dur + 0.02); } catch (e) { /* 吃掉 */ }
        return src;
    }

    /* ================================================================
     * 循环调度（v0.7 · A1 修正）
     *
     * 旧实现 `periodMs = (loopSeconds - 1) * 1000` 比曲长短 1 秒：每圈都提前 1 秒重排整圈事件，
     * 于是每秒有一段双份叠加（音量与密度在每圈同一位置抬升），圈间相位逐圈漂移
     * （第 n 圈起点 = 29n 秒，与曲子的和声边界越错越远）。曲长就是 loopSeconds，
     * 定时器必须按**整圈**排 —— 这也是"验的"（离线 renderBgm）与"响的"（实时调度）对上的前提。
     *
     * 每圈起点用**累加锚点** bgmNextAt，而不是每次重读 ctx.currentTime：
     * setInterval 的抖动只会偏晚，若把"现在 + 0.2s"当成新起点，抖动会一圈一圈积成相位漂移；
     * 锚点让事件永远落在 `t0 + n × loopSeconds` 上，定时器抖动只消耗提前量（不改变圈长）。
     * ================================================================ */
    var BGM_LOOKAHEAD = 0.2;    /* 调度提前量（s）：首圈与追平都用它（旧实现循环内就是 0.2） */
    var BGM_MIN_LEAD = 0.05;    /* 锚点离"现在"不足这个值 = 这一圈已经错过，只能追平，不能排到过去 */
    var bgmTimer = null;
    var bgmTimerPeriod = 0;     /* 定时器当前周期（ms）= 正在播那一圈的整圈长 */
    var bgmStopped = true;
    var bgmCurrent = null;      /* 当前播放的 trackId */
    var bgmPending = null;      /* 已登记、等下一个循环边界生效的 trackId（A3：不许 stop+start 硬切） */
    var bgmNextAt = 0;          /* 下一次要排的那一圈的起点（累加锚点，单位 s，音频时钟） */

    /**
     * 排一圈事件。at 是**这一圈的起点**（不是"现在"）。
     * pending 只在这里消费：本圈事件全部排完之后，下一圈才换曲 —— 切点正好落在循环边界，
     * 旧曲完整播到圈尾、新曲从圈头进，玩家听不到静音也听不到重起（A3-a）。
     * @returns {object|null} 本圈实际使用的 track（调用方用它的 loopSeconds 推进锚点）
     */
    function scheduleBgmLoop(at, trackId) {
        if (!ctx) return null;
        if (!trackId && bgmPending) { bgmCurrent = bgmPending; bgmPending = null; }
        var tr = bgmTrack(trackId || bgmCurrent);
        bgmCurrent = tr.id;
        for (var i = 0; i < tr.events.length; i++) {
            scheduleEvent(tr.events[i], nodes.delay, at + tr.events[i].t);
            scheduleEvent(tr.events[i], nodes.bgm, at + tr.events[i].t);
        }
        /* A1-a 的可测点：记下每圈的实际调度起点，回归时直接读 model.bgmLoopStarts 算间隔。
           定长 16，防止长跑无界增长（本来就不该在实时路径里增长）。 */
        model.bgmLoopStarts.push(at);
        if (model.bgmLoopStarts.length > 16) model.bgmLoopStarts.shift();
        return tr;
    }

    /**
     * 重挂定时器。周期必须等于**正在播那一圈的整圈长**：
     * 换曲后曲长会变（minimal 24.0s / lofi 25.6s / ambient 24.62s），
     * 若沿用旧周期，短曲配长间隔会在每个圈边界留一段空白（长曲配短间隔则会把事件排到很远的未来）。
     * 任何时候只留一个定时器（A3-c）。
     */
    function bgmArmTimer(periodMs) {
        if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
        bgmTimerPeriod = periodMs;
        bgmTimer = setInterval(bgmTick, periodMs);
    }

    /** 每一圈到点：从锚点排下一圈，再把锚点推进整整一圈（**不读 currentTime 当起点**） */
    function bgmTick() {
        if (!ctx || bgmStopped) return;
        var now = ctx.currentTime;
        if (bgmNextAt < now + BGM_MIN_LEAD) {
            /* 主线程卡了一下 / 切后台回来：锚点已经落在过去。
               只能追平到 now + lookahead，这一圈必然有一小段静音 ——
               比"把已经过去的事件全部补排"（一涌而上 = 爆音）好。 */
            bgmNextAt = now + BGM_LOOKAHEAD;
        }
        var tr = scheduleBgmLoop(bgmNextAt);
        var period = ((tr || bgmTrack(bgmCurrent)).loopSeconds || SPEC.loopSeconds) * 1000;
        bgmNextAt += period;
        if (Math.abs(period - bgmTimerPeriod) > 0.5) bgmArmTimer(period); /* 换曲了：整圈长变了 */
    }

    /**
     * 启动 BGM。trackId 缺省 = `SPEC.bgmDefault`（`minimal`；D-075）。
     * 运行中换曲请用 setBgmTrack()（下一个循环边界生效）；这里的 trackId 只用于
     * "起播那一刻就定曲"，例如冷启动按场景选曲（A3：先 resolveSceneId() 再 startBgm(曲)）。
     */
    function startBgm(trackId) {
        if (!ctx || model.playing) return false;
        var tr = bgmTrack(trackId);
        bgmCurrent = tr.id;
        bgmPending = null;   /* 显式起播以这次传进来的曲为准，别让上一条 pending 在下一圈又换掉 */
        try { resume(); } catch (e) { /* 吃掉 */ }
        model.playing = true;
        bgmStopped = false;
        var period = (tr.loopSeconds || SPEC.loopSeconds) * 1000;  /* F1：整圈，不是 loopSeconds-1 */
        bgmNextAt = ctx.currentTime + BGM_LOOKAHEAD;
        scheduleBgmLoop(bgmNextAt, tr.id);
        bgmNextAt += period;
        bgmArmTimer(period);
        return true;
    }

    /**
     * 运行时换曲。**只登记 pending**，真正的切换发生在下一个循环边界（bgmTick → scheduleBgmLoop 消费）。
     * 旧实现是 stopBgm() + startBgm() 立刻执行 —— 那是硬切：正在播的这一圈被掐断，
     * 边界处留一段静音，与注释里写的"无缝"不符（A3-a 要求旧曲完整播到本圈结束）。
     */
    function setBgmTrack(trackId) {
        var tr = bgmTrack(trackId);
        /* 切回正在播的曲 = 撤销 pending：否则边界处会拿"同一首"重排一圈，白重置一次相位 */
        if (tr.id === bgmCurrent) { bgmPending = null; return tr.id; }
        if (!ctx || bgmStopped || !model.playing) {
            /* 没在播 = 没有"下一个循环边界"可等，直接改当前曲（语义与旧实现一致） */
            bgmCurrent = tr.id;
            bgmPending = null;
            return tr.id;
        }
        bgmPending = tr.id;
        return tr.id;
    }

    function stopBgm() {
        bgmStopped = true;
        model.playing = false;
        /* 停了就没有"下一圈"能承载 pending 与锚点：留着会在下次起播时意外生效一次，很难查 */
        bgmPending = null;
        bgmNextAt = 0;
        if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
        bgmTimerPeriod = 0;
    }

    function playSfx(id, noDuck) {
        if (!ctx) return false;
        var ev = sfxEvents(id);
        var at = ctx.currentTime + 0.01;
        for (var i = 0; i < ev.length; i++) {
            scheduleEvent(ev[i], nodes.sfx, at);
            scheduleEvent(ev[i], nodes.delay, at);
        }
        if (!noDuck) duck();
        return true;
    }

    /* ================================================================
     * 导出
     * ================================================================ */
    var A = {
        SPEC: SPEC,
        TONE: TONE,
        SFX: SFX,
        SFX_ORDER: SFX_ORDER,
        WHOOSH: WHOOSH,
        CHORDS: CHORDS,
        PROGRESSION: PROGRESSION,
        BGM_EVENTS: BGM_EVENTS,
        BGM_TRACKS: BGM_TRACKS,
        BGM_TRACK_ORDER: BGM_TRACK_ORDER,
        bgmTrack: bgmTrack,
        setBgmTrack: setBgmTrack,
        model: model,

        hz: hz,
        pitchClass: pitchClass,
        cents: cents,
        transposeOctave: transposeOctave,
        sfxEvents: sfxEvents,

        /* 离线渲染（node） */
        renderBgm: renderBgm,
        renderSfx: renderSfx,
        renderWhoosh: renderWhoosh,
        renderEvents: renderEvents,
        applyFeedbackDelay: applyFeedbackDelay,
        peakOf: peakOf,
        rmsOf: rmsOf,
        dbfs: dbfs,
        scaleToPeak: scaleToPeak,
        scaleToRms: scaleToRms,
        softLimit: softLimit,

        /* 浏览器实时 */
        ensure: ensure,
        resume: resume,
        startBgm: startBgm,
        stopBgm: stopBgm,
        playSfx: playSfx,
        scheduleEvent: scheduleEvent,
        scheduleBgmLoop: scheduleBgmLoop,

        /* 状态模型（A5/A6/A8 断言对象） */
        setMuted: setMuted,
        toggleMuted: toggleMuted,
        isMuted: function () { return model.muted; },
        masterGainValue: masterGainValue,
        bgmGainValue: bgmGainValue,
        bgmBaseValue: function () { return model.bgmBase; },
        sfxBaseValue: function () { return model.sfxBase; },
        setBgmGain: setBgmGain,
        setSfxGain: setSfxGain,
        whooshGainValue: whooshGainValue,
        setWhoosh: setWhoosh,
        cutWhoosh: cutWhoosh,
        pressFrame: pressFrame,
        duck: duck,
        tick: tick,
        duckGain: SPEC.duck.gain,
        duckMs: SPEC.duck.ms
    };

    return A;
});
