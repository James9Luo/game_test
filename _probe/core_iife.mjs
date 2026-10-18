import fs from 'node:fs';
const h = fs.readFileSync('原型/dista_prototype.html', 'utf8');
const i = h.indexOf('CORE = (function () {');
console.log(h.slice(i, i + 1400).replace(/\s+/g, ' '));
