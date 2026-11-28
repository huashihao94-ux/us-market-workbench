/* Stock pool V3: one consistent state/data/render pipeline. */
(function () {
"use strict";
const KEY="us-stock-watch-categories-v1", LIMIT=5000;
const GROWTH_MIN_CAP=20, GROWTH_MAX_CAP=999, GROWTH_RATE=30;
const GROWTH_PE_MIN=70, GROWTH_PE_MAX=90;
const CONSUMER_ROE_MIN=20;
const TYPE={giant:{name:"巨无霸",note:"市值超过5000亿美元，TTM PE分档"},
 growth:{name:"优秀成长股",note:"市值20—999亿 · TTM PE≥70且<90 · 历史EPS逐年≥30%（个人标准）"},
 cigar:{name:"烟蒂股",note:"Burry：现金流与资产折价＋低位技术图"},
 consumer:{name:"消费股",note:"TTM PE倒推隐含g · 与实际EPS增速比较 · ROE＞20%"},
 small:{name:"小市值公司",note:"PS与未来3—5年PE估值"}};
const BASE="https://raw.githubusercontent.com/huashihao94-ux/us-market-workbench/main/";
const FALLBACK=[
 ["Apple Inc.","AAPL","苹果",320193],["Microsoft Corporation","MSFT","微软",789019],
 ["NVIDIA Corporation","NVDA","英伟达",1045810],["Uber Technologies Inc.","UBER","优步",1543151],
 ["NerdWallet, Inc.","NRDS","NerdWallet",1625278],["Palantir Technologies","PLTR","帕兰提尔",1321655],
 ["Amazon.com Inc.","AMZN","亚马逊",1018724],["Alphabet Inc.","GOOGL","谷歌",1652044],
 ["Tesla Inc.","TSLA","特斯拉",1318605],["Meta Platforms","META","Meta",1326801],
 ["Berkshire Hathaway","BRK-B","伯克希尔",1067983],["Netflix","NFLX","奈飞",1065280],
 ["Coca-Cola","KO","可口可乐",21344],
 ["Costco Wholesale Corporation","COST","开市客 好市多 Costco",909832]
];
const $=id=>document.getElementById(id);
const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const value=x=>x===undefined||x===null||String(x).trim()===""?null:(Number.isFinite(Number(x))?Number(x):null);
const chinaTime=iso=>iso?new Date(iso).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"}):"未知";
const amount=(x,d=2)=>Number.isFinite(x)?x.toLocaleString("zh-CN",{minimumFractionDigits:d,maximumFractionDigits:d}):"—";
const badge=(text,color="plain")=>'<span class="badge '+color+'">'+esc(text)+'</span>';
const stocks=new Map(), universe=new Map(), queryPromises=new Map();
let cacheDate="",picked=null,currentType="giant",selected=null,items=[],searchSerial=0,cacheCount=0,hasLoaded=false;
function read(){
 try{const j=JSON.parse(localStorage.getItem(KEY)||"[]");if(!Array.isArray(j))return [];
  return j.filter(s=>s&&s.ticker&&s.name).slice(0,300).map(s=>{
    const ticker=String(s.ticker).toUpperCase(),oldType=s.type;
    const type=oldType==="white"?"giant":oldType==="growth"&&s.inputs?.lossMaking?"small":TYPE[oldType]?oldType:"growth";
    return {id:ticker,ticker,name:String(s.name),type,inputs:{...(s.inputs||{})},autoFields:s.autoFields||[],createdAt:s.createdAt||""};
  });
 }catch{return [];}
}
function persist(){try{localStorage.setItem(KEY,JSON.stringify(items))}catch{$("saveInfo").textContent="浏览器限制本地保存，请导出备份";}}
function record(stock){return stocks.get(stock.ticker)||null}
function oneField(s,k){const r=record(s);const v=value(r?.[k]);if(v!==null)return {value:v,origin:"自动数据"};const manual=value(s.inputs?.[k]);if(manual!==null)return {value:manual,origin:"人工录入"};return {value:null,origin:"未取得"}}
function financial(s){
 const r=record(s),p=oneField(s,"price").value,shares=oneField(s,"shares").value,
 eps=oneField(s,"ttmEPS").value,annualEPS=oneField(s,"eps").value,
 roe=oneField(s,"roe").value,revenue=oneField(s,"revenue").value,
 income=oneField(s,"netIncome").value,eq=oneField(s,"equity").value,
 div=oneField(s,"dividend").value;
 const cap=p>0&&shares>0?p*shares:(value(r?.marketCap)>0?value(r.marketCap):null);
 const peTTM=p>0&&eps>0?p/eps:null, peAnnual=p>0&&annualEPS>0?p/annualEPS:null;
 const ps=cap>0&&revenue>0?cap/revenue:null, pb=cap>0&&eq>0?cap/eq:null;
 const yieldPct=p>0&&div!==null?div/p*100:null;
 return {r,p,shares,eps,annualEPS,roe,revenue,income,eq,div,cap,peTTM,peAnnual,ps,pb,yieldPct};
}
function annualRows(s,field){
 const rows=record(s)?.annualHistory?.[field]||[];
 return (Array.isArray(rows)?rows:[]).map(x=>({end:String(x.end||""),amount:value(x.value)}))
  .filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.end)&&x.amount!==null)
  .sort((a,b)=>b.end.localeCompare(a.end)).slice(0,6);
}
// A partial SEC refresh must never discard already retrieved fiscal history.
// Join by fiscal period: newly disclosed/restated rows win for matching dates,
// while older years remain available to compute year-over-year changes.
function mergeAnnualHistory(oldHistory,newHistory){
 const merged={...(oldHistory||{})};
 for(const [field,rows] of Object.entries(newHistory||{})){
  if(!Array.isArray(rows)||!rows.length)continue;
  const byEnd=new Map();
  for(const row of merged[field]||[]){
   if(/^\d{4}-\d{2}-\d{2}$/.test(String(row?.end||""))&&value(row.value)!==null)
    byEnd.set(row.end,row);
  }
  for(const row of rows){
   if(/^\d{4}-\d{2}-\d{2}$/.test(String(row?.end||""))&&value(row.value)!==null)
    byEnd.set(row.end,row);
  }
  merged[field]=[...byEnd.values()].sort((a,b)=>b.end.localeCompare(a.end)).slice(0,6);
 }
 return merged;
}
// Growth based on actual annual reports only. Negative earnings are disclosed
// but never disguised as a positive percentage growth rate.
function fiscalChange(rows,year){
 const curr=rows.find(x=>Number(x.end.slice(0,4))===year);
 const prev=rows.find(x=>Number(x.end.slice(0,4))===year-1);
 if(!curr)return {amount:null,rate:null,reason:"该财年暂无年度数据"};
 if(!prev)return {amount:curr.amount,rate:null,reason:"缺少上一财年基数"};
 const days=(Date.parse(curr.end)-Date.parse(prev.end))/86400000;
 if(days<320||days>410)return {amount:curr.amount,rate:null,reason:"财年不连续"};
 if(prev.amount<=0){
  let reason="上年基数不为正，不计算普通同比";
  if(prev.amount<0&&curr.amount>0)reason="扭亏为盈（同比百分比不可比）";
  else if(prev.amount<0&&curr.amount<0)
   reason=(curr.amount>prev.amount?"亏损收窄 ":"亏损扩大 ")+
    amount(Math.abs(curr.amount/prev.amount-1)*100,1)+"%（不是盈利增长率）";
  return {amount:curr.amount,rate:null,reason};
 }
 if(curr.amount<=0)return {amount:curr.amount,rate:null,reason:"由盈转亏／利润归零"};
 return {amount:curr.amount,rate:(curr.amount/prev.amount-1)*100,reason:""};
}
// Four disclosed fiscal years contain three compounding intervals. Do not
// compute a misleading EPS CAGR across losses or an incomplete annual series.
function threeYearCagr(series,key){
 if(series.length!==4||series.some(x=>!(x[key]>0)))return null;
 return (Math.pow(series[3][key]/series[0][key],1/3)-1)*100;
}
function growthModel(s,f){
 const histories={eps:annualRows(s,"eps"),revenue:annualRows(s,"revenue"),netIncome:annualRows(s,"netIncome")};
 const dates=Object.values(histories).flat().map(x=>x.end).sort();
 const year=dates.length?Number(dates[dates.length-1].slice(0,4)):null;
 const years=year===null?["前4年","前3年","前2年","最近年"]:
  [year-3,year-2,year-1,year].map(String);
 const series=years.map(y=>{
  const eps=fiscalChange(histories.eps,Number(y));
  const revenue=fiscalChange(histories.revenue,Number(y));
  const profit=fiscalChange(histories.netIncome,Number(y));
  return {year:y,kind:"实际",eps:eps.amount,epsRate:eps.rate,epsReason:eps.reason,
   revenue:revenue.amount,revenueRate:revenue.rate,revenueReason:revenue.reason,
   profit:profit.amount,profitRate:profit.rate,profitReason:profit.reason,
   rate:eps.rate,reason:eps.reason};
 });
 const capOk=f.cap===null?null:f.cap>=GROWTH_MIN_CAP&&f.cap<=GROWTH_MAX_CAP;
 const lossEPS=series.some(x=>x.eps!==null&&x.eps<=0);
 const pastOk=lossEPS||series.some(x=>x.rate!==null&&x.rate<GROWTH_RATE)?false:
  series.every(x=>x.rate!==null)?true:null;
 // Only actual trailing-twelve-month P/E counts. Annual P/E cannot silently
 // substitute for a missing TTM denominator.
 const peOk=f.peTTM===null?null:f.peTTM>=GROWTH_PE_MIN&&f.peTTM<GROWTH_PE_MAX;
 const overall=[capOk,peOk,pastOk].includes(false)?false:
  [capOk,peOk,pastOk].every(x=>x===true)?true:null;
 return {annual:histories.netIncome,series,year,capOk,peOk,pastOk,overall,
  epsCagr:threeYearCagr(series,"eps"),revenueCagr:threeYearCagr(series,"revenue")};
}
function consumerModel(s,f){
 // Invert the user's heuristic PE = 10 + 2g. This is a valuation-implied
 // growth figure, NOT a prediction of future earnings or revenue.
 const impliedGrowth=f.peTTM===null?null:(f.peTTM-10)/2;
 const epsHistory=annualRows(s,"eps");
 const recent=epsHistory[0]||null;
 const actual=recent?fiscalChange(epsHistory,Number(recent.end.slice(0,4))):
  {rate:null,reason:"缺少已披露的年度EPS"};
 const actualGrowth=actual.rate;
 const gap=impliedGrowth===null||actualGrowth===null?null:impliedGrowth-actualGrowth;
 const roeOk=f.roe===null?null:f.roe>CONSUMER_ROE_MIN;
 // Only ROE is the consumer hard screen. The two growth figures are context.
 return {peTTM:f.peTTM,impliedGrowth,actualGrowth,actualYear:recent?.end.slice(0,4)||"",
  actualReason:actual.reason,gap,roeOk,overall:roeOk};
}
function growthPlot(s,f){
 if(s.type!=="growth")return "";
 const g=growthModel(s,f),rates=g.series.map(x=>x.rate).filter(x=>x!==null&&Number.isFinite(x));
 const lo=Math.floor((Math.min(0,30,...rates)-15)/25)*25;
 const hi=Math.ceil((Math.max(60,30,...rates)+15)/25)*25;
 const xs=[85,245,405,565],y=v=>194-(v-lo)/(hi-lo)*144;
 const ticks=Array.from({length:5},(_,i)=>lo+(hi-lo)*i/4);
 const grid=ticks.map(v=>'<line x1="65" x2="610" y1="'+y(v)+'" y2="'+y(v)+'" stroke="#30445c" stroke-width="1"/>'+
  '<text x="55" y="'+(y(v)+4)+'" text-anchor="end" fill="#a6b5c5" font-size="12">'+amount(v,0)+'%</text>').join("");
 let lines="";
 for(let i=1;i<g.series.length;i++){
  const prev=g.series[i-1],cur=g.series[i];
  if(prev.rate===null||cur.rate===null)continue;
  lines+='<path d="M'+xs[i-1]+' '+y(prev.rate)+' L'+xs[i]+' '+y(cur.rate)+
   '" fill="none" stroke="#79d9e7" stroke-width="3" stroke-linecap="round"/>';
 }
 const dots=g.series.map((a,i)=>{
  return (a.rate===null?
   '<text x="'+xs[i]+'" y="118" text-anchor="middle" fill="#8fa3b7" font-size="'+
   (a.reason.includes("扭亏为盈")?"14":"22")+'">'+
   (a.reason.includes("扭亏为盈")?"扭亏":a.eps!==null&&a.eps<=0?"亏损":"?")+'</text>':
   '<circle cx="'+xs[i]+'" cy="'+y(a.rate)+'" r="5" fill="#79d9e7" stroke="#10192a" stroke-width="2"/>'+
   '<text x="'+xs[i]+'" y="'+(y(a.rate)-12)+'" text-anchor="middle" fill="#79d9e7" font-size="13" font-weight="700">'+
   amount(a.rate,1)+'%</text>')+
   '<text x="'+xs[i]+'" y="224" text-anchor="middle" fill="#eaf3fb" font-size="13">'+esc(a.year)+'</text>'+
   '<text x="'+xs[i]+'" y="244" text-anchor="middle" fill="#a6b5c5" font-size="11">财报</text>';
 }).join("");
 const svg='<svg class="growth-svg" viewBox="0 0 670 255" role="img" aria-label="'+
  esc("从左到右为最近四个已披露财年实际EPS同比增长率，红色虚线为自定30%参考线，不包含预测")+'">'+
  grid+'<line x1="65" x2="610" y1="'+y(30)+'" y2="'+y(30)+
  '" stroke="#ff9da6" stroke-width="1.5" stroke-dasharray="5 5"/>'+
  '<text x="611" y="'+(y(30)-6)+'" text-anchor="end" fill="#ffb9c0" font-size="11">EPS参考 30%</text>'+
  lines+dots+'</svg>';
 const valueAndGrowth=(v,rate,reason,unit)=>
  '<strong>'+(v===null?"—":amount(v,2)+unit)+'</strong><div class="small muted">'+
  (rate===null?esc(reason):"同比 "+amount(rate,1)+"%")+'</div>';
 const rows=g.series.map(a=>'<tr><td>'+esc(a.year)+'</td><td>'+ 
  valueAndGrowth(a.eps,a.epsRate,a.epsReason,"美元")+
  (a.epsRate!==null?badge(a.epsRate>=GROWTH_RATE?"≥30%":"<30%",a.epsRate>=GROWTH_RATE?"pass":"fail"):"")+
  '</td><td>'+valueAndGrowth(a.revenue,a.revenueRate,a.revenueReason,"亿")+
  '</td><td>'+valueAndGrowth(a.profit,a.profitRate,a.profitReason,"亿")+
  '</td></tr>').join("");
 return '<h3>最近四个已披露财年：EPS、营收与净利润</h3>'+
  '<p class="small muted">四个点均为真实年度财报，不再加入下一年预测。上图是每股收益EPS同比增速；红色虚线是你设定的30%参考线。下表另外展示营收、净利润和各自同比。</p>'+
  '<div class="growth-chart">'+svg+'</div><div class="growth-table-wrap"><table class="growth-table"><thead>'+
  '<tr><th>财年</th><th>年度EPS及同比</th><th>营业收入及同比</th><th>净利润及同比</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
  '<p class="small muted">财报来源：SEC年度10-K；收入和净利润单位为亿美元。首个展示年份的同比还需前一年的年报作为基数。EPS或净利润由亏转盈、连续亏损等情况不计为普通正向同比，仍列出实际金额和亏损变化；30%是自定筛选参考值，不是所有行业通用标准。</p>';
}

