import fs from 'node:fs';
const J = JSON.parse(fs.readFileSync('assets/resources/config/levels.json','utf8'));
const levels = J.levels || J;
const CSV = '01_策划文档/levels.csv';
const raw = fs.readFileSync(CSV,'utf8').replace(/^\uFEFF/,'');
const lines = raw.split(/\r?\n/).filter(l=>l.trim());
const header = lines[0].split(',');
const rows = lines.slice(1).map(l => { const c=l.split(','); const o={}; header.forEach((h,i)=>o[h.trim()]=(c[i]??'').trim()); return o; });
const byId = new Map(levels.map(l=>[l.id,l]));
for (const r of rows) {
  const lv = byId.get(Number(r.id)); if(!lv) continue;
  const r2 = v => Math.round(v);
  r.ang_speed_min = String(r2(lv.angSpeed[0]));
  r.ang_speed_max = String(r2(lv.angSpeed[1]));
  r.lin_speed_min = String(r2(lv.linSpeed[0]));
  r.lin_speed_max = String(r2(lv.linSpeed[1]));
  r.tolerance_deg = String(Math.round(lv.tolDegActual*10)/10);
  r.est_seconds = String(Math.max(3, Math.round(lv.cycleMs/1000 + 1.1)));
}
const out = [header.join(','), ...rows.map(o=>header.map(h=>o[h.trim()]??'').join(','))].join('\n')+'\n';
fs.writeFileSync(CSV,out,'utf8');
console.log('回填完成：15 行 speed/tolerance/est 已按派生值写入');
