import fs from 'node:fs';
const h = fs.readFileSync('原型/dista_prototype.html', 'utf8');
const start = h.indexOf('CORE = (function () {');
const end = h.indexOf('}());', start);
const tail = h.slice(Math.max(start, end - 900), end + 6);
console.log(tail.replace(/\s+/g, ' '));