function burryModel(s,f){
 const r=f.r||{},cash=value(r.cash),debt=value(r.debt),ebitda=value(r.ebitda),
  fcf=value(r.fcf),currentAssets=value(r.currentAssets),liabilities=value(r.liabilities),
  low52=value(r.low52);
 const ev=f.cap!==null&&cash!==null&&debt!==null?f.cap+debt-cash:null;
 const evToEbitda=ev!==null&&ebitda>0?ev/ebitda:null;
 const fcfYield=f.cap>0&&fcf!==null?fcf/f.cap*100:null;
 // Graham-style net-net: current assets less *all* liabilities; not merely
 // current liabilities, and never count missing liabilities as zero.
 const ncav=currentAssets!==null&&liabilities!==null?currentAssets-liabilities:null;
 const ncavRatio=ncav>0&&f.cap>0?f.cap/ncav:null;
 const fromLow=f.p>0&&low52>0?(f.p/low52-1)*100:null;
 const raw=Array.isArray(r.priceHistory)?r.priceHistory:[];
 const byDate=new Map();
 for(const row of raw){
  if(!Array.isArray(row)||!/\d{4}-\d{2}-\d{2}/.test(String(row[0]))||!(value(row[1])>0))continue;
  byDate.set(String(row[0]),value(row[1]));
 }
 const prices=[...byDate].sort((a,b)=>a[0].localeCompare(b[0]))
  .slice(-260).map(([date,close])=>({date,close}));
 const average=n=>prices.length>=n?
  prices.slice(-n).reduce((sum,x)=>sum+x.close,0)/n:null;
 const ma50=average(50),ma200=average(200);
 // A rough support *candidate*: two separated low-area tests and no recent
 // closing breach. This is not a verified chart pattern or buy instruction.
 let tests=0,lastTest=-1000;
 if(low52>0){
  prices.forEach((x,i)=>{
   if(x.close<=low52*1.05&&i-lastTest>=10){tests++;lastTest=i;}
  });
 }
 const hold=low52>0&&prices.length>=20&&prices.slice(-20).every(x=>x.close>=low52*0.99);
 const near52=fromLow!==null&&fromLow>=0&&fromLow<=15;
 const support=prices.length>=60&&near52&&tests>=2&&hold;
 return {cash,debt,ebitda,fcf,ev,evToEbitda,fcfYield,ncav,ncavRatio,
  low52,fromLow,prices,ma50,ma200,near52,support,tests};
}
function burryPlot(s,f){
 if(s.type!=="cigar")return "";
 const m=burryModel(s,f),prices=m.prices;
 const intro='<h3>Michael Burry 参考：日线位置与低位支撑</h3>'+
  '<p class="small muted">他的早期公开方法强调先研究内在价值，再观察52周低点附近约10%—15%的价格区间及支撑。下图是实际日线收盘价（青）、50日均线（橙）、200日均线（紫），绿色虚线标记52周低点；均线和支撑只是辅助，不是他的固定公式。</p>';
 if(prices.length<20)
  return intro+'<div class="growth-chart empty">这只股票暂无足够的可核实日线数据，暂不绘制价格曲线。52周低价和估值指标仍独立显示；等待后台更新后自动补充。</div>';
 const close=prices.map(x=>x.close),all=close.concat(m.low52>0?[m.low52]:[]);
 const min=Math.min(...all),max=Math.max(...all),pad=Math.max((max-min)*0.10,max*0.02,0.01);
 const lower=Math.max(0,min-pad),upper=max+pad;
 const x=i=>66+i/Math.max(1,prices.length-1)*560;
 const y=v=>205-(v-lower)/(upper-lower)*162;
 const poly=series=>{
  let d="",started=false;
  series.forEach((v,i)=>{
   if(v===null){started=false;return;}
   d+=(started?" L":" M")+x(i).toFixed(1)+" "+y(v).toFixed(1);
   started=true;
  });
  return d.trim();
 };
 const mas=n=>prices.map((_,i)=>i+1<n?null:
  prices.slice(i+1-n,i+1).reduce((sum,row)=>sum+row.close,0)/n);
 const line=(path,color,dash="")=>'<path d="'+path+'" fill="none" stroke="'+color+
  '" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"'+
  (dash?' stroke-dasharray="'+dash+'"':"")+'/>';
 const grid=Array.from({length:5},(_,i)=>lower+(upper-lower)*i/4).map(v=>
  '<line x1="62" x2="630" y1="'+y(v)+'" y2="'+y(v)+'" stroke="#30445c" stroke-width="1"/>'+
  '<text x="57" y="'+(y(v)+4)+'" text-anchor="end" fill="#9cafc3" font-size="12">$'+amount(v,1)+'</text>').join("");
 const dates=[0,Math.floor((prices.length-1)/3),Math.floor((prices.length-1)*2/3),prices.length-1]
  .map(i=>'<text x="'+x(i)+'" y="235" text-anchor="middle" fill="#c3d6e7" font-size="12">'+
   esc(prices[i].date.slice(0,7))+'</text>').join("");
 const supportLine=m.low52>0?
  '<line x1="62" x2="630" y1="'+y(m.low52)+'" y2="'+y(m.low52)+
  '" stroke="#82ddbb" stroke-dasharray="6 5" stroke-width="1.5"/>'+
  '<text x="630" y="'+(y(m.low52)-7)+'" text-anchor="end" fill="#82ddbb" font-size="12">52周低点 $'+amount(m.low52)+'</text>':"";
 const svg='<svg class="growth-svg" viewBox="0 0 680 255" role="img" aria-label="'+
  esc("过去约一年的真实日线收盘价，50日均线，200日均线和52周最低价")+'">'+
  grid+supportLine+line(poly(close),"#79d9e7")+
  (prices.length>=50?line(poly(mas(50)),"#ffcb89"):"")+
  (prices.length>=200?line(poly(mas(200)),"#bba8ff"):"")+
  dates+'</svg>';
 return intro+'<div class="growth-chart">'+svg+'</div>'+
  '<div class="chart-legend"><span class="legend-close">日收盘价</span><span class="legend-ma50">50日均线'+(m.ma50===null?"（数据不足）":" $"+amount(m.ma50))+'</span>'+
  '<span class="legend-ma200">200日均线'+(m.ma200===null?"（数据不足）":" $"+amount(m.ma200))+'</span></div>'+
  '<p class="small muted">曲线截至 '+esc(prices.at(-1).date)+'；行情源：'+esc(f.r?.priceSource||"未注明")+
  '。近低位、均线或反弹并不证明资产便宜，也不能代替审查债务、流动性及真实自由现金流。</p>';
}

