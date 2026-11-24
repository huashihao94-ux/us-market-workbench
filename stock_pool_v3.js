/* Stock pool V3: one consistent state/data/render pipeline. */
(function () {
"use strict";
const KEY="us-stock-watch-categories-v1", LIMIT=5000;
const TYPE={giant:{name:"巨无霸",note:"市值超过5000亿美元，TTM PE分档"},
 growth:{name:"优秀成长股",note:"当前PE与预测利润增长率比较"},
 cigar:{name:"烟蒂股",note:"PE、PB、股息及安全边际"},
 small:{name:"小市值公司",note:"PS与未来3—5年PE估值"}};
const BASE="https://raw.githubusercontent.com/huashihao94-ux/us-market-workbench/main/";
const FALLBACK=[
 ["Apple Inc.","AAPL","苹果",320193],["Microsoft Corporation","MSFT","微软",789019],
 ["NVIDIA Corporation","NVDA","英伟达",1045810],["Uber Technologies Inc.","UBER","优步",1543151],
 ["NerdWallet, Inc.","NRDS","NerdWallet",1625278],["Palantir Technologies","PLTR","帕兰提尔",1321655],
 ["Amazon.com Inc.","AMZN","亚马逊",1018724],["Alphabet Inc.","GOOGL","谷歌",1652044],
 ["Tesla Inc.","TSLA","特斯拉",1318605],["Meta Platforms","META","Meta",1326801],
 ["Berkshire Hathaway","BRK-B","伯克希尔",1067983],["Netflix","NFLX","奈飞",1065280],
 ["Coca-Cola","KO","可口可乐",21344]
];
const $=id=>document.getElementById(id);
const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const value=x=>x===undefined||x===null||String(x).trim()===""?null:(Number.isFinite(Number(x))?Number(x):null);
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
 '<div class="compare-value">'+esc(left)+'</div>'+badge(tag,tag.includes("达标")||tag.includes("优选")?"pass":tag.includes("未")||tag.includes("偏高")?"fail":"neutral")+'</div>';
}
function period(r,key){
 const m=r?.financialMeta?.fields?.[key];return m?.end||"日期未知";
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
   if(f.peTTM!==null){
     out.push(keyLine("当前TTM PE",amount(f.peTTM)+"倍","依据真实已披露最近12个月EPS","已计算"));
   }else if(f.peAnnual!==null){
     out.push(keyLine("当前年度PE",amount(f.peAnnual)+"倍","不是TTM PE；无法与最近12个月EPS混用","仅年度口径"));
   }else out.push(keyLine("当前PE","无法计算","需要正的EPS和可用股价","待财报"));
   const g=value(v.growth);
   if(g===null){
     out.push(keyLine("未来平均每年利润增速 g","未填写","这属于未来预测，不是财报披露数据","待预测"));
   }else{
     const lower=2*g+10,upper=2*g+20,pe=f.peTTM??f.peAnnual;
     out.push(keyLine("按照课程的参考PE区间",amount(lower,1)+"—"+amount(upper,1)+"倍","估值经验式 PE≈2g+(10～20)，g="+amount(g,1)+"%",
       "参考区间"));
     if(pe!==null)
       out.push(keyLine("当前PE与参考下限比较",amount(pe)+(pe<lower?" < ":pe===lower?" = ":" > ")+amount(lower,1),
         "参考上限："+amount(upper,1)+"倍；未来增长必须自行验证",
         pe<=lower?"已达标":pe<=upper?"接近区间":"偏高未达标"));
   }
 }else if(s.type==="cigar"){
   const tests=[
    ["市盈率 PE",f.peTTM,15,"倍",false],
    ["市净率 PB",f.pb,1,"倍",false],
    ["股息率",f.yieldPct,3,"%",true]
   ];
   for(const [name,val,limit,unit,higher] of tests){
     out.push(keyLine(name,val===null?"—":amount(val)+(higher?(val>=limit?" ≥ ":" < "):(val<limit?" < ":" ≥ "))+limit,
       "初筛参考："+(higher?"≥ ":"< ")+limit+unit,val===null?"待财报":higher?val>=limit?"符合":"未达标":val<limit?"符合":"未达标"));
   }
   const fair=value(v.manualFair),mos=fair>0&&f.p>0?(1-f.p/fair)*100:null;
   out.push(keyLine("安全边际",mos===null?"待估算":amount(mos)+"%","需要自己填写合理价格；不自动假设市场价值",mos===null?"待估算":mos>=30?"符合":"未达标"));
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
 const f=financial(s),r=f.r||{},fm=r.financialMeta?.fields||{},filed=fm.eps?.filed||fm.revenue?.filed||"未取得";
 const origin=r.priceSource||oneField(s,"price").origin;
 const ptext=r.priceDate||"日期未知";
 const secs=r.financialMeta?.source||"SEC XBRL待查询或缺失";
 const idx=universe.get(s.ticker);
 const foreign=r.financialError||r.priceError||"";
 const editor=(label,key,tip,def="")=>'<label class="field"><span>'+esc(label)+'</span><input data-field="'+esc(key)+'" value="'+esc(s.inputs?.[key]??def)+'" type="number" step="any" placeholder="'+esc(tip)+'"></label>';
 const model=s.type==="growth"?
    editor("预计未来年利润增长率 g（%）","growth","例如：30，需自行预测"):
    s.type==="cigar"?editor("个人估算合理价（美元/股）","manualFair","可留空"):
    s.type==="small"?editor("预计营业收入年增速（%）","revGrowth","自行预测")+editor("预计未来净利润率（%）","margin","自行预测")+editor("预测年数","years","3 或 5","3")+editor("可比公司PS上限","psLimit","请参照同行")+editor("未来PE上限","forwardLimit","例：20","20"):"";
 const latest=record(s);
 const html='<div class="detail-title"><div><h2>'+esc(s.name)+' <span class="muted">'+esc(s.ticker)+'</span></h2>'+
  '<div class="small muted">分类：'+esc(TYPE[s.type].name)+' · 股价来源：'+esc(origin)+'</div></div>'+
  '<div class="buttons"><button id="reloadOne" type="button">↻ 更新该股票数据</button><button id="removeOne" type="button" class="danger">移出观察区</button></div></div>'+
  '<div class="datebox"><strong>行情日期：'+esc(ptext)+'</strong><span>公开数据缓存生成：'+esc(cacheDate||"未知")+'</span>'+
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
  '</div><div class="note">数据来源：'+esc(secs)+
  '. 年度EPS、年报ROE、收入和净利润不一定是最近季度或TTM口径。'+
  (foreign?' 最新读取异常：'+esc(foreign):"")+'</div>'+
  '<h3>你的目标与当前比较</h3><div class="compare-list">'+statuses(s,f)+'</div>'+
  (model?'<h3>你设定的预测／目标</h3><p class="small muted">未来增长率、行业估值上限等预测值不会凭空从历史报表推算。</p><div class="editor">'+model+'</div>':'')+
  '<h3>个人观察笔记</h3><textarea id="memo" rows="3" placeholder="记录你看好的原因和需要验证的风险">'+esc(s.inputs?.memo||"")+'</textarea>'+
  '<div class="small muted">任何无法可靠取得的指标都会显示「—」，不会假定为0或编造数据。黄色标线和横向进度条已移除。</div>';
 $("detail").innerHTML=html;
 $("reloadOne").addEventListener("click",()=>loadOnDemand(s.ticker,true));
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
 const urls=[BASE+file+"?v="+Date.now(),file+"?v="+Date.now()];
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
  $("dataStatus").textContent="已读取 "+cacheCount+"只自动行情/财报缓存；生成于 "+(cacheDate?new Date(cacheDate).toLocaleString("zh-CN"):"未知")+
  "。没有完整数据的股票可单独查询。";
 }else $("dataStatus").textContent="行情缓存未能加载；正在使用手填数据和按需查询。";
 if(results[1].status==="fulfilled"){
  normalizeRows(results[1].value.rows||[]);
  $("universeStatus").textContent="可搜索 "+universe.size.toLocaleString()+" 个股票代码，名称优先；数据覆盖不等于代码覆盖。";
 }else $("universeStatus").textContent="当前使用常用股票名称目录，完整SEC列表暂无响应。";
 render();if(picked)showSelection();
}
function resultsFor(q){
 q=q.trim().toLowerCase();if(!q)return [];
 const all=Array.from(universe.values());
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
 const d=stocks.get(picked.ticker),cap=d?.price>0&&d?.shares>0?d.price*d.shares:null;
 $("selection").innerHTML='<strong>'+esc(picked.name)+' · '+esc(picked.ticker)+'</strong><div>股价：'+
 (d?.price>0?"$"+amount(d.price):"等待查询")+" · 日期："+esc(d?.priceDate||"待查询")+
 " · 市值："+(cap===null?"待查询":amount(cap,0)+"亿美元")+
 ' · TTM PE：'+(d?.ttmEPS>0&&d?.price>0?amount(d.price/d.ttmEPS)+"倍":"待财报")+'</div>';
 if(cap!==null&&cap>LIMIT){$("newType").value="giant";$("newType").disabled=true;
   $("selection").innerHTML+="<small>市值＞5000亿美元，自动归入巨无霸。</small>";}
 else {$("newType").disabled=false;if($("newType").value==="giant")$("newType").value="growth";
   $("selection").innerHTML+="<small>"+(cap===null?"市值暂无法核实；可以先作为非巨无霸观察。":"未超过5000亿美元，可选择其他类别。")+"</small>";}
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
 if(Number.isFinite(out.netIncome)&&out.equity>0){out.roe=out.netIncome/out.equity*100;meta.roe={end:meta.netIncome?.end||""};}
 const ttm=ttmFromFacts(facts);
 if(ttm){out.ttmEPS=ttm.value;meta.ttmEPS={end:ttm.end,filed:ttm.filed,method:ttm.method};}
 out.financialMeta={source:"SEC EDGAR XBRL companyfacts",cik,fields:meta,updatedAt:new Date().toISOString()};
 return out;
}
async function jsonFetch(url){
 const r=await fetch(url,{cache:"no-store"});if(!r.ok)throw Error("HTTP "+r.status);return r.json();
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
     for(const url of ["https://proxy.cors.dev/https://query1.finance.yahoo.com/v8/finance/chart/"+target+"?range=1mo&interval=1d",
      "https://query1.finance.yahoo.com/v8/finance/chart/"+target+"?range=1mo&interval=1d"]){
      try{
       const j=await jsonFetch(url),r=j.chart?.result?.[0];if(!r)continue;
       const quotes=r.indicators?.quote?.[0]?.close||[],times=r.timestamp||[];
       const pairs=times.map((t,i)=>({t,p:value(quotes[i])})).filter(x=>x.p>0);
       if(!pairs.length)continue;
       const last=pairs.at(-1);fresh.price=last.p;
       fresh.priceDate=new Date(last.t*1000).toLocaleDateString("sv-SE",{timeZone:"America/New_York"});
       fresh.priceSource="Yahoo chart日收盘（公开接口，可能延迟）";
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