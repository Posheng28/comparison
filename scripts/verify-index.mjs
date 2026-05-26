const trunc2 = (x) => Math.trunc(x * 100) / 100;
function sumDailyPct(closes) {
  let s = 0;
  for (let i = 1; i < closes.length; i++) s += (closes[i] / closes[i - 1] - 1) * 100;
  return s;
}
async function tpexCloses() {
  const r = await fetch('https://www.tpex.org.tw/openapi/v1/tpex_index', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const d = await r.json();
  return Object.fromEntries(d.map(x => [x.Date, parseFloat(String(x.Close).replace(/,/g, ''))]));
}
const m = await tpexCloses();
const days = ['20260519','20260520','20260521','20260522','20260525','20260526'];
const closes = days.map(x => m[x]);
const avg = sumDailyPct(closes);
console.log('tpex 全體均值 =', avg.toFixed(2), '(expect 9.98)');
if (Math.abs(avg - 9.98) > 0.05) { console.error('FAIL'); process.exit(1); }
console.log('PASS');
