import fs from 'node:fs';
const h = fs.readFileSync('原型/dista_prototype.html', 'utf8');
const hits = [...h.matchAll(/CORE\s*=\s*[^;\n]{0,80}/g)].map(m => m[0].replace(/\s+/g, ' '));
console.log('CORE 赋值处:', hits.length);
hits.slice(0, 6).forEach(x => console.log('  ' + x));
const i2 = h.indexOf('Core = {');
console.log('第一个 Core 对象位置 =', i2, '| 出现次数 =', (h.match(/Core\s*=\s*\{/g) || []).length);
