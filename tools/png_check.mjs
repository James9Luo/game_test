/**
 * tools/png_check.mjs —— 截图的"红条自证"检查（无依赖，node 内置 zlib 解 PNG）
 *
 * 为什么需要它：`verify_proto.ps1` 原来只有 4 个状态走 DOM 判错，其它截图只看"文件存在"。
 * 结果 `proto_fx_season.png` 整张是 JS-ERROR 崩溃页，却被当成"第 28 张成功截图"。
 * 我们的错误网会在页面顶部画一条纯色红条（#FF6B6B），所以任何一张图只要顶部出现大量该色，
 * 就说明那一帧的渲染挂过 —— 这个判据不需要 DOM、不需要再跑一次浏览器，最便宜。
 *
 * 用法：node tools/png_check.mjs <a.png> [b.png ...]
 * 退出码：0 = 全部干净；1 = 至少一张判红条；2 = 参数/解码错误
 */

import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

const ERROR_RGB = [255, 107, 107]; /* = #FF6B6B，见 game.js 错误网 */
const TOL = 26;                    /* 每通道容差（抗 PNG 量化/缩放） */
const SCAN_ROWS = 120;             /* 只看顶部 120 行：错误条固定在最上面 */
const RED_PIXELS_FAIL = 40;        /* 超过这么多像素才判失败（防个别抗锯齿噪点） */

function readPng(file) {
    const buf = fs.readFileSync(file);
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
    let off = 8;
    let w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
    const idat = [];
    while (off + 8 <= buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('ascii', off + 4, off + 8);
        const data = buf.subarray(off + 8, off + 8 + len);
        if (type === 'IHDR') {
            w = data.readUInt32BE(0);
            h = data.readUInt32BE(4);
            bitDepth = data[8];
            colorType = data[9];
            interlace = data[12];
        } else if (type === 'IDAT') {
            idat.push(data);
        } else if (type === 'IEND') {
            break;
        }
        off += 12 + len;
    }
    if (!w || !h) throw new Error('缺 IHDR');
    if (bitDepth !== 8) throw new Error('只支持 8bit PNG（实际 ' + bitDepth + '）');
    if (colorType !== 2 && colorType !== 6) throw new Error('只支持 RGB/RGBA PNG（实际 colorType=' + colorType + '）');
    if (interlace !== 0) throw new Error('不支持隔行 PNG');
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const ch = colorType === 6 ? 4 : 3;
    const stride = w * ch;
    const out = Buffer.alloc(h * stride);
    let p = 0;
    for (let y = 0; y < h; y++) {
        const filter = raw[p++];
        const row = raw.subarray(p, p + stride);
        p += stride;
        const cur = out.subarray(y * stride, (y + 1) * stride);
        const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
        for (let x = 0; x < stride; x++) {
            const a = x >= ch ? cur[x - ch] : 0;
            const b = prev ? prev[x] : 0;
            const c = (prev && x >= ch) ? prev[x - ch] : 0;
            let v = row[x];
            if (filter === 1) v += a;
            else if (filter === 2) v += b;
            else if (filter === 3) v += (a + b) >> 1;
            else if (filter === 4) {
                const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
                v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
            }
            cur[x] = v & 0xff;
        }
    }
    return { w, h, ch, data: out };
}

function checkPng(file) {
    const img = readPng(file);
    const rows = Math.min(SCAN_ROWS, img.h);
    let red = 0;
    let sum = 0, n = 0;
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < img.w; x++) {
            const i = (y * img.w + x) * img.ch;
            const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
            if (y < 4) { sum += r + g + b; n++; }
            if (Math.abs(r - ERROR_RGB[0]) <= TOL && Math.abs(g - ERROR_RGB[1]) <= TOL && Math.abs(b - ERROR_RGB[2]) <= TOL) red++;
        }
    }
    return { file: path.basename(file), w: img.w, h: img.h, red, avgTop: n ? sum / n / 3 : 0 };
}

const files = process.argv.slice(2);
if (!files.length) {
    console.error('用法: node tools/png_check.mjs <a.png> [b.png ...]');
    process.exit(2);
}
let bad = 0;
for (const f of files) {
    try {
        const r = checkPng(f);
        if (r.red >= RED_PIXELS_FAIL) {
            bad++;
            console.log('X RED-BAR  ' + r.file + '  (' + r.w + 'x' + r.h + ', 红条像素=' + r.red + ') → 该帧渲染报过错');
        } else {
            console.log('OK         ' + r.file + '  (' + r.w + 'x' + r.h + ', 红条像素=' + r.red + ')');
        }
    } catch (e) {
        console.log('X DECODE   ' + path.basename(f) + '  — ' + (e && e.message ? e.message : e));
        bad++;
    }
}
if (bad) {
    console.log('PNG-CHECK: FAIL (' + bad + ' / ' + files.length + ' 张有红条或解码失败)');
    process.exit(1);
}
console.log('PNG-CHECK: PASS (' + files.length + ' 张均无红条)');
