import fs from 'node:fs';
const CSV='01_策划文档/levels.csv';
const raw=fs.readFileSync(CSV,'utf8').replace(/^\uFEFF/,'');
const lines=raw.split(/\r?\n/).filter(l=>l.trim());
const header=lines[0].split(',');
const rows=lines.slice(1).map(l=>{const c=l.split(',');const o={};header.forEach((h,i)=>o[h.trim()]=(c[i]??'').trim());return o;});
let n=0;
for(const r of rows){ const v=Number(r.star3_rate); if(v>0.94){ r.star3_rate='0.94'; n++; } }
fs.writeFileSync(CSV,[header.join(','),...rows.map(o=>header.map(h=>o[h.trim()]??'').join(','))].join('\n')+'\n','utf8');
console.log('star3_rate 下调的关数 =', n);
