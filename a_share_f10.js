/* A-share F10 public-data adapter: personal research only.
   Fetches announced cash dividends and most recently published financial
   report on demand. Does not treat announced but unpaid plans as dividends. */
(function(){
"use strict";
const FN="https://datacenter-web.eastmoney.com/api/data/v1/get";
const active=new Map();
function finite(v){if(v===null||v===undefined||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null}
function chinaDay(){
 const parts=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()).map(x=>[x.type,x.value]));
 return parts.year+"-"+parts.month+"-"+parts.day;
}
async function requestF10(stock,report,size){
 const code=stock.code+"."+(stock.exchange==="SH"?"SH":stock.exchange==="BJ"?"BJ":"SZ");
 const filter='(SECUCODE="'+code+'")';
 const q=new URLSearchParams({reportName:report,columns:"ALL",filter,pageNumber:"1",pageSize:String(size),sortColumns:"REPORT_DATE",sortTypes:"-1",source:"HSF10",client:"PC"});
 const url=FN+"?"+q.toString();
 const endpoints=[url,"https://proxy.cors.dev/"+url];
 let last;
 for(const endpoint of endpoints){
  try{
   const res=await fetch(endpoint,{cache:"no-store"});
   if(!res.ok)throw Error("HTTP "+res.status);
   const data=await res.json();
   if(data.success!==true||!Array.isArray(data?.result?.data))throw Error("API无有效记录");
   return data.result.data;
  }catch(e){last=e}
 }
 throw last||Error("公开F10不可用");
}
function recentDividends(records){
 const today=chinaDay(),start=new Date(Date.parse(today+"T00:00:00Z")-365*86400000).toISOString().slice(0,10);
 const events=[],seen=new Set();
 for(const rec of records){
  const date=String(rec.EX_DIVIDEND_DATE||"").slice(0,10),v=finite(rec.PRETAX_BONUS_RMB);
  const status=String(rec.ASSIGN_PROGRESS||"");
  const report=String(rec.REPORT_DATE||"").slice(0,10);
  if(!date||date<start||date>today||v===null||v<0||!status.includes("实施"))continue;
  const sig=report+"|"+date+"|"+v;
  if(seen.has(sig))continue;seen.add(sig);
  events.push({date,value:v,report,status});
 }
 events.sort((a,b)=>b.date.localeCompare(a.date));
 const total=events.reduce((sum,x)=>sum+x.value,0);
 return {total:Number(total.toFixed(4)),events,start,today};
}
function parseLatestFin(rows){
 const records=rows.filter(r=>r&&r.REPORT_DATE).sort((a,b)=>String(b.REPORT_DATE).localeCompare(String(a.REPORT_DATE)));
 if(!records.length)return null;
 const r=records[0];
 return {period:String(r.REPORT_DATE).slice(0,10),periodName:r.REPORT_DATE_NAME||"",filed:String(r.NOTICE_DATE||"").slice(0,10),
  eps:finite(r.EPSJB),roe:finite(r.ROEJQ),
  revenue:finite(r.TOTALOPERATEREVE),netIncome:finite(r.PARENTNETPROFIT)};
}
const priorYield=yieldOf;
yieldOf=function(item){
 const manual=finite(item?.dividend10),automatic=finite(item?.autoDividend10);
 const cash=manual!==null?manual:automatic;
 const p=finite(item?.manualPrice)||finite(item?.price);
 return cash!==null&&p>0&&cash>=0?cash/10/p*100:null;
};
const priorDetail=detail;
detail=function(){
 priorDetail();
 const item=list.find(s=>s.code===selected),root=$("details");
 if(!item||!root)return;
 const box=document.createElement("div");box.className="summary";
 const events=Array.isArray(item.dividendEvents)?item.dividendEvents:[];
 const source=item.dividendSource||"尚未自动提取";
 const amt=finite(item.autoDividend10);
 const own=finite(item.dividend10);
 const report=item.latestFin||null;
 const val=(x,d=2)=>x===null||x===undefined||!Number.isFinite(Number(x))?"—":Number(x).toFixed(d);
 const label=document.createElement("h3");label.textContent="最新可得的分红公告与财报";box.appendChild(label);
 const msg=document.createElement("p");msg.className="small muted";
 msg.textContent="股价时间："+(typeof quoteLabel==="function"?quoteLabel(item):item.priceDate||"未知")+
   "；分红口径：最近365日已实施且已除权的税前现金分红。未实施预案不计入。";
 box.appendChild(msg);
 const div=document.createElement("p");div.className="small";
 div.textContent="自动计算每10股税前派息合计："+(amt!==null?val(amt,4)+"元":"暂未取得")+
 "；覆盖期间："+(item.dividendWindow||"暂无")+"；已核实事件："+events.length+"条；"+
 (own!==null?"当前股息率采用手填金额："+val(own,4)+"元/10股。":"当前股息率优先采用自动分红数据。");
 box.appendChild(div);
 if(events.length){
  const p=document.createElement("p");p.className="small muted";
  p.textContent="最近分红事件："+events.slice(0,4).map(x=>x.date+"（"+x.report+"财报：10派"+val(x.value,4)+"元）").join("；");
  box.appendChild(p);
 }
 if(report){
  const p=document.createElement("p");p.className="small";
  p.textContent="最新已获取财报："+report.periodName+"（截至"+report.period+"，公告"+(report.filed||"未知")+"）"+
   "；基本EPS "+val(report.eps)+"元"+
   "；ROE "+val(report.roe)+"%"+
   "；累计营业收入 "+(report.revenue!==null?val(report.revenue/1e8)+"亿元":"—")+
   "；累计归母净利润 "+(report.netIncome!==null?val(report.netIncome/1e8)+"亿元":"—")+
   "。季度财报数字可能为年初至报告期累计。";
  box.appendChild(p);
 }
 const status=document.createElement("p");status.className="small muted";
 status.textContent="股息数据："+source+(item.f10Error?"；最近请求异常："+item.f10Error:"");
 box.appendChild(status);
 const btn=document.createElement("button");btn.className="btn";btn.type="button";btn.textContent="↻ 查询最新分红及财报";
 btn.disabled=active.has(item.code);btn.addEventListener("click",()=>updateStockF10(item));
 box.appendChild(btn);
 const fields=root.querySelector(".details");
 if(fields)fields.after(box);else root.appendChild(box);
};
async function updateStockF10(item){
 if(!item||active.has(item.code))return;
 const promise=(async()=>{
  let changed=false,errors=[];
  const tasks=await Promise.allSettled([requestF10(item,"RPT_SHAREBONUS_DET",40),requestF10(item,"RPT_F10_FINANCE_MAINFINADATA",8)]);
  if(tasks[0].status==="fulfilled"){
   const d=recentDividends(tasks[0].value);
   item.autoDividend10=d.total;
   item.dividendEvents=d.events;
   item.dividendWindow=d.start+" 至 "+d.today;
   item.dividendSource="东方财富F10：RPT_SHAREBONUS_DET（查询于"+new Date().toLocaleString("zh-CN")+"）";
   changed=true;
  }else errors.push("分红："+String(tasks[0].reason).slice(0,90));
  if(tasks[1].status==="fulfilled"){
   item.latestFin=parseLatestFin(tasks[1].value);
   changed=true;
  }else errors.push("财报："+String(tasks[1].reason).slice(0,90));
  item.f10Error=errors.join("；");
  if(changed)save();
 })();
 active.set(item.code,promise);
 try{await promise}finally{active.delete(item.code);render()}
}
$("stockList").addEventListener("click",event=>{
 const target=event.target.closest(".item");
 if(!target)return;
 const item=list.find(x=>x.code===target.dataset.id);
 if(item)updateStockF10(item);
});
$("add").addEventListener("click",()=>{
 const item=list.find(x=>x.code===selected);
 if(item)updateStockF10(item);
});
})();
