/**
 * tools/update_collection_k.mjs —— 按 k_probe 实测重算图鉴的 k 与难度档
 *
 * 图鉴里的 k/band 是「给玩家看的难度标签」，必须与实际形状一致：
 * 换形后 k 会变，如果不同步，玩家看到的档位就是假的（D-111 起定为必跑项）。
 *
 * 口径：collection.k = k_probe 的 k × K_CAL(0.486)，与 D-111 校准一致
 * 用法：node tools/update_collection_k.mjs [--apply]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, readJson } from './_io.mjs';

const K_CAL = 0.486;
const APPLY = process.argv.includes('--apply');
const BANDS = [
    { min: 0.052, band: '极宽容' },
    { min: 0.040, band: '偏宽容' },
    { min: 0.032, band: '舒适' },
    { min: 0.024, band: '偏敏感' },
    { min: -1, band: '敏感' },
];
const bandOf = (k) => BANDS.find((b) => k >= b.min).band;

const out = execFileSync(process.execPath, [path.join(ROOT, 'tools/k_probe.mjs'), '--file=assets/config/shapes.json'], {
    cwd: ROOT, encoding: 'utf8',
});
const kmap = {};
for (const line of out.split(/\r?\n/)) {
    const p = line.split('|');
    if (p.length >= 3 && /^[0-9]*\.?[0-9]+$/.test(p[1])) kmap[p[0]] = Number(p[1]);
}
console.log('探针读到', Object.keys(kmap).length, '件');

const file = path.join(ROOT, 'assets/resources/config/collection.json');
const col = readJson(file);
const rows = [];
for (const id of Object.keys(col.items)) {
    if (!(id in kmap)) continue;
    const k = Math.round(kmap[id] * K_CAL * 10000) / 10000;
    const band = bandOf(k);
    const it = col.items[id];
    if (it.k !== k || it.band !== band) rows.push([id, it.k, k, it.band, band]);
    it.k = k;
    it.band = band;
}
console.log('id|k 旧→新|档 旧→新');
rows.forEach((r) => console.log(r.join('|')));
if (APPLY) {
    col.note = (col.note || '') + ' 【k 同步】按 k_probe 实测重算 k/难度档。';
    fs.writeFileSync(file, JSON.stringify(col, null, 1) + '\n', 'utf8');
    console.log('已写回 collection.json');
} else {
    console.log('（未加 --apply，不写回）');
}
