/**
 * tools/_io.mjs —— 工具链共用的读写小件（BOM / CSV / JSON / 结果统计）
 * 纯 node 内置模块，无第三方依赖。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function rel(p) {
    return path.relative(ROOT, p).replace(/\\/g, '/');
}

/** 读文本并去掉 UTF-8 BOM（策划的 CSV 从 Excel 存出来经常带 BOM） */
export function readText(p) {
    return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
}

export function readJson(p) {
    return JSON.parse(readText(p));
}

export function exists(p) {
    try {
        return fs.statSync(p).isFile();
    } catch {
        return false;
    }
}

export function writeJson(p, obj) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

/** 解析 CSV（支持引号包裹、字段内逗号、"" 转义） */
export function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuote = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuote) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else inQuote = false;
            } else field += ch;
        } else if (ch === '"') inQuote = true;
        else if (ch === ',') {
            row.push(field);
            field = '';
        } else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(field);
            field = '';
            if (row.length > 1 || row[0] !== '') rows.push(row);
            row = [];
        } else field += ch;
    }
    if (field !== '' || row.length > 0) {
        row.push(field);
        if (row.length > 1 || row[0] !== '') rows.push(row);
    }
    if (rows.length === 0) return { header: [], rows: [] };
    const header = rows[0].map((h) => h.trim());
    const body = rows.slice(1).filter((r) => r.some((c) => c.trim() !== ''));
    return { header, rows: body.map((r) => {
        const o = {};
        for (let i = 0; i < header.length; i++) o[header[i]] = (r[i] ?? '').trim();
        return o;
    }) };
}

export function round1(x) {
    return Math.round(x * 10) / 10;
}

/** 打印统计 + 颜色（不依赖 chalk） */
export const C = {
    dim: (s) => `\x1b[2m${s}\x1b[0m`,
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

/** 简易结果收集器：工具最后统一打印 + 决定退出码 */
export function makeReporter(title) {
    const state = { pass: 0, fail: 0, warn: 0, failures: [] };
    console.log(`\n=== ${title} ===`);
    return {
        ok(msg, detail) {
            state.pass++;
            console.log(`  ${C.green('PASS')} ${msg}${detail ? C.dim('  ' + detail) : ''}`);
        },
        bad(msg, detail) {
            state.fail++;
            state.failures.push(msg);
            console.log(`  ${C.red('FAIL')} ${msg}${detail ? '  ' + detail : ''}`);
        },
        warn(msg) {
            state.warn++;
            console.log(`  ${C.yellow('WARN')} ${msg}`);
        },
        info(msg) {
            console.log(`  ${C.dim('·')} ${msg}`);
        },
        get stats() {
            return state;
        },
        finish(extraSummary) {
            console.log(`\n--- 汇总：PASS ${state.pass} / FAIL ${state.fail} / WARN ${state.warn} ---`);
            if (extraSummary) console.log(extraSummary);
            if (state.fail > 0) {
                console.log(C.red('失败项：'));
                for (const f of state.failures) console.log(' - ' + f);
            }
            return state.fail === 0 ? 0 : 1;
        },
    };
}

/** 定宽表格打印（中文按 2 列宽估算，够用不引第三方） */
export function printTable(headers, rows, aligns = []) {
    const width = (s) => {
        let w = 0;
        for (const ch of String(s)) w += ch.charCodeAt(0) > 255 ? 2 : 1;
        return w;
    };
    const widths = headers.map((h, i) => Math.max(width(h), ...rows.map((r) => width(r[i] ?? ''))));
    const pad = (s, w, a) => {
        const gap = Math.max(0, w - width(s));
        return a === 'r' ? ' '.repeat(gap) + s : s + ' '.repeat(gap);
    };
    console.log(headers.map((h, i) => pad(h, widths[i], 'l')).join('  '));
    console.log(widths.map((w) => '-'.repeat(w)).join('  '));
    for (const r of rows) console.log(r.map((c, i) => pad(String(c ?? ''), widths[i], aligns[i] || 'l')).join('  '));
}