function effectiveType(s){return s.type==="white"?"giant":s.type}
function enforce(){
 let changed=false;
 for(const s of items){
   const cap=financial(s).cap;
   if(cap!==null&&cap>LIMIT&&s.type!=="giant"){s.type="giant";changed=true;}
   if(cap!==null&&cap<=LIMIT&&s.type==="giant"){s.type="growth";changed=true;}
 }
 if(changed)persist();
 if(selected){
   const s=items.find(x=>x.ticker===selected);
   if(s)currentType=s.type;
 }
}
function renderCategories(){
 const cards=Object.keys(TYPE).map(key=>{
  const arr=items.filter(s=>s.type===key);
  return '<button class="cat '+(currentType===key?"active":"")+'" data-type="'+key+'"><strong>'+
  esc(TYPE[key].name)+'</strong><small>'+esc(TYPE[key].note)+'</small><div><b>'+arr.length+'</b> 只观察</div></button>';
 });
 $("categories").innerHTML=cards.join("");
 $("categories").querySelectorAll("button").forEach(btn=>btn.addEventListener("click",()=>{
   currentType=btn.dataset.type;selected=items.find(s=>s.type===currentType)?.ticker||null;render();
 }));
}
function renderList(){
 const arr=items.filter(s=>s.type===currentType);
 $("listLabel").textContent=TYPE[currentType].name+"观察区（"+arr.length+"只）";
 $("list").innerHTML=arr.length?arr.map(s=>{
  const f=financial(s);
  return '<button class="stock '+(s.ticker===selected?"active":"")+'" data-ticker="'+esc(s.ticker)+'"><span><strong>'+esc(s.name)+'</strong> '+esc(s.ticker)+'</span><small>'+
  (f.p===null?"股价待获取":"$"+amount(f.p))+" · "+(f.r?.priceDate||"报价日期未知")+
  " · "+(f.cap===null?"市值待获取":"市值"+amount(f.cap,0)+"亿美元")+'</small></button>';
 }).join(""):'<div class="empty">还没有这个类别的股票。上方搜索后即可加入。</div>';
 $("list").querySelectorAll("button").forEach(btn=>btn.addEventListener("click",()=>{
   selected=btn.dataset.ticker;render();const s=items.find(x=>x.ticker===selected);
   if(s&&(!record(s)||!record(s).financialMeta))loadOnDemand(s.ticker);
 }));
}
function cell(label,n,unit,source=""){
 return '<div class="metric"><span>'+esc(label)+'</span><strong>'+(n===null?"—":amount(n,2)+esc(unit))+
 '</strong><small>'+esc(source||"")+'</small></div>';
}
function keyLine(label,left,right,tag){
 return '<div class="comparison"><div><strong>'+esc(label)+'</strong><div class="small muted">'+esc(right)+'</div></div>'+
 '<div class="compare-value">'+esc(left)+'</div>'+badge(tag,tag.includes("未达标")||tag.includes("不达标")||tag.includes("偏高")||tag.includes("低于")?"fail":tag.includes("达标")||tag.includes("优选")?"pass":"neutral")+'</div>';
}
function period(r,key){
 const m=r?.financialMeta?.fields?.[key];return m?.end||"日期未知";
}
function growthSection(title,description,rows){
 return '<section class="growth-eval-group"><div class="growth-eval-head"><h4>'+esc(title)+'</h4>'+ 
  '<p class="small muted">'+esc(description)+'</p></div><div class="growth-eval-items">'+rows.join("")+'</div></section>';
}
function statuses(s,f){
 const v=s.inputs||{},out=[];
 if(s.type==="giant"){
  if(f.cap===null)out.push(keyLine("自动分类市值门槛","市值待取得","标准：市值 > 5000亿美元","待核实"));
  else out.push(keyLine("自动分类市值门槛",amount(f.cap,0)+(f.cap>LIMIT?" > ":" ≤ ")+"5,000","市值单位：亿美元",f.cap>LIMIT?"已达标":"未达标"));
  if(f.peTTM===null){
   out.push(keyLine("TTM PE（当前价÷最近12个月EPS）","无法计算","最佳：≤20倍；可接受：20—25倍；超过25倍偏高","待核实"));
  }else{
   const p=f.peTTM;
   const text=p<20?amount(p)+" < 20":p===20?amount(p)+" = 20":p<=25?"20 < "+amount(p)+" ≤ 25":amount(p)+" > 25";
   out.push(keyLine("TTM PE所在位置",text,"你的标准：20倍以内优选，20—25倍可接受，25倍以上超标",
      p<=20?"优选达标":p<=25?"区间达标":"偏高未达标"));
  }
 }else if(s.type==="growth"){
   const g=growthModel(s,f);
   const growthRows=[],qualityRows=[],valuationRows=[];
   const have=g.series.filter(x=>x.rate!==null).length;
   growthRows.push(keyLine("最近4个财年的EPS同比：逐年≥30%",
     g.pastOk===true?"4/4 年 ≥30%":g.pastOk===false?"有年份低于30%，或EPS非正":have+"/4 年可计算",
     "你的原定硬标准：四个已披露财年的EPS同比每年都至少30%，缺少上一年基数不算自动达标；无当年/明年预测",
     g.pastOk===null?"待数据":g.pastOk?"已达标":"未达标"));
   growthRows.push(keyLine("过去3年EPS复合年增长率（CAGR）",
     g.epsCagr===null?(g.series.some(x=>x.eps!==null&&x.eps<=0)?
       "历史EPS含亏损，CAGR不适用":"年度EPS数据不足"):amount(g.epsCagr,1)+"%/年",
     "四个真实财年首尾计算，跨3个年度间隔；历年EPS都须为正。辅助看整体趋势，不能代替逐年≥30%的硬标准",
     g.epsCagr===null?"不强算":"辅助参考"));
   growthRows.push(keyLine("过去3年营收复合年增长率（CAGR）",
     g.revenueCagr===null?"数据不足":amount(g.revenueCagr,1)+"%/年",
     "只取最近四个已披露财年的实际营业收入。检验盈利增长是否也有业务增长支撑；不另外设置30%硬门槛",
     g.revenueCagr===null?"待财报":"辅助参考"));

   const fcf=value(f.r?.fcf),fcfMargin=fcf!==null&&f.revenue>0?fcf/f.revenue*100:null;
   qualityRows.push(keyLine("ROE：净资产收益率",
     f.roe===null?"待财报":amount(f.roe,1)+"%",
     "最近完整财年净利润÷平均股东权益。观察资本使用效率；成长股暂不设ROE硬门槛，与消费股的ROE>20%分开",
     f.roe===null?"待数据":"质量参考"));
   qualityRows.push(keyLine("自由现金流（FCF）",
     fcf===null?"待财报":amount(fcf,2)+" 亿美元",
     "经营活动现金流减资本开支；盈利增长能否转化为现金是重要核验，单年负值须结合投资周期解释",
     fcf===null?"待数据":fcf>0?"现金流为正":"现金流为负"));
   qualityRows.push(keyLine("自由现金流率（FCF÷营收）",
     fcfMargin===null?"无法计算":amount(fcfMargin,1)+"%",
     "最近完整年度的自由现金流÷营业收入；观察现金创造能力，不设跨行业统一及格线",
     fcfMargin===null?"待数据":"质量参考"));
   qualityRows.push(keyLine("年度净利润",
     f.income===null?"待财报":amount(f.income,2)+" 亿美元",
     "和上方历年EPS、营收一起核对；扭亏为盈不是普通的正百分比同比增长",
     f.income===null?"待数据":f.income>0?"已有盈利":"仍在亏损"));

   const capPosition=f.cap===null?"待查询":f.cap<GROWTH_MIN_CAP?
     amount(f.cap,1)+" < 20 亿美元":f.cap>GROWTH_MAX_CAP?
     amount(f.cap,1)+" > 999 亿美元":"20 ≤ "+amount(f.cap,1)+" ≤ 999 亿美元";
   valuationRows.push(keyLine("市值：你的20—999亿美元区间",capPosition,
     "你的原定硬标准；市值大小本身并不等于企业成长质量",
     g.capOk===null?"待数据":g.capOk?"已达标":"未达标"));
   const pePosition=f.peTTM===null?(f.eps!==null&&f.eps<=0?"TTM EPS非正，PE不适用":"TTM PE待财报"):
     f.peTTM<GROWTH_PE_MIN?amount(f.peTTM)+" < 70":
     f.peTTM<GROWTH_PE_MAX?"70 ≤ "+amount(f.peTTM)+" < 90":
     amount(f.peTTM)+" ≥ 90";
   valuationRows.push(keyLine("TTM PE：你的70—90倍区间",pePosition+(f.peTTM===null?"":" 倍"),
     "你的原定硬标准：70 ≤ 当前TTM PE < 90；高PE不自动代表优质，必须配合成长性和现金流",
     g.peOk===null?(f.eps!==null&&f.eps<=0?"亏损不适用":"待数据"):g.peOk?"已达标":"未达标"));
   if(f.ps!==null)valuationRows.push(keyLine("当前市销率（PS）",
     amount(f.ps,2)+" 倍","当前市值÷最近完整年度营业收入；辅助比较，不设统一硬阈值","估值参考"));
   if(f.peTTM===null&&f.peAnnual!==null)
     valuationRows.push(keyLine("仅供参考：年度PE",amount(f.peAnnual,2)+" 倍",
       "非TTM PE，不能拿年度值代替你的70—90倍硬标准","不同口径"));
   valuationRows.push(keyLine("按你原标准：三项综合硬判断",
     g.overall===true?"三项均达标":g.overall===false?"至少一项未达标":"缺少完整数据",
     "仅合并原来的市值20—999亿美元、TTM PE 70至90倍、4个实际财年EPS同比逐年≥30%；CAGR、ROE、FCF均为辅助观察",
     g.overall===null?"待数据":g.overall?"已达标":"未达标"));
   return growthSection("① 成长性：增长是否持续","原标准是历年EPS逐年≥30%；两个CAGR仅帮你看趋势",growthRows)+
    growthSection("② 增长质量：赚的钱是否扎实","ROE、自由现金流及净利润辅助核对，不擅自新增硬门槛",qualityRows)+
    growthSection("③ 估值位置：现在贵不贵","按你个人的市值、PE区间判断；PS辅助对照",valuationRows);
 }else if(s.type==="cigar"){
   const b=burryModel(s,f);
   out.push(keyLine("Burry：企业价值 EV / EBITDA",
     b.evToEbitda===null?"—":amount(b.evToEbitda,2)+"倍",
     "EV=市值＋有息债务－现金；EBITDA≈营业利润＋折旧摊销，需结合行业和周期比较，没有统一的通过倍数",
     b.evToEbitda===null?"待数据":"估值参考"));
   out.push(keyLine("Burry：自由现金流收益率",
     b.fcfYield===null?"—":amount(b.fcfYield,2)+"%",
     "最近完整年度自由现金流÷当前市值；负数表示现金流消耗，不自动代表被低估",
     b.fcfYield===null?"待数据":b.fcfYield>0?"现金流为正":"现金流为负"));
   out.push(keyLine("Burry/Graham：净净股资产折价",
     b.ncavRatio===null?(b.ncav!==null&&b.ncav<=0?"净流动资产不为正":"待数据"):
       amount(b.ncavRatio,2)+"倍 "+(b.ncavRatio<2/3?"< 0.67": "≥ 0.67"),
     "净流动资产价值NCAV＝流动资产－全部负债；市值<NCAV的2/3才符合这一特殊资产型筛选，不代表可以买入",
     b.ncavRatio===null?"待核实":b.ncavRatio<2/3?"资产折价候选":"未达标"));
   out.push(keyLine("Burry：现价相对52周低点",
     b.fromLow===null?"—":amount(b.fromLow,1)+"%"+(b.near52?" ≤ 15%":" > 15%或跌破旧低"),
     "本人早期公开偏好：在已有支撑的52周低点附近10%—15%以内观察；不是单靠跌幅决定买点",
     b.fromLow===null?"待行情":b.near52?"低位区间":"不在区间"));
   out.push(keyLine("日线低位支撑辅助核验",
     b.prices.length<60?"日线不足":b.support?"有两次分离的低位测试":"尚未确认",
     "辅助规则：至少60个收盘日、相隔≥10交易日的两次低位测试，且近20日未明显跌破低位；不属于Burry公布的固定公式",
     b.prices.length<60?"待数据":b.support?"初步支撑":"谨慎观察"));
   if(b.ma50!==null)
     out.push(keyLine("当前价与50日均线",
       amount(f.p)+(f.p>=b.ma50?" ≥ ":" < ")+amount(b.ma50)+"美元",
       "趋势参考而非买卖信号",f.p>=b.ma50?"高于均线":"低于均线"));
   out.push(keyLine("Burry研究提示",
     "估值优先，图形辅助",
     "查看高负债、一次性现金流、表外风险与行业逆风；不要把低PE或触及52周低点自动解释为安全边际",
     "研究清单"));
   // Preserve the older classic cigar-stock heuristics, but explicitly
   // label them as distinct from Burry's documented method.
   const tests=[
    ["传统烟蒂参考：PE",f.peTTM,15,"倍",false],
    ["传统烟蒂参考：PB",f.pb,1,"倍",false],
    ["传统烟蒂参考：股息率",f.yieldPct,3,"%",true]
   ];
   for(const [name,val,limit,unit,higher] of tests){
     out.push(keyLine(name,val===null?"—":amount(val)+(higher?(val>=limit?" ≥ ":" < "):(val<limit?" < ":" ≥ "))+limit,
       "初筛参考："+(higher?"≥ ":"< ")+limit+unit,val===null?"待财报":higher?val>=limit?"符合":"未达标":val<limit?"符合":"未达标"));
   }
   const fair=value(v.manualFair),mos=fair>0&&f.p>0?(1-f.p/fair)*100:null;
   out.push(keyLine("安全边际",mos===null?"待估算":amount(mos)+"%","需要自己填写合理价格；不自动假设市场价值",mos===null?"待估算":mos>=30?"符合":"未达标"));
 }else if(s.type==="consumer"){
   const c=consumerModel(s,f);
   out.push(keyLine("当前TTM PE（倒算依据）",
     c.peTTM===null?"TTM PE不可计算":amount(c.peTTM,2)+" 倍",
     "按最新收盘价÷最近12个月已披露稀释EPS计算；净利润为负或数据不足时不强算PE",
     c.peTTM===null?"待财报":"已取得"));
   out.push(keyLine("按PE倒推的隐含增长率 g",
     c.impliedGrowth===null?"无法倒算":amount(c.impliedGrowth,2)+"%",
     "个人经验公式 PE＝10＋2g，反推 g＝(TTM PE－10)÷2；这是当前估值隐含的增长要求，不是公司真实增长率或分析师预测",
     c.impliedGrowth===null?"待PE":"估值换算"));
   out.push(keyLine("最近完整财年实际EPS同比增速",
     c.actualGrowth===null?(c.actualReason||"不可计算"):amount(c.actualGrowth,2)+"%",
     (c.actualYear?c.actualYear+"财年；":"")+"来自SEC年度财报EPS，与上一完整财年比较；上年亏损、扭亏或年度数据缺失时不计算普通百分比",
     c.actualGrowth===null?"不可比较":"真实历史"));
   const sign=c.gap===null?"无法比较":Math.abs(c.gap)<0.005?"=":c.gap>0?">":"<";
   const difference=c.gap===null?"不可比较":
     amount(c.impliedGrowth,2)+"% "+sign+" "+amount(c.actualGrowth,2)+"%";
   out.push(keyLine("隐含g vs 实际EPS增速",
     difference,
     c.gap===null?"需要有效TTM PE以及连续两年为正的年度EPS":
      "隐含增长率"+(Math.abs(c.gap)<0.005?"与实际增长率相当":c.gap>0?"高于":"低于")+
      "最近财年实际增长率，差值"+amount(Math.abs(c.gap),2)+"个百分点；不同时间口径，仅作直观对比",
     c.gap===null?"不可比较":Math.abs(c.gap)<0.005?"基本相等":c.gap>0?"隐含较高":"隐含较低"));
   out.push(keyLine("消费股：ROE硬标准",
     f.roe===null?"年报数据缺失":amount(f.roe,2)+(f.roe>20?" > ":f.roe===20?" = ":" < ")+"20%",
     "你笔记里的标准：ROE必须严格大于20%；按最近完整财年净利润÷平均股东权益",
     c.roeOk===null?"待数据":c.roeOk?"已达标":"未达标"));
   const fcf=value(f.r?.fcf),fcfYield=fcf!==null&&f.cap>0?fcf/f.cap*100:null;
   out.push(keyLine("消费股：自由现金流",fcf===null?"—":amount(fcf,2)+"亿美元",
     "经营现金流减资本开支；需结合品牌、渠道、库存和行业周期查看",
     fcf===null?"待数据":fcf>0?"现金流为正":"现金流为负"));
   if(fcfYield!==null)
    out.push(keyLine("消费股：自由现金流收益率",amount(fcfYield,2)+"%",
     "年度自由现金流÷市值；只用于估值比较","估值参考"));
 }else {
   const gr=value(v.revGrowth),margin=value(v.margin),years=value(v.years),target=value(v.forwardLimit),psLimit=value(v.psLimit);
   const future=gr!==null&&margin!==null&&years>0&&f.revenue>0?f.revenue*Math.pow(1+gr/100,years)*margin/100:null;
   const futurePe=f.cap>0&&future>0?f.cap/future:null;
   out.push(keyLine("当前市销率 PS",f.ps===null?"—":amount(f.ps)+"倍","市值÷最近完整年度收入",f.ps===null?"待数据":psLimit===null?"目标未填写":f.ps<=psLimit?"已达标":"未达标"));
   out.push(keyLine("预计未来PE",futurePe===null?"无法计算":amount(futurePe)+"倍",
     "需要自己填写未来年营收增长率、利润率及年限",
     futurePe===null?"待预测":target===null?"目标未填写":futurePe<=target?"已达标":"未达标"));
 }
 return out.join("");
}
function renderDetails(){
 const s=items.find(x=>x.ticker===selected);
 if(!s){$("detail").innerHTML='<div class="empty">点击左侧已加入的股票，查看当前估值、实际财报和目标比较。</div>';return;}
 const f=financial(s),r=f.r||{},fm=r.financialMeta?.fields||{};
 const ttmEnd=fm.ttmEPS?.end||"",annualEnd=fm.eps?.end||"";
 const filed=fm.ttmEPS?.filed||((!ttmEnd||ttmEnd===annualEnd)?(fm.eps?.filed||fm.revenue?.filed):null)||"本期报告提交日期尚未同步";
 const origin=r.priceSource||oneField(s,"price").origin;
 const ptext=r.priceDate||"日期未知";
 const secs=r.financialMeta?.source||"尚未同步到后台SEC财报缓存；公司可能已有公开年报";
 const idx=universe.get(s.ticker);
 const foreign=r.financialError||r.priceError||"";
 const editor=(label,key,tip,def="")=>'<label class="field"><span>'+esc(label)+'</span><input data-field="'+esc(key)+'" value="'+esc(s.inputs?.[key]??def)+'" type="number" step="any" placeholder="'+esc(tip)+'"></label>';
 const model=s.type==="cigar"?editor("个人估算合理价（美元/股）","manualFair","可留空"):
    s.type==="small"?editor("预计营业收入年增速（%）","revGrowth","自行预测")+editor("预计未来净利润率（%）","margin","自行预测")+editor("预测年数","years","3 或 5","3")+editor("可比公司PS上限","psLimit","请参照同行")+editor("未来PE上限","forwardLimit","例：20","20"):"";
 const latest=record(s);
 const html='<div class="detail-title"><div><h2>'+esc(s.name)+' <span class="muted">'+esc(s.ticker)+'</span></h2>'+
  '<div class="small muted">分类：'+esc(TYPE[s.type].name)+' · 股价来源：'+esc(origin)+'</div></div>'+
  '<div class="buttons"><button id="reloadOne" type="button">↻ 更新该股票数据</button><button id="removeOne" type="button" class="danger">移出观察区</button></div></div>'+
  '<div class="datebox"><strong>行情日期：'+esc(ptext)+'</strong><span>公开数据缓存生成（北京时间）：'+esc(chinaTime(cacheDate))+'</span>'+
  '<span>财报截止：'+esc(fm.ttmEPS?.end||fm.eps?.end||fm.revenue?.end||"未知")+' · SEC提交：'+esc(filed)+'</span></div>'+
  '<h3>现在的真实指标</h3><div class="metrics">'+
  cell("最近已取得收盘价",f.p,"美元",ptext)+
  cell("市值",f.cap,"亿美元",f.cap===null?"需要股价及总股数":"股价×披露股数")+
  cell("股票总股数",f.shares,"亿股",period(r,"shares"))+
  cell("TTM PE",f.peTTM,"倍",period(r,"ttmEPS"))+
  cell("TTM稀释EPS",f.eps,"美元",period(r,"ttmEPS"))+
  cell("年度EPS",f.annualEPS,"美元",period(r,"eps"))+
  cell("ROE（年报口径）",f.roe,"%",period(r,"roe"))+
  cell("最近完整财年营业收入",f.revenue,"亿美元",period(r,"revenue"))+
  cell("年度净利润",f.income,"亿美元",period(r,"netIncome"))+
  cell("自由现金流",value(r.fcf),"亿美元",period(r,"fcf"))+
  cell("净资产",f.eq,"亿美元",period(r,"equity"))+
  cell("历史营收增长率",value(r.historicalRevenueGrowth),"%","已发生，不是预测")+
  (s.type==="cigar"?
   cell("现金及等价物",value(r.cash),"亿美元",period(r,"cash"))+
   cell("已披露有息债务估算",value(r.debt),"亿美元",period(r,"debt"))+
   cell("流动资产",value(r.currentAssets),"亿美元",period(r,"currentAssets"))+
   cell("全部负债",value(r.liabilities),"亿美元",period(r,"liabilities"))+
   cell("EBITDA近似值",value(r.ebitda),"亿美元",period(r,"ebitda")):"")+
  '</div><div class="note">数据来源：'+esc(secs)+
  '. 年度EPS、年报ROE、收入和净利润不一定是最近季度或TTM口径。'+
  (foreign?' 最新读取异常：'+esc(foreign):"")+'</div>'+growthPlot(s,f)+burryPlot(s,f)+
  '<h3>'+(s.type==="consumer"?"消费股：估值隐含增长率与ROE":"你的目标与当前比较")+'</h3><div class="compare-list">'+statuses(s,f)+'</div>'+
  (model?'<h3>你设定的预测／目标</h3><p class="small muted">未来增长率、行业估值上限等预测值不会凭空从历史报表推算。</p><div class="editor">'+model+'</div>':'')+
  '<h3>个人观察笔记</h3><textarea id="memo" rows="3" placeholder="记录你看好的原因和需要验证的风险">'+esc(s.inputs?.memo||"")+'</textarea>'+
  '<div class="small muted">任何无法可靠取得的指标都会显示「—」，不会假定为0或编造数据。黄色标线和横向进度条已移除。</div>';
 $("detail").innerHTML=html;
 $("reloadOne").addEventListener("click",()=>refreshOne(s.ticker));
 $("removeOne").addEventListener("click",()=>{
  items=items.filter(x=>x.ticker!==s.ticker);selected=items.find(x=>x.type===currentType)?.ticker||null;persist();render();
 });
 $("detail").querySelectorAll("[data-field]").forEach(el=>el.addEventListener("change",()=>{
  s.inputs[el.dataset.field]=el.value;persist();render();
 }));
 $("memo").addEventListener("change",e=>{s.inputs.memo=e.target.value;persist()});
}
function render(){enforce();renderCategories();renderList();renderDetails()}
function normalizeRows(rows){
 for(const row of rows){
  if(!Array.isArray(row)||!row[0]||!row[1])continue;
  const ticker=String(row[1]).trim().toUpperCase();
  if(!ticker)continue;
  const prev=universe.get(ticker)||{};
  universe.set(ticker,{ticker,name:row[0],alias:prev.alias||"",cik:row[3]||prev.cik||null,exchange:row[2]||""});
 }
 for(const [name,ticker,alias,cik] of FALLBACK){
  const last=universe.get(ticker)||{};
  universe.set(ticker,{ticker,name:last.name||name,alias,cik:last.cik||cik,exchange:last.exchange||""});
 }
}
async function getData(file){
 // Prefer the version actually published alongside this page. GitHub's raw
 // cache can briefly lag the successful Pages deployment after a refresh.
 const urls=[file+"?v="+Date.now(),BASE+file+"?v="+Date.now()];
 for(const url of urls){try{const r=await fetch(url,{cache:"no-store"});if(r.ok)return await r.json()}catch{}}
 throw Error("数据文件获取失败："+file);
}
async function init(){
 items=read();normalizeRows([]);
 render();
 const results=await Promise.allSettled([getData("fundamentals.json"),getData("symbols.json")]);
 if(results[0].status==="fulfilled"){
  const data=results[0].value;cacheDate=data.updatedAt||"";
  for(const [ticker,r] of Object.entries(data.stocks||{}))stocks.set(ticker.toUpperCase(),r);
  cacheCount=stocks.size;hasLoaded=true;
  $("dataStatus").textContent="已读取 "+cacheCount+"只自动行情/财报缓存；生成于 "+chinaTime(cacheDate)+
  "。没有完整数据的股票可单独查询。";
 }else $("dataStatus").textContent="行情缓存未能加载；正在使用手填数据和按需查询。";
 if(results[1].status==="fulfilled"){
  normalizeRows(results[1].value.rows||[]);
  $("universeStatus").textContent="可搜索 "+universe.size.toLocaleString()+" 个股票代码，名称优先；数据覆盖不等于代码覆盖。";
 }else $("universeStatus").textContent="当前使用常用股票名称目录，完整SEC列表暂无响应。";
 render();if(picked)showSelection();
}
function resultsFor(q){
 const raw=q.trim();q=raw.toLowerCase();if(!q)return [];
 const all=Array.from(universe.values());
 // If the user types an exact upper-case ticker (e.g. AMD), resolve that
 // ticker before fuzzy company-name hits like Amdocs (DOX). Company names
 // such as Uber still take the regular name-first path.
 const exact=universe.get(raw.toUpperCase());
 if(exact&&raw===raw.toUpperCase()&&/^[A-Z0-9.^-]{1,10}$/.test(raw)){
  return [exact,...all.filter(x=>x.ticker!==exact.ticker&&
   ((x.name+" "+x.alias).toLowerCase().includes(q)||x.ticker.toLowerCase().includes(q)))].slice(0,10);
 }
 const name=all.filter(x=>(x.name+" "+x.alias).toLowerCase().includes(q));
 if(name.length)return name.sort((a,b)=>Number(b.name.toLowerCase().startsWith(q))-Number(a.name.toLowerCase().startsWith(q))).slice(0,10);
 let code=all.filter(x=>x.ticker.toLowerCase().includes(q));
 if(q==="ndrs")code=[universe.get("NRDS"),...code].filter(Boolean);
 return code.slice(0,10);
}
function drawResults(){
 const q=$("query").value,list=resultsFor(q);
 $("suggestions").hidden=!list.length;
 $("suggestions").innerHTML=list.map(x=>{
  const d=stocks.get(x.ticker),cap=d?.price>0&&d?.shares>0?d.price*d.shares:null;
  return '<button data-ticker="'+esc(x.ticker)+'"><span>'+esc(x.name)+' <small>'+esc(x.alias||"")+'</small></span>'+
   '<strong>'+esc(x.ticker)+'</strong><small>'+(cap===null?"市值待查询":amount(cap,0)+"亿美元")+
   (d?.priceDate?" · "+esc(d.priceDate):"")+'</small></button>';
 }).join("");
 $("suggestions").querySelectorAll("button").forEach(btn=>btn.addEventListener("click",()=>{
  const target=universe.get(btn.dataset.ticker);if(target)chooseSymbol(target);
 }));
}
function showSelection(){
 if(!picked)return;
 const d=stocks.get(picked.ticker),cap=d?.price>0&&d?.shares>0?d.price*d.shares:
  value(d?.marketCap)>0?value(d.marketCap):null;
 $("selection").innerHTML='<strong>'+esc(picked.name)+' · '+esc(picked.ticker)+'</strong><div>股价：'+
 (d?.price>0?"$"+amount(d.price):"等待查询")+" · 日期："+esc(d?.priceDate||"待查询")+
 " · 市值："+(cap===null?"待查询":amount(cap,0)+"亿美元")+
 ' · TTM PE：'+(d?.ttmEPS>0&&d?.price>0?amount(d.price/d.ttmEPS)+"倍":"待财报")+'</div>';
 if(cap!==null&&cap>LIMIT){$("newType").value="giant";$("newType").disabled=true;
   $("selection").innerHTML+="<small>市值＞5000亿美元，自动归入巨无霸。</small>";}
 else {$("newType").disabled=false;if($("newType").value==="giant")$("newType").value="growth";
   $("selection").innerHTML+="<small>"+(cap===null?"市值暂无法核实；可以先作为非巨无霸观察。":"未超过5000亿美元，可选择其他类别。")+"</small>";}
 if(!d?.financialMeta)$("selection").innerHTML+="<small>尚无已同步的SEC年报缓存；临时公开接口查询可能失败，并不表示该公司没有财报。</small>";
 $("addStock").disabled=false;
}
async function chooseWithData(t){
 choose(t);await loadOnDemand(t.ticker);if(picked?.ticker===t.ticker)showSelection();
}
function mergeRecords(a,b){
 const out={...(a||{})};
 for(const [k,v] of Object.entries(b||{})){
  if(v!==null&&v!==undefined&&v!=="")out[k]=v;
 }
 if(a?.annualHistory||b?.annualHistory)
  out.annualHistory=mergeAnnualHistory(a?.annualHistory,b?.annualHistory);
 if(a?.financialMeta?.fields||b?.financialMeta?.fields){
  out.financialMeta={...(a?.financialMeta||{}),...(b?.financialMeta||{}),fields:{...(a?.financialMeta?.fields||{}),...(b?.financialMeta?.fields||{})}};
 }
 return out;
}
function chooseFact(facts,tags,unit,kind="annual"){
 let best=null;
 for(const tag of tags){
  const entries=facts?.["us-gaap"]?.[tag]?.units?.[unit]||facts?.dei?.[tag]?.units?.[unit]||[];
  for(const e of entries){
   if(!["10-K","10-K/A","10-Q","10-Q/A"].includes(e.form)||!e.end)continue;
   const v=value(e.val);if(v===null)continue;
   const days=e.start?(Date.parse(e.end)-Date.parse(e.start))/86400000:null;
   const pass=kind==="annual"?e.form.startsWith("10-K")&&days>=330&&days<=390:
      kind==="instant"?!e.start:
      e.form.startsWith("10-Q")&&days>=65&&days<=115;
   if(!pass)continue;
   if(!best||e.end>best.end||(e.end===best.end&&(e.filed||"")>(best.filed||"")))
    best={value:v,end:e.end,filed:e.filed||"",start:e.start||null,tag};
  }
  if(best)break;
 }
 return best;
}
function ttmFromFacts(facts){
 const entries=[];
 for(const tag of ["EarningsPerShareDiluted","EarningsPerShareBasic"]){
  for(const x of facts?.["us-gaap"]?.[tag]?.units?.["USD/shares"]||[]){
   const v=value(x.val);
   if(v===null||!x.start||!x.end||!["10-K","10-K/A","10-Q","10-Q/A"].includes(x.form))continue;
   const days=(Date.parse(x.end)-Date.parse(x.start))/86400000;
   if(days>=65&&days<=390)entries.push({...x,value:v,days,tag});
  }
 }
 const fy=entries.filter(e=>e.form.startsWith("10-K")&&e.days>=330)
 .sort((a,b)=>b.end.localeCompare(a.end)||(b.filed||"").localeCompare(a.filed||""))[0];
 if(!fy)return null;
 const cur=entries.filter(e=>e.form.startsWith("10-Q")&&e.end>fy.end&&
    (Date.parse(e.end)-Date.parse(fy.end))/86400000<=320&&
    Math.abs((Date.parse(e.start)-Date.parse(fy.end))/86400000)<=12)
 .sort((a,b)=>b.end.localeCompare(a.end)||b.days-a.days)[0];
 if(!cur)return {value:fy.value,end:fy.end,filed:fy.filed||"",method:"最新完整财政年度10-K"};
 const prior=entries.filter(e=>e.form.startsWith("10-Q")&&e.end<=fy.end&&
  Math.abs(e.days-cur.days)<=14&&Math.abs((Date.parse(e.start)-Date.parse(fy.start))/86400000)<=12)
 .sort((a,b)=>b.end.localeCompare(a.end))[0];
 if(!prior)return null;
 return {value:fy.value+cur.value-prior.value,end:cur.end,filed:cur.filed||"",
 method:"完整财年EPS＋当前年累计EPS－上年同段累计EPS（近似）"};
}
function annualSeriesFromFacts(facts,tags,unit,divisor=1){
 const byEnd=new Map();
 for(let priority=0;priority<tags.length;priority++){
  const tag=tags[priority];
  for(const e of facts?.["us-gaap"]?.[tag]?.units?.[unit]||[]){
   const v=value(e.val);
   if(v===null||!e.start||!e.end||!["10-K","10-K/A"].includes(e.form))continue;
   const days=(Date.parse(e.end)-Date.parse(e.start))/86400000;
   if(days<330||days>390)continue;
   const prior=byEnd.get(e.end);
   const filed=e.filed||"";
   if(!prior||filed>prior.filed||(filed===prior.filed&&priority<prior.priority))
    byEnd.set(e.end,{end:e.end,value:Math.round(v/divisor*100000)/100000,filed,priority});
  }
 }
 return [...byEnd.values()].sort((a,b)=>b.end.localeCompare(a.end))
  .slice(0,6).map(({end,value})=>({end,value}));
}
function fromSecFacts(facts,cik){
 const specs={
  eps:[["EarningsPerShareDiluted","EarningsPerShareBasic"],"USD/shares","annual"],
  roe:null,
  revenue:[["RevenueFromContractWithCustomerExcludingAssessedTax","RevenueFromContractWithCustomerIncludingAssessedTax","Revenues","SalesRevenueNet"],"USD","annual"],
  netIncome:[["NetIncomeLoss","ProfitLoss"],"USD","annual"],
  equity:[["StockholdersEquity","StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],"USD","instant"],
  cash:[["CashAndCashEquivalentsAtCarryingValue"],"USD","instant"],
  dividend:[["CommonStockDividendsPerShareDeclared"],"USD/shares","annual"],
  liabilities:[["Liabilities"],"USD","instant"],
  currentAssets:[["AssetsCurrent"],"USD","instant"],
  opIncome:[["OperatingIncomeLoss"],"USD","annual"],
  depreciation:[["DepreciationDepletionAndAmortization","DepreciationDepletionAndAmortizationPropertyPlantAndEquipment"],"USD","annual"],
  longDebt:[["LongTermDebtNoncurrent","LongTermDebt"],"USD","instant"],
  currentDebt:[["LongTermDebtCurrent","LongTermDebtAndCapitalLeaseObligationsCurrent"],"USD","instant"],
  shortDebt:[["ShortTermBorrowings"],"USD","instant"],
  cfo:[["NetCashProvidedByUsedInOperatingActivities"],"USD","annual"],
  capex:[["PaymentsToAcquirePropertyPlantAndEquipment"],"USD","annual"],
  shares:[["EntityCommonStockSharesOutstanding","CommonStockSharesOutstanding"],"shares","instant"]
 };
 const out={},meta={};
 for(const [key,req] of Object.entries(specs)){
  if(!req)continue;const item=chooseFact(facts,...req);
  if(!item)continue;
  out[key]=key==="eps"||key==="dividend"?item.value:item.value/1e8;
  meta[key]={end:item.end,filed:item.filed,tag:item.tag};
 }
 if(Number.isFinite(out.cfo)&&Number.isFinite(out.capex))out.fcf=out.cfo-Math.abs(out.capex);
 if(Number.isFinite(out.opIncome)&&Number.isFinite(out.depreciation)&&meta.opIncome?.end===meta.depreciation?.end){
  out.ebitda=out.opIncome+out.depreciation;
  meta.ebitda={end:meta.opIncome.end,note:"营业利润＋折旧摊销近似值；非调整后EBITDA"};
 }
 const debtKeys=["longDebt","currentDebt","shortDebt"].filter(k=>Number.isFinite(out[k]));
 if(debtKeys.length){
  const cur=meta.longDebt?.tag==="LongTermDebt"?0:(out.currentDebt||0);
  out.debt=(out.longDebt||0)+cur+(out.shortDebt||0);
  meta.debt={end:meta.longDebt?.end||meta.currentDebt?.end||meta.shortDebt?.end||"",note:"已报告的有息债务合计；部分租赁负债可能遗漏"};
 }
 if(Number.isFinite(out.netIncome)&&out.equity>0){out.roe=out.netIncome/out.equity*100;meta.roe={end:meta.netIncome?.end||""};}
 const ttm=ttmFromFacts(facts);
 if(ttm){out.ttmEPS=ttm.value;meta.ttmEPS={end:ttm.end,filed:ttm.filed,method:ttm.method};}
 const annualHistory={
  netIncome:annualSeriesFromFacts(facts,["NetIncomeLoss","NetIncomeLossAvailableToCommonStockholdersBasic","ProfitLoss"],"USD",1e8),
  revenue:annualSeriesFromFacts(facts,["RevenueFromContractWithCustomerExcludingAssessedTax","RevenueFromContractWithCustomerIncludingAssessedTax","Revenues","SalesRevenueNet"],"USD",1e8),
  eps:annualSeriesFromFacts(facts,["EarningsPerShareDiluted","EarningsPerShareBasic"],"USD/shares")
 };
 if(Object.values(annualHistory).some(v=>v.length))out.annualHistory=annualHistory;
 out.financialMeta={source:"SEC EDGAR XBRL companyfacts",cik,fields:meta,updatedAt:new Date().toISOString()};
 return out;
}
async function jsonFetch(url){
 const r=await fetch(url,{cache:"no-store"});if(!r.ok)throw Error("HTTP "+r.status);return r.json();
}
// A GitHub Pages page cannot call SEC's CORS-disabled API reliably. On a
// manual refresh, prefer the dated file produced by the scheduled GitHub
// Actions backend; only attempt best-effort browser fetch for uncached stocks.
async function refreshOne(ticker){
 $("dataStatus").textContent=ticker+" 正在重读后台已发布的财报和行情…";
 try{
  const latest=await getData("fundamentals.json"),next=latest.stocks?.[ticker];
  if(next){
   const old=stocks.get(ticker);
   const newest=old?.priceDate&&next.priceDate&&old.priceDate>next.priceDate?
    mergeRecords(next,old):mergeRecords(old,next);
   stocks.set(ticker,newest);
   cacheDate=latest.updatedAt||cacheDate;
   cacheCount=Math.max(cacheCount,Object.keys(latest.stocks||{}).length);
   render();
   if(newest.price>0&&newest.financialMeta){
    $("dataStatus").textContent=ticker+" 已读取最新已发布缓存（北京时间 "+chinaTime(cacheDate)+"）；行情不是盘中实时价。";
    return;
   }
  }
 }catch{}
 await loadOnDemand(ticker,true);
}
async function loadOnDemand(ticker,force=false){
 ticker=ticker.toUpperCase();
 const exists=stocks.get(ticker);
 if(!force&&exists?.price>0&&exists?.financialMeta)return;
 if(queryPromises.has(ticker))return queryPromises.get(ticker);
 const promise=(async()=>{
  $("dataStatus").textContent="正在查询 "+ticker+" 最新可取得的收盘价与财报…";
  const sym=universe.get(ticker)||{},old=stocks.get(ticker)||{},fresh={ticker,name:sym.name||old.name||ticker};
  let got=0,errors=[];
  const tasks=[];
  if(force||!old.price){
   tasks.push((async()=>{
     const target=encodeURIComponent(ticker.replace(".","-"));
     for(const url of ["https://proxy.cors.dev/https://query1.finance.yahoo.com/v8/finance/chart/"+target+"?range=1y&interval=1d",
      "https://query1.finance.yahoo.com/v8/finance/chart/"+target+"?range=1y&interval=1d"]){
      try{
       const j=await jsonFetch(url),r=j.chart?.result?.[0];if(!r)continue;
       const quotes=r.indicators?.quote?.[0]?.close||[],times=r.timestamp||[];
       const pairs=times.map((t,i)=>({t,p:value(quotes[i])})).filter(x=>x.p>0);
       if(!pairs.length)continue;
       const last=pairs.at(-1);fresh.price=last.p;
       fresh.priceDate=new Date(last.t*1000).toLocaleDateString("sv-SE",{timeZone:"America/New_York"});
       fresh.priceSource="Yahoo chart日收盘（公开接口，可能延迟）";
       if(pairs.length>=20)fresh.priceHistory=pairs.slice(-260).map(x=>[
        new Date(x.t*1000).toLocaleDateString("sv-SE",{timeZone:"America/New_York"}),
        Math.round(x.p*10000)/10000]);
       const outstanding=value(r.meta?.sharesOutstanding);
       if(outstanding>0)fresh.shares=outstanding/1e8;
       got++;break;
      }catch(e){errors.push("股价："+String(e.message).slice(0,70));}
     }
   })());
  }
  if(force||!old.financialMeta){
   tasks.push((async()=>{
     const cik=sym.cik||old.financialMeta?.cik;
     if(!cik){errors.push("SEC缺少CIK映射");return;}
     const path="https://data.sec.gov/api/xbrl/companyfacts/CIK"+String(cik).padStart(10,"0")+".json";
     for(const url of ["https://proxy.cors.dev/"+path,path]){
      try{const j=await jsonFetch(url);
       Object.assign(fresh,fromSecFacts(j.facts||{},cik));got++;break;
      }catch(e){errors.push("财报："+String(e.message).slice(0,70));}
     }
   })());
  }
  await Promise.allSettled(tasks);
  if(fresh.priceDate&&old.priceDate&&fresh.priceDate<old.priceDate){delete fresh.price;delete fresh.priceDate;delete fresh.priceSource;}
  const combined=mergeRecords(old,fresh);
  if(got){stocks.set(ticker,combined);}
  else if(!exists)stocks.set(ticker,{...old,name:sym.name||ticker,priceError:errors.join("；")});
  if(errors.length)stocks.get(ticker).fetchWarning=errors.join("；");
  enforce();$("dataStatus").textContent=ticker+" 查询结束 · "+(got?"已取得部分/全部新数据":"公开接口暂不可用")+
   "。自动缓存股票总数："+cacheCount+"。";
  render();if(picked?.ticker===ticker)showSelection();
 })().finally(()=>queryPromises.delete(ticker));
 queryPromises.set(ticker,promise);return promise;
}
function chooseSymbol(t){
 picked=t;$("query").value=t.name;$("suggestions").hidden=true;
 $("addStock").disabled=true;
 $("selection").textContent="正在加载 "+t.ticker+"…";
 showSelection();
 if(!stocks.get(t.ticker)?.financialMeta||!stocks.get(t.ticker)?.price){$("addStock").disabled=true;loadOnDemand(t.ticker).finally(()=>{if(picked?.ticker===t.ticker){showSelection();$("addStock").disabled=false;}});}
}
$("query").addEventListener("input",()=>{picked=null;drawResults();$("selection").textContent="请从候选结果中点击股票。"});
$("query").addEventListener("keydown",e=>{
 if(e.key==="Enter"){const a=resultsFor($("query").value);if(a.length){e.preventDefault();chooseSymbol(a[0]);}}
 if(e.key==="Escape")$("suggestions").hidden=true;
});
document.addEventListener("click",e=>{if(!e.target.closest(".searchblock"))$("suggestions").hidden=true;});
$("addStock").addEventListener("click",()=>{
 if(!picked)return;
 const ticker=picked.ticker,r=stocks.get(ticker),cap=r?.price>0&&r?.shares>0?r.price*r.shares:null;
 const type=cap!==null&&cap>LIMIT?"giant":$("newType").value==="giant"?"growth":$("newType").value;
 let s=items.find(x=>x.ticker===ticker);
 if(!s){s={ticker,id:ticker,name:picked.name,type,inputs:{},createdAt:new Date().toISOString()};items.unshift(s);}
 else s.type=type;
 selected=ticker;currentType=type;persist();render();
});
$("export").addEventListener("click",()=>{
 const url=URL.createObjectURL(new Blob([JSON.stringify({format:"us-stock-watch-categories-v1",items,exportedAt:new Date().toISOString()},null,2)],{type:"application/json"}));
 const a=document.createElement("a");a.href=url;a.download="us-stock-watchlist.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),800);
});
$("import").addEventListener("click",()=>$("importFile").click());
$("importFile").addEventListener("change",async e=>{
 const file=e.target.files?.[0];if(!file)return;
 try{
  if(file.size>3e6)throw Error("文件超过3MB");
  const data=JSON.parse(await file.text()),arr=Array.isArray(data)?data:data.items;
  if(!Array.isArray(arr))throw Error("无法识别观察区列表");
  let count=0;
  for(const row of arr.slice(0,300)){
   if(!row||!row.ticker||!row.name)continue;
   const ticker=String(row.ticker).toUpperCase();
   if(items.some(x=>x.ticker===ticker))continue;
   const type=row.type==="white"?"giant":TYPE[row.type]?row.type:"growth";
   items.push({id:ticker,ticker,name:row.name,type,inputs:row.inputs||{}});count++;
  }
  persist();render();$("saveInfo").textContent="成功导入 "+count+" 只，不覆盖已有研究记录。";
 }catch(error){$("saveInfo").textContent="导入失败："+error.message;}
 e.target.value="";
});
$("newType").addEventListener("change",showSelection);
document.addEventListener("market:refresh",async event=>{
 const snapshot=event.detail?.us;
 if(snapshot&&snapshot.stocks){
  cacheDate=snapshot.updatedAt||cacheDate;
  for(const [ticker,rec] of Object.entries(snapshot.stocks)){
   const old=stocks.get(ticker.toUpperCase());
   const oldDay=old?.priceDate||"";
   if(!old||!oldDay||String(rec.priceDate||"")>=oldDay)stocks.set(ticker.toUpperCase(),mergeRecords(old,rec));
   else stocks.set(ticker.toUpperCase(),mergeRecords(rec,old));
  }
  cacheCount=stocks.size;
  $("dataStatus").textContent="已重新读取美股公开缓存："+cacheCount+"只 · 数据文件生成："+cacheDate;
  render();if(picked)showSelection();
 }else await init();
 const active=selected||picked?.ticker;
 if(active)await loadOnDemand(active,true);
});
init();
})();
