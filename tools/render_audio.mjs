/**
 * tools/render_audio.mjs —— 把 原型/_src/audio.js 里的**同一份数据**离线渲染成 WAV
 *
 * 产物（03_交付素材/audio/）：
 *   bgm_loop.wav   30.0s 循环（64BPM / D 大调五声 / Dmaj7-A-Bm7-Gmaj7，pad+拨弦+低音+沙锤）
 *   sfx_god.wav / sfx_perfect.wav / sfx_good.wav / sfx_ok.wav / sfx_fail.wav
 *   sfx_press.wav / sfx_whoosh.wav（附加，方便试听"按下即静音"）
 *
 * 归一化口径（保证 A1/A2 同时成立）：
 *   - BGM：RMS 归一到 -18 dBFS（A2 区间中心），再软限幅 -1.5 dBFS
 *   - 五档 SFX：组归一化，最响的一档峰值 -1.5 dBFS，**保留规格里的相对音量差**
 *   - press / whoosh：峰值 -1.5 dBFS
 *
 * 用法：node tools/render_audio.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './proto_vm.mjs';

const OUT_DIR = path.join(ROOT, '03_交付素材', 'audio');
const SR = 44100;

/* ---------------- 载入数据（与浏览器同一份源码） ---------------- */
const holder = {};
new Function('globalThis', fs.readFileSync(path.join(ROOT, '原型', '_src', 'audio.js'), 'utf8'))(holder);
const A = holder.DISTA_AUDIO;
if (!A) {
    console.error('[render_audio] audio.js 没有导出 DISTA_AUDIO');
    process.exit(2);
}

/* ---------------- WAV 写出（16-bit PCM mono） ---------------- */
function writeWav(file, buf, sampleRate) {
    const n = buf.length;
    const bytes = Buffer.alloc(44 + n * 2);
    bytes.write('RIFF', 0);
    bytes.writeUInt32LE(36 + n * 2, 4);
    bytes.write('WAVE', 8);
    bytes.write('fmt ', 12);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);   /* PCM */
    bytes.writeUInt16LE(1, 22);   /* mono */
    bytes.writeUInt32LE(sampleRate, 24);
    bytes.writeUInt32LE(sampleRate * 2, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36);
    bytes.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) {
        let v = Math.max(-1, Math.min(1, buf[i]));
        bytes.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    return bytes.length;
}

/* ---------------- 渲染 ---------------- */
const bgm = A.renderBgm(A.SPEC.loopSeconds, SR);

const sfxIds = ['god', 'perfect', 'good', 'ok', 'fail'];
const raw = {};
for (const id of sfxIds) raw[id] = A.renderSfx(id, SR);

/* v0.2.0：不再做「最响的一档顶到 -1.5dBFS」的组归一化。
   原因：那套逻辑会把已经压低的档位重新顶回去，等于白改。
   改为按 SPEC 的绝对电平：god 峰值 -3.0 dBFS，其余档保留各自相对差（见 SFX.gainDb）。
   这样 perfect/good 不会被 god 拖上同一水平。 */
let maxPeak = 0;
for (const id of sfxIds) maxPeak = Math.max(maxPeak, A.peakOf(raw[id]));
const groupGain = maxPeak > 1e-9 ? Math.pow(10, (A.SPEC.sfxPeakDb - A.dbfs(maxPeak)) / 20) : 1;
const sfx = {};
for (const id of sfxIds) sfx[id] = A.softLimit(raw[id].map((x) => x * groupGain), -1.5);

const press = A.softLimit(A.renderSfx('press', SR), -1.5);
const whoosh = A.renderWhoosh(2, SR);

/* ---------------- 落盘 ---------------- */
const rows = [];
function emit(name, buf) {
    const file = path.join(OUT_DIR, name);
    const bytes = writeWav(file, buf, SR);
    rows.push({
        name: name,
        sec: (buf.length / SR).toFixed(2),
        peak: A.dbfs(A.peakOf(buf)).toFixed(2),
        rms: A.dbfs(A.rmsOf(buf)).toFixed(2),
        kb: (bytes / 1024).toFixed(1)
    });
}

emit('bgm_loop.wav', bgm);

/* v0.3.0：三套新 BGM（对应 BGM 提示词文档的三个版本），seamless = true 做真无缝循环
 *
 * 每套出**两份**：
 *   *_preview.wav —— RMS -18dBFS，正常听感，用来单独试听 / A-B 对比
 *   *.wav         —— 按需求文档 §2「BGM 比 SFX 低 -12 ~ -18dB」定电平（BGM 作底色）
 * 为什么必须分两份：游戏里 BGM 要压低 12–18dB，但把 -39dBFS 的文件单独播放，
 *   用户会以为"没声音"或"音量坏了"。文档要求的电平关系只有在**和 SFX 一起播**时才成立。
 */
const NEW_BGMS = [
    { id: 'minimal', file: 'bgm_v1_minimal_80bpm.wav' },
    { id: 'lofi', file: 'bgm_v2_lofi_75bpm.wav' },
    { id: 'ambient', file: 'bgm_v3_ambient_78bpm.wav' }
];

/* 文档 §2：BGM 应比 SFX 低 12~18dB。以 perfect 档为参照（玩家最关注的"成功"反馈），
   取区间中值 -15dB。注意比的是 RMS —— 峰值比没有意义（BGM 是持续的，SFX 是瞬态）。 */
const perfectRms = A.dbfs(A.rmsOf(sfx.perfect));
const BGM_GAME_RMS = perfectRms - 15;

for (const t of NEW_BGMS) {
    const preview = A.renderBgm(null, SR, t.id, true);
    emit(t.file.replace('.wav', '_preview.wav'), preview);
    /* 交付版：从 preview 整体缩放，保证**两侧波形完全一致**，只是电平不同 */
    const game = new Float32Array(preview.length);
    const g = Math.pow(10, (BGM_GAME_RMS - A.dbfs(A.rmsOf(preview))) / 20);
    for (let i = 0; i < preview.length; i++) game[i] = preview[i] * g;
    emit(t.file, game);
}

for (const id of sfxIds) emit('sfx_' + id + '.wav', sfx[id]);
emit('sfx_press.wav', press);
emit('sfx_whoosh.wav', whoosh);

/* ---------------- 报告 ---------------- */
console.log('');
console.log('==== render_audio ====');
console.log('输出目录: ' + OUT_DIR);
console.log('采样率  : ' + SR + ' Hz / 16-bit / mono');
console.log('--------------------');
console.log('文件'.padEnd(20) + '秒'.padEnd(8) + '峰值dBFS'.padEnd(12) + 'RMS dBFS'.padEnd(12) + 'KB');
for (const r of rows) {
    console.log(r.name.padEnd(20) + r.sec.padEnd(8) + r.peak.padEnd(12) + r.rms.padEnd(12) + r.kb);
}
console.log('--------------------');
console.log('BGM 音符（音级检查）: ' + [...new Set(A.BGM_EVENTS.filter((e) => e.name).map((e) => A.pitchClass(e.name)))].join(' '));
for (const id of sfxIds) {
    const notes = A.sfxEvents(id).map((e) => e.name).filter(Boolean);
    console.log(('sfx_' + id).padEnd(14) + ' ' + (notes.length ? notes.join(' → ') : '(噪声)'));
}
console.log('');
console.log('RESULT: WROTE ' + rows.length + ' files');
console.log('');
