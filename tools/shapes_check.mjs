/**
 * tools/shapes_check.mjs —— 美术轮廓验收（美术交付前必须过这一关）
 *
 *   node tools/shapes_check.mjs                 # 校验 assets/config/shapes.json（缺文件 → 报错退出）
 *   node tools/shapes_check.mjs --allow-missing # 缺文件时改用 tools/_placeholder_shapes.mjs 占位形状跑通
 *   node tools/shapes_check.mjs --file=xxx.json # 指定文件
 *
 * 校验项（与运行时 loadShapes 同一套规则，见 core/Shapes.ts）：
 *   简单多边形（不许自交）、12–48 顶点、长边 = 1±2%、形心距原点 < 0.05、面积 > 0、id 唯一、size > 0、颜色 #RRGGBB
 * 额外（工具层）：
 *   形心 > 0.02 打 WARN（真机上会看到「物体永远歪一点」，建议 < 0.01）
 *   levels.json 里引用的每个 shape id 都必须存在（否则那关进不去）
 */

import path from 'node:path';
import { ROOT, readJson, exists, rel, makeReporter, printTable, C } from './_io.mjs';
import { placeholderShapes } from './_placeholder_shapes.mjs';
import { core } from './_core.mjs';

const { inspectShapes, longSideOf, SHAPE_LIMITS, polyArea, polyCentroid } = core;

const argv = process.argv.slice(2);
const ALLOW_MISSING = argv.includes('--allow-missing');
const fileArg = argv.find((a) => a.startsWith('--file='));
const SHAPES_PATH = fileArg ? path.resolve(ROOT, fileArg.slice(7)) : path.join(ROOT, 'assets/config/shapes.json');
const LEVELS_PATH = path.join(ROOT, 'assets/resources/config/levels.json');

const rep = makeReporter('shapes_check：轮廓验收');

let json = null;
let source = '';
if (exists(SHAPES_PATH)) {
    json = readJson(SHAPES_PATH);
    source = rel(SHAPES_PATH);
} else if (ALLOW_MISSING) {
    json = { shapes: Object.values(placeholderShapes()) };
    source = 'tools/_placeholder_shapes.mjs（占位）';
    rep.warn(`没有 ${rel(SHAPES_PATH)}，改用占位形状（--allow-missing）：校验的是「规则能不能跑通」，不是美术数据`);
} else {
    rep.bad(`找不到 ${rel(SHAPES_PATH)}（美术未交付）。加 --allow-missing 可先用占位形状跑通链路`);
    process.exit(rep.finish());
}

const insp = inspectShapes(json);
const list = Array.isArray(json) ? json : json.shapes || [];
const rows = [];
let warnCentroid = 0;
for (const s of list) {
    if (!s || !Array.isArray(s.pts) || s.pts.length < 3) continue;
    const area = polyArea(s.pts);
    const c = polyCentroid(s.pts);
    const cd = Math.hypot(c.x, c.y);
    if (cd > 0.02) warnCentroid++;
    rows.push([
        s.id,
        s.name || '',
        String(s.size ?? ''),
        String(s.pts.length),
        longSideOf(s.pts).toFixed(4),
        cd.toFixed(4),
        area.toFixed(4),
        cd > 0.02 ? '形心偏大' : 'ok',
    ]);
}
printTable(['id', '名字', 'size', '顶点数', '长边', '形心距', '归一化面积', '状态'], rows, ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'l']);

for (const e of insp.errors) rep.bad(e);
for (const w of insp.warnings) rep.warn(w);
if (warnCentroid > 0) rep.warn(`${warnCentroid} 个形状形心距 > 0.02（未超 0.05 硬限，但真机上会出现「物体永远歪一点」，建议 < 0.01）`);
if (insp.errors.length === 0) {
    rep.ok(`${list.length} 个形状全部合法（简单多边形 / ${SHAPE_LIMITS.minVerts}–${SHAPE_LIMITS.maxVerts} 顶点 / 长边 1±2% / 形心 < 0.05 / 面积 > 0）`);
}

// 顶点数分布（给美术看：46–48 顶点的形状会逼近判定性能红线）
const hist = new Map();
for (const r of rows) {
    const bucket = Math.floor(Number(r[3]) / 8) * 8;
    hist.set(bucket, (hist.get(bucket) || 0) + 1);
}
const histStr = [...hist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}-${k + 7}顶点:${v}`).join('  ');
if (histStr) rep.info(`顶点数分布：${histStr}`);

// 关卡引用完整性
if (exists(LEVELS_PATH) && !argv.includes('--no-levels')) {
    const raw = readJson(LEVELS_PATH);
    const levels = Array.isArray(raw) ? raw : raw.levels || [];
    const missing = [];
    for (const lv of levels) {
        for (const key of ['shapeId', 'outlineId', 'shapeId2']) {
            const id = lv[key];
            if (!id) continue;
            if (!insp.shapes[id]) missing.push(`L${lv.id}.${key}="${id}"`);
        }
    }
    if (missing.length > 0) rep.bad(`levels.json 引用了不存在的形状（${missing.length} 处）：${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' …' : ''}`);
    else rep.ok(`levels.json 引用的形状全部存在（${levels.length} 关）`);
} else {
    rep.warn('没有 levels.json，跳过「关卡引用完整性」检查（先跑 tools/export_levels.mjs）');
}

if (source) console.log(C.dim(`\n  数据源：${source}`));
process.exit(rep.finish());
