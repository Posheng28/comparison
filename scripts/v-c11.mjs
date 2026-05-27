const toSlash=(y)=>`${y.slice(0,4)}/${y.slice(4,6)}/${y.slice(6,8)}`;
const num=(s)=>{const n=parseFloat(String(s).replace(/,/g,''));return isNaN(n)?null:n;};
async function close(ymd,code){const r=await fetch(`https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=${toSlash(ymd)}&type=EW&response=json`,{headers:{'User-Agent':'Mozilla/5.0'}});const j=await r.json();const row=j.tables?.[0]?.data?.find(x=>String(x[0]).trim()===code);return row?num(row[2]):null;}
const gap11=(p)=>70+Math.floor(p/300)*15;
const exp={'3131':535,'3211':110,'6138':87.5,'4760':92};
for(const [code,e] of Object.entries(exp)){const first=await close('20260519',code);const cur=await close('20260526',code);const spread=cur-first;const ok=Math.abs(spread-e)<0.6;console.log(code,'spread',spread.toFixed(1),'expect',e,ok?'MATCH':'MISMATCH','| gap',gap11(cur),spread>=gap11(cur)?'FIRES':'no');}
