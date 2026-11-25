/* Shared public-source refresh button; it cannot trigger authenticated backend actions. */
(function(){
"use strict";
const ROOT="https://raw.githubusercontent.com/huashihao94-ux/us-market-workbench/main/";
const ACTIONS="https://github.com/huashihao94-ux/us-market-workbench/actions/workflows/refresh_all.yml";
const btn=document.getElementById("refreshAll");
if(!btn)return;
const css=document.createElement("style");
css.textContent='button#refreshAll{background:#66d8e5!important;border:1px solid #66d8e5!important;color:#071724!important;font-weight:750!important;border-radius:9px;padding:9px 12px;cursor:pointer;white-space:nowrap}button#refreshAll:disabled{opacity:.7;cursor:wait}#refreshCenter{border:1px solid #42617b;background:#102033;color:#eaf3fb;border-radius:12px;padding:13px;margin:12px auto;max-width:1410px;font-size:13px;box-shadow:0 9px 30px #0004}#refreshCenter .refresh-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:9px 0}#refreshCenter .refresh-item{border:1px solid #344d66;border-radius:9px;background:#0b192a;padding:10px}#refreshCenter .refresh-item strong{display:block;color:#e9f7ff}#refreshCenter .refresh-item span{display:block;color:#b5c6d8;font-size:12px;line-height:1.6}#refreshCenter .refresh-text{color:#c4d2df;font-size:12px;margin:6px 0}#refreshCenter a{color:#7cdeea}@media(max-width:650px){#refreshCenter .refresh-grid{grid-template-columns:1fr}}';
document.head.appendChild(css);
const box=document.createElement("section");box.id="refreshCenter";box.hidden=true;box.setAttribute("aria-live","polite");
box.innerHTML='<strong>三类市场数据更新检查</strong><p class="refresh-text" id="refreshHelp">正在准备检查…</p><div class="refresh-grid"><div class="refresh-item" id="refreshIndex"><strong>美股指数</strong><span>尚未检查</span></div><div class="refresh-item" id="refreshUs"><strong>美股个股财务</strong><span>尚未检查</span></div><div class="refresh-item" id="refreshA"><strong>A股股票行情</strong><span>尚未检查</span></div></div><p class="refresh-text">本按钮重新读取<b>最新已发布的数据</b>，以及当前页面可按需查询的行情；不保证实时。若要强制运行云端采集脚本，可在 <a target="_blank" rel="noopener noreferrer" href="'+ACTIONS+'">GitHub Actions「三市场一键更新」</a> 登录后点击 Run workflow。</p>';
const header=document.querySelector("header");if(header)header.insertAdjacentElement("afterend",box);else document.body.prepend(box);
const $=id=>document.getElementById(id);
const e=s=>String(s??"");
const yyyy=s=>e(s).slice(0,10)||"无日期";
const maxdate=xs=>xs.filter(x=>typeof x==="string"&&x.length>=10).map(x=>x.slice(0,10)).sort().at(-1)||"无日期";
const localTime=t=>{if(!t)return "未生成";const d=new Date(t);return Number.isFinite(d.getTime())?d.toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false}):e(t);};
const snapshotKey="stockPoolRefreshSnapshotsV1";
let earlier={};try{earlier=JSON.parse(sessionStorage.getItem(snapshotKey)||"{}")}catch(_){/* private session */}
const current={};
function newOrSame(name,stamp){current[name]=e(stamp);return !earlier[name]?"首次检查":earlier[name]===current[name]?"与上次检查相同（未发布新文件）":"比上次检查有新发布的数据";}
async function file(name){
 let error=null;
 for(const url of [ROOT+name+"?fresh="+Date.now(),name+"?fresh="+Date.now()]){
  try{
   const ctrl=new AbortController();const stop=setTimeout(()=>ctrl.abort(),16000);
   try{const r=await fetch(url,{cache:"no-store",signal:ctrl.signal});if(!r.ok)throw Error("HTTP "+r.status);return await r.json();}
   finally{clearTimeout(stop);}
  }catch(ex){error=ex}
 }
 throw error||Error("当前公开数据无法读取");
}
function set(id,title,lines,failed=false){
 const node=$(id);node.replaceChildren();const strong=document.createElement("strong");strong.textContent=(failed?"⚠ ":"✓ ")+title;node.appendChild(strong);
 for(const text of lines){const span=document.createElement("span");span.textContent=text;node.appendChild(span);}
}
let running=false;
async function refreshAll(){
 if(running)return;running=true;btn.disabled=true;box.hidden=false;
 btn.textContent="正在检查三个数据源…";
 $("refreshHelp").textContent="检查发起时间："+new Date().toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false})+"（北京时间）。正在从公开仓库读取最新文件……";
 set("refreshIndex","美股指数",["读取中…"]);set("refreshUs","美股个股财务",["读取中…"]);set("refreshA","A股股票行情",["读取中…"]);
 const tasks=[
  file("data.json").then(j=>{const idx=j.indices||{};set("refreshIndex","美股指数",["标普500收盘日："+yyyy(idx.sp500?.asof)+"；纳斯达克："+yyyy(idx.nasdaq?.asof),"数据生成："+localTime(j.updatedAt),newOrSame("index",j.updatedAt),"来源：Cboe / Nasdaq 日线及备用源；不是盘中报价"]);return j;})
   .catch(x=>{set("refreshIndex","美股指数",["读取失败："+String(x.message||x)],true);return null;}),
  file("fundamentals.json").then(j=>{const rows=Object.values(j.stocks||{}),withReport=rows.filter(x=>x.financialMeta).length;set("refreshUs","美股个股财务",["自动跟踪："+rows.length+"只；有财报："+withReport+"只","最近已取得美股收盘日："+maxdate(rows.map(x=>x.priceDate)),"数据生成："+localTime(j.updatedAt),newOrSame("us",j.updatedAt),"来源：SEC EDGAR财报＋Yahoo/Stooq日线；价格源为非官方公开接口"] );return j;})
   .catch(x=>{set("refreshUs","美股个股财务",["读取失败："+String(x.message||x)],true);return null;}),
  file("a_share_data.json").then(j=>{const rows=j.rows||[],quoted=rows.filter(x=>typeof x.price==="number"&&x.price>0);set("refreshA","A股股票行情",["名称："+rows.length+"只；有价格："+quoted.length+"只","最近报价日期："+maxdate(quoted.map(x=>x.priceDate)),"数据生成："+localTime(j.updatedAt)+"；盘中/收盘以每股时点为准",newOrSame("a",j.updatedAt),"来源：腾讯／东方财富公开行情；个别股票报价可能滞后"]);return j;})
   .catch(x=>{set("refreshA","A股股票行情",["读取失败："+String(x.message||x)],true);return null;})
 ];
 const all=await Promise.all(tasks);
 try{sessionStorage.setItem(snapshotKey,JSON.stringify({...earlier,...current}))}catch(_){/* private session */}
 const indexClose=maxdate([all[0]?.indices?.sp500?.asof,all[0]?.indices?.nasdaq?.asof]);
 const usClose=maxdate(Object.values(all[1]?.stocks||{}).map(x=>x.priceDate));
 let lagNotice="";
 if(all[0]&&all[1]&&indexClose!=="无日期"&&usClose!=="无日期"&&usClose<indexClose){
  const node=$("refreshUs");node.querySelector("strong").textContent="⚠ 美股个股财务（已读取，行情可能滞后）";
  const detail=document.createElement("span");detail.textContent="注意：个股最近收盘日 "+usClose+"，落后指数收盘日 "+indexClose+"；数据尚未更新到同一交易日。";node.appendChild(detail);
  lagNotice="美股个股行情日期落后指数；请以显示的行情日为准。";
 }
 document.dispatchEvent(new CustomEvent("market:refresh",{detail:{index:all[0],us:all[1],a:all[2],checkedAt:new Date().toISOString()}}));
 $("refreshHelp").textContent="检查完成："+new Date().toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false})+"。"+(lagNotice||"请核对各栏的行情日期及“与上次检查相同”提示。")+" 已读取数据并通知当前页面更新；此操作不能直接启动后台采集。";
 btn.disabled=false;btn.textContent="↻ 一键刷新三类数据";running=false;
}
btn.addEventListener("click",refreshAll);
btn.title="重读最新已发布的指数、美股财报及A股行情，并更新当前页面；不直接触发云端采集任务";
})();