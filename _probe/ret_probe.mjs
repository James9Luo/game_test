import fs from 'node:fs';
const h = fs.readFileSync('原型/dista_prototype.html', 'utf8');
// 找 CORE 定义之后第一个 "return {...}" 或 "return Core"
const start = h.indexOf('CORE = (function () {');
const seg = h.slice(start, start + 200000);
const re = /return\s+(Core|api|API)\s*;/g;
let m, hits = [];
while ((m = re.exec(seg))) hits.push([m.index, m[1]]);
console.log('return 语句:', hits.length, hits.slice(0, 5).map(x => x[1] + '@' + x[0]).join(', '));
const i2 = seg.indexOf('return {');
console.log('return { 位置 =', i2, i2 > 0 ? seg.slice(i2, i2 + 200).replace(/\s+/g, ' ') : '');
