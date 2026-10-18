/**
 * tools/_placeholder_shapes.mjs —— 【临时占位】美术的 assets/config/shapes.json 未就绪时用它跑通链路
 *
 * 铁律：这里只放**临时**数据，绝不写 assets/config/（那是美术的写作用域）。
 * 真数据到位后：把 assets/config/shapes.json 放进去，所有工具自动优先用它，本文件不再被使用。
 *
 * 占位形状的构造方式：极坐标 r(θ) = 1 + Σ amp·cos(kθ+φ)，x = rx·cosθ·r，y = ry·sinθ·r。
 * 优点：r(θ) > 0 时一定是简单多边形（星形域），且能通过负 amp 做出凹形（吉他腰、杯子腰）。
 * 每个形状都刻意做成**不对称**（相位 φ≠0、纵横比 ≠1），因为对称形状会掩盖判定 bug。
 */

const V = (x, y) => ({ x, y });

function polarPts({ rx, ry, lobes = [], n = 20, phase0 = 0.37 }) {
    const pts = [];
    for (let i = 0; i < n; i++) {
        const t = phase0 + (i / n) * Math.PI * 2;
        let r = 1;
        for (const [k, amp, ph] of lobes) r += amp * Math.cos(k * t + ph);
        pts.push(V(rx * Math.cos(t) * r, ry * Math.sin(t) * r));
    }
    return pts;
}

/** 形心 → 原点，长边（包围盒大者）→ 1；保留 4 位小数 */
function normalize(pts) {
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % pts.length];
        const cr = p.x * q.y - q.x * p.y;
        a += cr;
        cx += (p.x + q.x) * cr;
        cy += (p.y + q.y) * cr;
    }
    if (Math.abs(a) < 1e-12) {
        cx = 0;
        cy = 0;
        for (const p of pts) {
            cx += p.x;
            cy += p.y;
        }
        cx /= pts.length;
        cy /= pts.length;
        a = 1;
    } else {
        cx /= 3 * a;
        cy /= 3 * a;
    }
    const moved = pts.map((p) => V(p.x - cx, p.y - cy));
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of moved) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    const k = 1 / Math.max(maxX - minX, maxY - minY);
    return moved.map((p) => V(Math.round(p.x * k * 1e4) / 1e4, Math.round(p.y * k * 1e4) / 1e4));
}

const DEFS = [
    { id: 'cup_tumbler', name: '杯子', size: 210, fill: '#cfd8e3', stroke: '#8fa3bd', rx: 0.23, ry: 0.5, lobes: [[2, -0.1, 0.3]], n: 20 },
    { id: 'car_hatch', name: '两厢车', size: 260, fill: '#9fd0f0', stroke: '#3d7ea6', rx: 0.6, ry: 0.32, lobes: [[3, 0.12, 0.4]], n: 24 },
    { id: 'slipper', name: '拖鞋', size: 280, fill: '#f7c9a0', stroke: '#b07a4a', rx: 0.75, ry: 0.28, lobes: [[2, 0.18, 0.9]], n: 20 },
    { id: 'banana', name: '香蕉', size: 300, fill: '#f6e27a', stroke: '#b9a232', rx: 0.62, ry: 0.3, lobes: [[1, 0.22, 0.6]], n: 22 },
    { id: 'wrench', name: '扳手', size: 320, fill: '#c2c8d0', stroke: '#6d747d', rx: 0.75, ry: 0.24, lobes: [[3, 0.16, 0.2]], n: 24 },
    { id: 'guitar', name: '吉他', size: 250, fill: '#e0b071', stroke: '#8a5f2d', rx: 0.34, ry: 0.5, lobes: [[2, -0.24, 0]], n: 24 },
    { id: 'tv', name: '电视', size: 240, fill: '#8d8d97', stroke: '#4a4a52', rx: 0.52, ry: 0.4, lobes: [[4, 0.05, 0.1]], n: 20 },
    { id: 'hammer', name: '锤子', size: 290, fill: '#b7b2a8', stroke: '#6b665c', rx: 0.62, ry: 0.26, lobes: [[1, 0.2, 1.2]], n: 20 },
    { id: 'duck', name: '鸭子', size: 250, fill: '#f9e089', stroke: '#b99a2e', rx: 0.56, ry: 0.36, lobes: [[1, 0.18, 0.4]], n: 22 },
    { id: 'cat', name: '猫咪', size: 230, fill: '#c9b8a8', stroke: '#7b6a5a', rx: 0.44, ry: 0.46, lobes: [[3, 0.14, 0.5]], n: 24 },
    { id: 'octopus', name: '章鱼', size: 250, fill: '#e79fb6', stroke: '#a35a72', rx: 0.5, ry: 0.48, lobes: [[7, 0.12, 0]], n: 28 },
    { id: 'rocket', name: '火箭', size: 260, fill: '#f0f0f0', stroke: '#6e6e78', rx: 0.3, ry: 0.5, lobes: [[3, 0.1, 0.8]], n: 20 },
    { id: 'burger', name: '汉堡', size: 240, fill: '#e8b878', stroke: '#946232', rx: 0.55, ry: 0.34, lobes: [[2, 0.14, 0.3]], n: 20 },
    { id: 'toilet', name: '马桶', size: 250, fill: '#f2f4f6', stroke: '#9aa3ac', rx: 0.4, ry: 0.5, lobes: [[2, -0.18, 0.7]], n: 22 },
    // can_cola 是 L5「忽然变速」用的罐子；补进来是为了「真 shapes.json 缺失时也能跑全 15 关」
    { id: 'can_cola', name: '可乐罐', size: 244, fill: '#e2523f', stroke: '#8f2c1f', rx: 0.25, ry: 0.5, lobes: [[2, -0.08, 0.2]], n: 20 },
];

/** 返回 Record<id, ShapeDef>（结构与美术的 shapes.json 完全一致） */
export function placeholderShapes() {
    const out = {};
    for (const d of DEFS) {
        out[d.id] = {
            id: d.id,
            name: d.name,
            size: d.size,
            fill: d.fill,
            stroke: d.stroke,
            pts: normalize(polarPts(d)),
        };
    }
    return out;
}

/** 与 shapes.json 相同的 JSON 形态（可以直接喂给 Core.loadShapes） */
export function placeholderShapesJson() {
    return { version: 0, note: 'TEMPORARY placeholders（tools/_placeholder_shapes.mjs）', shapes: Object.values(placeholderShapes()) };
}
