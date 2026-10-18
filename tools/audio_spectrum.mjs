/**
 * tools/audio_spectrum.mjs —— 频段能量 + 常 Q 滤波诊断（判断"刺耳"来自哪里）
 *
 * 用法：node tools/audio_spectrum.mjs [file.wav ...]
 * 不给参数时分析 03_交付素材/audio 下全部 wav。
 *
 * 输出：
 *   1) 各倍频程带能量占比（dB）—— 看 4k/8k 是不是抬头
 *   2) 三角波谐波实测量 —— 证明"滤波器不是砖墙"：1500Hz 低通后 4.5kHz 三次谐波仍在
 *   3) 峰值 / 过零率 / 最响 1s 的瞬态密度
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './proto_vm.mjs';

const SR = 44100;

/* ---------- WAV 读取（16-bit PCM mono） ---------- */
export function readWav(file) {
    const b = fs.readFileSync(file);
    if (b.toString('ascii', 0, 4) !== 'RIFF') throw new Error('不是 WAV: ' + file);
    let off = 12, fmt = null, data = null;
    while (off + 8 <= b.length) {
        const id = b.toString('ascii', off, off + 4);
        const sz = b.readUInt32LE(off + 4);
        if (id === 'fmt ') {
            fmt = { channels: b.readUInt16LE(off + 10), sr: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
        } else if (id === 'data') {
            data = { off: off + 8, sz };
        }
        off += 8 + sz + (sz % 2);
    }
    if (!fmt || !data) throw new Error('缺 fmt/data: ' + file);
    const n = Math.floor(data.sz / (fmt.bits / 8) / fmt.channels);
    const out = new Float32Array(n);
    if (fmt.bits === 16) {
        for (let i = 0; i < n; i++) out[i] = b.readInt16LE(data.off + i * 2) / 32768;
    } else {
        throw new Error('仅支持 16-bit: ' + file);
    }
    return { x: out, sr: fmt.sr, file };
}

/* ---------- 一阶滤波（与 audio.js 内实现同口径） ---------- */
function onePoleLP(x, fc) {
    const a = 1 - Math.exp(-2 * Math.PI * fc / SR);
    const y = new Float32Array(x.length);
    let s = 0;
    for (let i = 0; i < x.length; i++) { s += a * (x[i] - s); y[i] = s; }
    return y;
}
function onePoleHP(x, fc) {
    const a = 1 - Math.exp(-2 * Math.PI * fc / SR);
    let s = 0;
    const y = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) { s += a * (x[i] - s); y[i] = x[i] - s; }
    return y;
}
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length));
const db = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

/* ---------- 分频段能量 ---------- */
const BANDS = [
    [20, 120], [120, 250], [250, 500], [500, 1000],
    [1000, 2000], [2000, 4000], [4000, 6000], [6000, 8000], [8000, 12000], [12000, 20000]
];

function bandEnergy(x) {
    const total = rms(x);
    const rows = [];
    for (const [lo, hi] of BANDS) {
        const hp = onePoleHP(x, lo);
        const bp = onePoleLP(hp, hi);
        const e = rms(bp);
        rows.push({ lo, hi, db: db(e), pct: total > 0 ? (e / total) * 100 : 0 });
    }
    return rows;
}

/* ---------- 三角波谐波实测 ---------- */
function triHarmonics(freq) {
    const n = SR * 2;
    const tri = [];
    const sine = [];
    for (let i = 0; i < n; i++) {
        const ph = freq * (i / SR);
        const xx = ph - Math.floor(ph + 0.5);
        tri.push(4 * Math.abs(xx) - 1);
        sine.push(Math.sin(2 * Math.PI * ph));
    }
    const t = Float32Array.from(tri), s = Float32Array.from(sine);
    const filterTest = {};
    for (const fc of [1200, 1500, 2000, 2600, 3000]) {
        filterTest[fc] = {
            tri: db(rms(onePoleLP(t, fc))),
            sine: db(rms(onePoleLP(s, fc)))
        };
    }
    // 各次谐波能量（在原始三角波上，用 1/12 倍频粗略窗测）
    const harm = [];
    for (const k of [1, 3, 5, 7, 9, 11, 13, 15]) {
        const f = freq * k;
        if (f > 20000) break;
        const hp = onePoleHP(t, f * 0.93);
        const bp = onePoleLP(hp, f * 1.07);
        harm.push({ k, f: Math.round(f), db: db(rms(bp)) });
    }
    return { filterTest, harm };
}

/* ---------- 主 ---------- */
const args = process.argv.slice(2);
const files = args.length
    ? args
    : fs.readdirSync(path.join(ROOT, '03_交付素材', 'audio'))
        .filter((f) => f.endsWith('.wav'))
        .map((f) => path.join(ROOT, '03_交付素材', 'audio', f));

console.log('');
console.log('==== audio_spectrum ====');
for (const f of files) {
    const { x } = readWav(f);
    let peak = 0;
    for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > peak) peak = Math.abs(x[i]);
    console.log('');
    console.log('■ ' + path.basename(f) + '   ' + (x.length / SR).toFixed(2) + 's   peak ' + db(peak).toFixed(2) + ' dBFS');
    const rows = bandEnergy(x);
    const line = rows.map((r) => {
        const name = (r.lo >= 1000 ? (r.lo / 1000) + 'k' : r.lo) + '-' + (r.hi >= 1000 ? (r.hi / 1000) + 'k' : r.hi);
        return name.padEnd(10) + r.db.toFixed(1).padStart(7);
    });
    console.log('  频段(dB) ' + line.slice(0, 5).join(' '));
    console.log('           ' + line.slice(5).join(' '));
    const hi = rows.filter((r) => r.lo >= 4000);
    const hiDb = hi.reduce((s, r) => s + Math.pow(10, r.db / 10), 0);
    console.log('  ≥4kHz 总量 ' + db(Math.sqrt(hiDb)).toFixed(1) + ' dB   （对比整体 ' + db(rms(x)).toFixed(1) + ' dB）');
}

/* 谐波实测：拿 D6 = 1174.66Hz 当样本（god 的最高音） */
const h = triHarmonics(1174.66);
console.log('');
console.log('■ 三角波谐波实测（基频 1174.7Hz = D6）');
console.log('  谐波          频率      原始 dB');
for (const r of h.harm) console.log('  第' + String(r.k).padStart(2) + '次   ' + String(r.f).padStart(6) + ' Hz   ' + r.db.toFixed(1).padStart(7));
console.log('');
console.log('■ 一极点低通对 1174.7Hz 三角波 / 纯正弦 的残留能量（dB）');
console.log('  截止   三角波    正弦     差值(=谐波残留)');
for (const fc of Object.keys(h.filterTest)) {
    const t = h.filterTest[fc];
    console.log('  ' + String(fc).padStart(5) + '  ' + t.tri.toFixed(1).padStart(7) + '  ' + t.sine.toFixed(1).padStart(7) + '  ' + (t.tri - t.sine).toFixed(1).padStart(7));
}
console.log('');
