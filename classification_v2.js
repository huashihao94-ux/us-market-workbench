/* Classification v2: quantitative US stock pool, four categories.
   Requires workbench.html and auto_data.js loaded before this file. */
(function(){
"use strict";
const LIMIT=5000; // 亿美元 = $500 billion
delete TYPES.white;
TYPES.giant={name:"巨无霸",desc:"市值＞5000亿美元｜TTM PE≤20优选，≤25可接受"};
TYPES.growth={name:"优秀成长股",desc:"盈利成长｜PE与未来盈利增速"};
TYPES.cigar={name:"烟蒂股",desc:"低估值｜安全边际与地板价"};
TYPES.small={name:"小市值公司",desc:"尚未盈利／早期公司｜PS＋未来PE"};
FIELDS_BY_TYPE.giant=["price","shares","ttmEPS","eps","revenue","roe","fcf","equity","cash","liabilities","dividend","peLimit","asof","source"];
FIELDS_BY_TYPE.growth=["price","eps","growth","roe","shares","revenue","revGrowth","margin","years","growthMin","forwardLimit","asof","source"];
FIELDS_BY_TYPE.small=["price","shares","revenue","revGrowth","margin","years","psLimit","forwardLimit","asof","source"];
FIELD_DEFS.push(["ttmEPS","最近12个月稀释EPS TTM（$/股）","number"]);
FIELD_DEFS.push(["psLimit","可比公司参考PS上限（倍）","number"]);
const extraStyle=document.createElement("style");
extraStyle.textContent=".marketcap{padding:10px 12px;border:1px solid #344e68;background:#0c1d30;border-radius:9px;margin-top:8px;color:#d6eaf7}.marketcap strong{color:#62d8e7}.category b{font-size:20px}.mini-info{font-size:12px;color:#aac0d5;padding-top:5px}.floor-note{font-size:12px;color:#9bacbf}";
document.head.appendChild(extraStyle);
const select=document.getElementById("newType");
select.replaceChildren(...Object.keys(TYPES).map(type=>new Option(TYPES[type].name,type)));
select.value="growth";
const marketInfo=document.createElement("div");
marketInfo.id="searchMarketCap";marketInfo.className="marketcap";
marketInfo.textContent="请先输入股票名称并点击候选代码。系统会先检查市值，再自动判断是否属于巨无霸。";
document.getElementById("chosen").after(marketInfo);
const oldDefaults=defaults;
defaults=function(type){
 const v=oldDefaults(type);
 v.moat=false;v.bank=false;v.lossMaking=false;
 if(type==="giant"){v.peLimit="25";v.growth="";v.ttmEPS="";}
 if(type==="small"){v.psLimit="";v.forwardLimit="20";v.revGrowth="";v.margin="";}
 return v;
};
function getNumber(x){const n=Number(x);return x===undefined||x===null||x===""||!Number.isFinite(n)?null:n}
function capital(stock){
 const p=getNumber(stock?.inputs?.price),s=getNumber(stock?.inputs?.shares);
 return p>0&&s>0?p*s:null;
}
const oldCalc=calc;
calc=function(stock){
 if(!stock)return {status:"wait",tests:[],missing:[],failed:[],heading:"",special:""};
 if(stock.type==="white")stock.type="giant";
 if(stock.type!=="giant"&&stock.type!=="small")return oldCalc(stock);
 const v=stock.inputs||{},cap=capital(stock),price=getNumber(v.price),shares=getNumber(v.shares),eps=getNumber(v.ttmEPS);
 const annual=getNumber(v.eps),revenue=getNumber(v.revenue),margin=getNumber(v.margin),
 g=getNumber(v.revGrowth),years=getNumber(v.years);
 const peTTM=price>0&&eps>0?price/eps:null;
 const ps=cap>0&&revenue>0?cap/revenue:null;
 const futureRevenue=revenue>0&&g!==null&&years>0&&years<=15?revenue*Math.pow(1+g/100,years):null;
 const futureProfit=futureRevenue>0&&margin>0?futureRevenue*margin/100:null;
 const futurePE=cap>0&&futureProfit>0?cap/futureProfit:null;
 const tests=[];
 function test(label,actual,target,dir,unit,strict=false){
   const known=actual!==null&&target!==null&&Number.isFinite(actual)&&Number.isFinite(target)&&target>0;
   const pass=known&&(dir==="lower"?actual<=target:(strict?actual>target:actual>=target));
   tests.push({label,actual,target,dir,unit,known,pass,needed:true});
 }
 let heading,special;
 if(stock.type==="giant"){
   heading="巨无霸：市值门槛＋TTM市盈率";
   test("公司市值必须超过5000亿美元",cap,LIMIT,"higher","亿美元",true);
   test("TTM PE（最近12个月EPS）不高于25倍",peTTM,25,"lower","倍");
   special="市值＞5000亿美元自动归类；TTM PE≤20倍为优选，20～25倍为弹性观察区，＞25倍不达标。若TTM EPS≤0或缺失，PE无法判断，不使用年度EPS替代。";
 }else{
   heading="小市值公司：PS及未来盈利预测";
   test("当前PS不高于可比公司上限",ps,getNumber(v.psLimit),"lower","倍");
   test("按当前市值计算的未来PE不高于目标",futurePE,getNumber(v.forwardLimit),"lower","倍");
   special="根据笔记：PS＝市值÷营业收入；预测未来收入＝当前收入×(1+预测增速)^年数；预测未来利润＝未来收入×净利润率，未来PE＝当前市值÷预测未来利润。PS上限应参照同行，不能自动假定固定倍数。";
 }
 const missing=tests.filter(t=>!t.known),failed=tests.filter(t=>t.known&&!t.pass);
 return {p:price,eps:annual,cap,pe:peTTM,pb:null,yieldPct:null,roe:null,
 ev:null,evRatio:null,fcfYield:null,ncav:null,evFair:null,fcfFair:null,
 fair:null,mos:null,ps,projRevenue:futureRevenue,projProfit:futureProfit,
 forwardPE:futurePE,tests,status:missing.length?"wait":failed.length?"fail":"pass",missing,failed,heading,special};
};
for(const item of items){
 if(item.type==="white"){item.type="giant";item.inputs.peLimit="25";}
 if(item.type==="growth"&&item.inputs?.lossMaking){item.type="small";item.inputs.psLimit="";}
 if(item.type==="giant")item.inputs.peLimit="25";
 delete item.inputs.moat;delete item.inputs.bank;
}
if(!TYPES[selectedType])selectedType="giant";
if(items.length&&!items.some(item=>item.id===selectedId&&item.type===selectedType)){
 const first=items.find(x=>x.type===selectedType);selectedId=first?.id||null;
}
saveStore();
const formatCap=cap=>cap===null?"无法核验":"约 "+fmt(cap,0)+" 亿美元（"+fmt(cap/10000,2)+"万亿美元）";
let factsCache={stocks:{},updatedAt:null};
let activeCandidate=null, candidateInfo=null, requestId=0;
async function loadCache(){
 try{const r=await fetch("https://raw.githubusercontent.com/huashihao94-ux/us-market-workbench/main/fundamentals.json?nocache="+Date.now(),{cache:"no-store"});if(!r.ok)throw new Error("GitHub:"+r.status);factsCache=await r.json()}catch{}
}
function candidateCached(ticker){return factsCache.stocks?.[ticker.toUpperCase()]||null;}
function showLookup(s,c,origin){
 const cap=c?.cap??null;
 const stale=origin?" · 来源："+origin:"";
 const d=c?.record||{};
 const meta=d.financialMeta?.fields||{};
 const fiscal=meta.ttmEPS?.end||meta.eps?.end||meta.revenue?.end||d.ttmDate||null;
 const priceDate=d.priceDate||"尚未获取";
 const reported=meta.eps?.filed||meta.revenue?.filed||null;
 marketInfo.innerHTML="<strong>"+esc(s.name)+"（"+esc(s.ticker)+"）</strong> · 总市值："+esc(formatCap(cap))+esc(stale)+
 "<div class='mini-info'>股价："+(typeof d.price==="number"?"$"+fmt(d.price,2):"暂无")+" · 美股收盘日期："+esc(priceDate)+
 " · TTM EPS："+(typeof d.ttmEPS==="number"?fmt(d.ttmEPS,2)+"美元":"暂无")+" · 财报截止："+esc(fiscal||"暂无")+ 
 (reported?" · SEC提交："+esc(reported):"")+"</div>";
 if(cap!==null&&cap>LIMIT){
   select.value="giant";select.disabled=true;
   marketInfo.innerHTML+="<div class='mini-info'>超过5000亿美元：自动归入「巨无霸」，无需手动选择分类。</div>";
 }else{
   select.disabled=false;
   if(select.value==="giant")select.value="growth";
   marketInfo.innerHTML+=cap!==null?"<div class='mini-info'>未超过5000亿美元：请选择成长股、烟蒂股或小市值公司。</div>":
   "<div class='mini-info'>缺少股价或股数，市值暂时无法确认；可先选择观察区，之后补充数据再核验。</div>";
 }
}
function chooseShares(facts){
 const all=[];
 for(const tax of ["dei","us-gaap"]){
  const tags=tax==="dei"?["EntityCommonStockSharesOutstanding"]:["CommonStockSharesOutstanding"];
  for(const tag of tags){
   const rows=facts?.[tax]?.[tag]?.units?.shares||[];
   for(const rec of rows){
    const value=getNumber(rec.val);
    if(value>0&&rec.end&&["10-K","10-Q","10-K/A","10-Q/A"].includes(rec.form)&&!rec.start)all.push({end:rec.end,filed:rec.filed||"",value});
   }
  }
 }
 if(!all.length)return null;
 all.sort((a,b)=>b.end.localeCompare(a.end)||b.filed.localeCompare(a.filed));
 // Shares older than 18 months are not suitable for an automatic market-cap decision.
 if(Date.now()-Date.parse(all[0].end)>550*86400000)return null;
 return all[0].value/1e8;
}
function estimateTTM(facts){
 const rows=[];
 for(const tag of ["EarningsPerShareDiluted","EarningsPerShareBasic"]){
  for(const x of facts?.["us-gaap"]?.[tag]?.units?.["USD/shares"]||[]){
   const val=getNumber(x.val); if(val===null||!x.start||!x.end||!["10-Q","10-K","10-Q/A","10-K/A"].includes(x.form))continue;
   const days=(Date.parse(x.end)-Date.parse(x.start))/86400000;
   if(days<65||days>390)continue;
   rows.push({val,start:x.start,end:x.end,days,form:x.form,tag,filed:x.filed||""});
  }
 }
 const fy=rows.filter(x=>x.form.startsWith("10-K")&&x.days>330).sort((a,b)=>b.end.localeCompare(a.end)||b.filed.localeCompare(a.filed))[0];
 if(!fy)return null;
 const latest=rows.filter(x=>x.form.startsWith("10-Q")&&x.end>fy.end&&x.end<=new Date(Date.parse(fy.end)+320*86400000).toISOString().slice(0,10)&&Math.abs((Date.parse(x.start)-Date.parse(fy.end))/86400000)<=12)
  .sort((a,b)=>b.end.localeCompare(a.end)||b.days-a.days)[0];
 if(!latest)return {value:fy.val,end:fy.end,source:"10-K最新12个月"};
 const prior=rows.filter(x=>x.form.startsWith("10-Q")&&x.end<=fy.end&&Math.abs(x.days-latest.days)<15&&Math.abs((Date.parse(x.start)-Date.parse(fy.start))/86400000)<=12)
  .sort((a,b)=>b.end.localeCompare(a.end))[0];
 return prior?{value:fy.val+latest.val-prior.val,end:latest.end,source:"FY+当前YTD−上年YTD"}:null;
}
async function queryOnDemand(s){
 const cached=candidateCached(s.ticker);
 let record=cached?{...cached}:{ticker:s.ticker,name:s.name};
 if(record.price>0&&record.shares>0)return {cap:record.price*record.shares,record,origin:"已跟踪的缓存"};
 const ticker=encodeURIComponent(s.ticker.replace(".","-"));
 if(!(record.price>0)){
  try{
   const url="https://proxy.cors.dev/https://query1.finance.yahoo.com/v8/finance/chart/"+ticker+"?range=5d&interval=1d";
   const response=await fetch(url);
   if(!response.ok)throw Error("HTTP "+response.status);
   const j=await response.json(),r=j?.chart?.result?.[0],cl=r?.indicators?.quote?.[0]?.close||[];
   const last=cl.filter(x=>typeof x==="number"&&x>0).at(-1);
   if(last>0){record.price=last;record.priceSource="Yahoo Finance via public proxy (on-demand)";record.priceDate=new Date((r.timestamp||[]).at(-1)*1000).toISOString().slice(0,10);}
   const sh=getNumber(r?.meta?.sharesOutstanding);
   if(sh>0&&!record.shares)record.shares=sh/1e8;
  }catch{}
 }
 if(!(record.shares>0)||!record.ttmEPS){
  let cik=s.cik;
  if(!cik){const match=universe.find(u=>u.ticker===s.ticker);cik=match?.cik}
  if(cik){
   try{
    const url="https://proxy.cors.dev/https://data.sec.gov/api/xbrl/companyfacts/CIK"+String(cik).padStart(10,"0")+".json";
    const response=await fetch(url);
    if(!response.ok)throw Error("HTTP "+response.status);
    const j=await response.json(),facts=j.facts||{};
    if(!(record.shares>0))record.shares=chooseShares(facts);
    if(!record.ttmEPS){const x=estimateTTM(facts);if(x){record.ttmEPS=x.value;record.ttmDate=x.end;}}
   }catch{}
  }
 }
 const cap=record.price>0&&record.shares>0?record.price*record.shares:null;
 return {cap,record,origin:"即查的公开行情/SEC财报（需复核）"};
}
const priorPick=pick;
pick=function(s){
 priorPick(s);activeCandidate=s;candidateInfo=null;const seq=++requestId;
 const cached=candidateCached(s.ticker);
 if(cached?.price>0&&cached?.shares>0){
  candidateInfo={cap:cached.price*cached.shares,record:cached,origin:"自动缓存"};
  showLookup(s,candidateInfo,candidateInfo.origin);return;
 }
 marketInfo.textContent="正在核对 "+s.ticker+" 的股价、股数及市值…";
 document.getElementById("add").disabled=true;
 queryOnDemand(s).then(result=>{
   if(seq!==requestId)return;
   candidateInfo=result;showLookup(s,result,result.origin);
 }).finally(()=>{if(seq===requestId)document.getElementById("add").disabled=false});
};
const oldSuggestions=drawSuggestions;
drawSuggestions=function(){
 oldSuggestions();
 document.querySelectorAll("#candidates .candidate").forEach(b=>{
  const ticker=b.querySelector("strong")?.textContent||"";
  const row=candidateCached(ticker);
  if(row?.price>0&&row?.shares>0){const info=document.createElement("small");info.textContent=" · 市值"+fmt(row.price*row.shares,0)+"亿美元 · 收盘"+(row.priceDate||"日期未知");b.appendChild(info);}
 });
};
const addBtn=document.getElementById("add");
addBtn.addEventListener("click",()=>{
 const s=byId();if(!s||!candidateInfo||!activeCandidate||s.ticker!==activeCandidate.ticker)return;
 if(candidateInfo.cap!==null&&candidateInfo.cap>LIMIT)s.type="giant";
 const d=candidateInfo.record||{};
 s.inputs=s.inputs||defaults(s.type);
 for(const key of ["price","shares","ttmEPS"]){
   if(getNumber(d[key])!==null&&(!s.inputs[key]||s.autoFields?.includes(key))){
     s.inputs[key]=String(d[key]);s.autoFields=Array.from(new Set([...(s.autoFields||[]),key]));
   }
 }
 s.lookupCap=candidateInfo.cap;s.lookupData=d;
 if(s.type==="giant")s.inputs.peLimit="25";
 selectedType=s.type;saveStore();render();
});
const prevDetail=drawDetail;
drawDetail=function(){
 prevDetail();
 const stock=byId();if(!stock)return;
 const detail=document.getElementById("detail");
 for(const id of ["moat","bank","lossMaking"]){
   const checkbox=detail.querySelector("#"+id);if(checkbox)checkbox.closest("label")?.remove();
 }
 const c=capital(stock),a=calc(stock),intro=detail.querySelector(".overview");
 const record=factsCache.stocks?.[stock.ticker.toUpperCase()]||stock.lookupData||null;
 if(record){
  const fm=record.financialMeta?.fields||{};
  const fdate=(name)=>fm[name]?.end||"—";
  const filed=fm.eps?.filed||fm.revenue?.filed||"—";
  const priceDate=record.priceDate||stock.autoMeta?.priceDate||"未知";
  const metric=(label,value,unit,period)=>'<div class="metric"><small>'+esc(label)+'</small><strong>'+
     (typeof value==="number"&&Number.isFinite(value)?fmt(value,2)+unit:"—")+'</strong><small>数据期：'+esc(period||"未公布")+'</small></div>';
  const box=document.createElement("section");box.className="sectiontitle";
  box.innerHTML='<h3>最近已获取的美股收盘行情与 SEC 财报</h3>'+
   '<p class="small muted">行情：'+esc(priceDate)+' 收盘（'+esc(record.priceSource||"来源未记录")+'）；财报数据文件截止：'+esc(fm.ttmEPS?.end||fdate("eps"))+
   '；向SEC提交日期：'+esc(filed)+'。下列年度数据不等于TTM，TTM EPS单独标注。</p>'+
   '<div class="results">'+
   metric("最新已取得收盘价",record.price,"美元",priceDate)+
   metric("TTM 稀释EPS",record.ttmEPS,"美元",fdate("ttmEPS"))+
   metric("年度EPS",record.eps,"美元",fdate("eps"))+
   metric("年度营业收入",record.revenue,"亿美元",fdate("revenue"))+
   metric("年度净利润",record.netIncome,"亿美元",fdate("netIncome"))+
   metric("年度自由现金流",record.fcf,"亿美元",fdate("fcf"))+
   metric("期末净资产",record.equity,"亿美元",fdate("equity"))+
   metric("期末现金",record.cash,"亿美元",fdate("cash"))+
   metric("期末总负债",record.liabilities,"亿美元",fdate("liabilities"))+
   metric("年度ROE",record.roe,"%",fdate("roe"))+
   '</div>'+
   '<p class="hint">TTM EPS方法：'+esc(fm.ttmEPS?.method||"未披露")+'。金额单位为亿美元；股价、EPS为美元。以上数据按最新成功取得的档案展示，不保证公司最新公告都已同步。</p>';
  const prior=detail.querySelector(".summarybox");
  if(prior)prior.after(box);else detail.appendChild(box);
 }

 const capLabel=document.createElement("p");
 capLabel.className="marketcap";
 capLabel.textContent="公司总市值："+formatCap(c)+(c!==null&&c>LIMIT?" · 超过5000亿美元，归入巨无霸":c!==null?" · 不属于巨无霸":" · 等待股价／股数");
 if(intro)intro.after(capLabel);
 if(stock.type==="giant"){
  const line=document.createElement("p");line.className="small muted";
  const ttm=getNumber(stock.inputs.ttmEPS),ratio=ttm>0&&getNumber(stock.inputs.price)>0?getNumber(stock.inputs.price)/ttm:null;
  line.textContent="TTM PE："+(ratio!==null?fmt(ratio,2)+"倍":"待补真实TTM EPS")+"；优选≤20倍；20～25倍为弹性观察区；超过25倍未达标。";
  capLabel.after(line);
 }
 if(stock.type==="small"){
  const para=document.createElement("div");para.className="summarybox";
  para.textContent="当前PS："+fmt(a.ps)+"倍；未来收入："+fmt(a.projRevenue)+"亿美元；未来利润："+fmt(a.projProfit)+"亿美元；按目前市值计算的未来PE："+fmt(a.forwardPE)+"倍。PS上限需自行参考同行业填写。";
  detail.querySelector(".results")?.after(para);
 }
 const cat=detail.querySelector("#editType");
 if(cat){
  [...cat.options].forEach(opt=>{if(opt.value==="giant"&&c!==null&&c<=LIMIT)opt.disabled=true;});
  if(c!==null&&c>LIMIT){cat.value="giant";cat.disabled=true;}
  cat.addEventListener("change",()=>{const v=capital(stock);if(v!==null&&v>LIMIT){stock.type="giant";selectedType="giant";persistAndRender();}});
 }
};
document.getElementById("detail").addEventListener("input",e=>{
 if(!["price","shares","ttmEPS"].includes(e.target?.dataset?.k))return;
 const stock=byId();
 if(!stock)return;
 Promise.resolve().then(()=>{
  const c=capital(stock);
  if(c!==null&&c>LIMIT&&stock.type!=="giant"){
   stock.type="giant";stock.inputs.peLimit="25";selectedType="giant";persistAndRender();
  }
 });
},true);
function reconcile(){
 for(const stock of items){
  const c=capital(stock);
  if(c!==null&&c>LIMIT){stock.type="giant";stock.inputs.peLimit="25";}
 }
 if(!TYPES[selectedType])selectedType="giant";
 saveStore();render();
}
const originalRender=render;
render=function(){
 let adjusted=false;
 for(const stock of items){
   const cap=capital(stock);
   if(cap!==null&&cap>LIMIT&&stock.type!=="giant"){
     stock.type="giant";stock.inputs.peLimit="25";adjusted=true;
   }
 }
 if(adjusted){
   const current=items.find(x=>x.id===selectedId);
   if(current)selectedType=current.type;
   saveStore();
 }
 originalRender();
};

loadCache().then(()=>{reconcile();drawSuggestions()});
reconcile();
})();
