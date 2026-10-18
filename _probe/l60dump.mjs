import fs from 'node:fs';
const h = fs.readFileSync('原型/dista_prototype.html', 'utf8');
const m = h.match(/\{"id":60[\s\S]{0,260}/);
console.log(m ? m[0].replace(/\s+/g, ' ').slice(0, 240) : '未找到');
