import fs from 'node:fs';
const CSV='01_策划文档/levels.csv';
const design={1:15,2:15,3:12,4:12,5:10,6:10,7:8,8:8,9:8,10:5,11:5,12:5,13:5,14:4,15:3};
const raw=fs.readFileSync(CSV,'utf8').replace(/^\uFEFF/,'');
const lines=raw.split(/\r?\n/).filter(l=>l.trim());
const header=lines[0].split(',');
const rows=lines.slice(1).map(l=>{const c=l.split(',');const o={};header.forEach((h,i)=>o[h.trim()]=(c[i]??'').trim());return o;});
for(const r of rows){ const d=design[Number(r.id)]; if(d) r.tolerance_deg=String(d); }
fs.writeFileSync(CSV,[header.join(','),...rows.map(o=>header.map(h=>o[h.trim()]??'').join(','))].join('\n')+'\n','utf8');
console.log('tolerance_deg 已恢复为设计意图值');
