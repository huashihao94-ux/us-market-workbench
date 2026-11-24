/* Cached daily close and SEC XBRL fundamental data integration.
 * All client-side values come from the same-origin fundamentals.json file
 * generated in GitHub Actions. Manual fields always win unless explicitly overwritten.
 */
(function(){
"use strict";
const AUTO_FIELDS=["price","eps","ttmEPS","shares","roe","dividend","equity","low52","revenue","cash","debt","ebitda","fcf","currentAssets","liabilities"];
let cached={stocks:{},updatedAt:null,mode:"pending"};
const holder=document.getElementById("autoDataStatus");
const formatDate=value=>{
  if(!value)return "尚未成功";
  const d=new Date(value);
  return Number.isFinite(d.getTime())?d.toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"}):String(value);
};
function setStatus(message){if(holder)holder.textContent=message}
function cacheFor(stock){return stock&&cached.stocks&&cached.stocks[String(stock.ticker).toUpperCase()]||null}
function hydrate(stock,overwriteManual=false){
  const facts=cacheFor(stock);
  if(!stock||!facts)return 0;
  if(!stock.inputs||typeof stock.inputs!=="object")stock.inputs=defaults(stock.type);
  const inputs=stock.inputs;
  const tracked=new Set(Array.isArray(stock.autoFields)?stock.autoFields:[]);
  let updates=0;
  for(const key of AUTO_FIELDS){
    const value=facts[key];
    if(typeof value!=="number"||!Number.isFinite(value))continue;
    const isBlank=inputs[key]===null||inputs[key]===undefined||inputs[key]==="";
    if(overwriteManual||isBlank||tracked.has(key)){
      if(String(inputs[key]??"")!==String(value))updates++;
      inputs[key]=String(value);
      tracked.add(key);
    }
  }
  const fieldMeta=facts.financialMeta?.fields||{};
  const fiscal=fieldMeta.eps?.end||fieldMeta.revenue?.end||null;
  const stamp=[facts.priceDate?"收盘价 "+facts.priceDate:"",fiscal?"年度财报 "+fiscal:""].filter(Boolean).join("；");
  const sources=[facts.priceSource,facts.financialMeta?.source].filter(Boolean).join("；");
  if(stamp&&(overwriteManual||!inputs.asof||tracked.has("asof"))){
    if(inputs.asof!==stamp)updates++;
    inputs.asof=stamp;tracked.add("asof");
  }
  if(sources&&(overwriteManual||!inputs.source||tracked.has("source"))){
    if(inputs.source!==sources)updates++;
    inputs.source=sources;tracked.add("source");
  }
  stock.autoFields=Array.from(tracked);
  stock.autoMeta={
    priceDate:facts.priceDate||null,
    fiscal,
    priceSource:facts.priceSource||null,
    cachedAt:cached.updatedAt||null,
    historicalRevenueGrowth:facts.historicalRevenueGrowth??null,
    financialError:facts.financialError||null,
    priceError:facts.priceError||null
  };
  return updates;
}
function syncCurrent(replace){
  const stock=byId();
  if(!stock)return;
  hydrate(stock,replace);saveStore();render();
}
function makeButton(text,click,disabled=false){
  const el=document.createElement("button");el.type="button";
  el.className="btn";el.textContent=text;el.disabled=disabled;
  el.addEventListener("click",click);
  return el;
}
const priorDraw=drawDetail;
drawDetail=function(){
  priorDraw();
  const stock=byId(),detail=document.getElementById("detail");
  if(!stock||!detail)return;
  const facts=cacheFor(stock);
  const banner=document.createElement("div");
  banner.style.cssText="padding:11px;margin:11px 0;border:1px solid #354e68;border-radius:10px;background:#101d30";
  const title=document.createElement("strong");title.textContent="自动财务数据";
  banner.appendChild(title);
  const p=document.createElement("p");p.className="small muted";
  if(!facts){
    p.textContent="尚未为 "+stock.ticker+" 建立自动行情/财报缓存。可以手填数据；想自动跟踪此股，需要将代码加入仓库的 tracked_symbols.json。";
  }else{
    const meta=facts.financialMeta?.fields||{};
    const fiscal=meta.eps?.end||meta.revenue?.end||"暂无";
    p.textContent="行情截至 "+(facts.priceDate||"暂无")+"（日收盘价）；财报年度 "+fiscal+
      "；源："+(facts.priceSource||"无股价源")+
      (facts.financialMeta?" / SEC XBRL":" / 未取得SEC财报")+
      (facts.financialError?"；财报异常："+facts.financialError:"")+
      (facts.priceError?"；价格异常："+facts.priceError:"");
  }
  banner.appendChild(p);
  if(facts&&facts.historicalRevenueGrowth!==undefined&&facts.historicalRevenueGrowth!==null){
    const note=document.createElement("p");note.className="small muted";
    note.textContent="最近完整年度的历史营业收入同比约 "+Number(facts.historicalRevenueGrowth).toFixed(2)+"%，仅作历史参考，不自动填作未来收入增长预测。";
    banner.appendChild(note);
  }
  const actions=document.createElement("div");actions.className="row";
  actions.appendChild(makeButton("填入空白／更新已有自动字段",()=>syncCurrent(false),!facts));
  actions.appendChild(makeButton("覆盖手填财务数据",()=>{
    if(window.confirm("确定以最新缓存覆盖这只股票的股价与财务数据？不会改变你自己设定的未来增长率、估值模型和买入阈值。"))syncCurrent(true);
  },!facts));
  banner.appendChild(actions);
  const area=detail.querySelector(".overview");
  if(area&&area.nextSibling)detail.insertBefore(banner,area.nextSibling);
  else detail.prepend(banner);
};
// Capture manual input BEFORE the original event handler saves/rerenders the page.
const detailRoot=document.getElementById("detail");
if(detailRoot)detailRoot.addEventListener("input",event=>{
  const field=event.target?.dataset?.k;
  if(!field)return;
  const stock=byId();
  if(stock&&Array.isArray(stock.autoFields))stock.autoFields=stock.autoFields.filter(k=>k!==field);
},true);
async function refresh(){
  setStatus("正在读取公开数据缓存…");
  try{
    // Read the live public GitHub main-branch blob first, because a GITHUB_TOKEN
    // data commit may not trigger a fresh Pages deployment automatically.
    const latest="https://raw.githubusercontent.com/huashihao94-ux/us-market-workbench/main/fundamentals.json";
    let response;
    try{
      response=await fetch(latest+"?refresh="+Date.now(),{cache:"no-store"});
      if(!response.ok)throw new Error("GitHub raw HTTP "+response.status);
    }catch(error){
      response=await fetch("fundamentals.json?refresh="+Date.now(),{cache:"no-store"});
      if(!response.ok)throw new Error("GitHub raw unavailable; site cache HTTP "+response.status);
    }
    const json=await response.json();
    if(!json||!json.stocks||typeof json.stocks!=="object"||Array.isArray(json.stocks))throw new Error("缓存结构不正确");
    cached=json;
    let updates=0;
    for(const stock of items)updates+=hydrate(stock,false);
    if(updates>0)saveStore();
    const records=Object.values(cached.stocks);
    const prices=records.filter(x=>typeof x.price==="number").length;
    const annual=records.filter(x=>!!x.financialMeta).length;
    setStatus("已跟踪 "+records.length+" 只 · 有收盘价 "+prices+" 只 · 有SEC财报 "+annual+" 只 · 数据生成："+formatDate(cached.updatedAt)+" · 本次自动更新 "+updates+" 项");
  }catch(err){
    setStatus("缓存读取失败："+err.message+"。请查看GitHub Actions；手动数据仍可使用。");
  }
  render();
}
const btn=document.getElementById("refreshAutoData");
if(btn)btn.addEventListener("click",refresh);
const addBtn=document.getElementById("add");
if(addBtn)addBtn.addEventListener("click",()=>{
  const stock=byId();
  if(stock&&cacheFor(stock)){const changed=hydrate(stock,false);if(changed)saveStore();render();}
});
refresh();
})();
