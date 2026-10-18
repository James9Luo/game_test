import fs from 'node:fs';
const h = fs.readFileSync('原型/dista_prototype.html', 'utf8');
const j = h.indexOf('core/index.ts');
console.log('index.ts 段 =', j);
console.log(h.slice(j, j + 2000).replace(/\s+/g, ' ').slice(0, 1600));
