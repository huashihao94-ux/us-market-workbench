#!/usr/bin/env node
// Pure calculation regression tests; no browser, remote calls or user data.
const fs=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");

const src=fs.readFileSync(path.resolve(__dirname,"..","stock_pool_v3.js"),"utf8");
const start=src.indexOf("const KEY=");
const end=src.indexOf("function effectiveType(");
assert.ok(start>=0&&end>start,"missing model functions");
const models=src.slice(start,end);
const make=new Function("ticker","type","recordData","inputs","cap","pe","price",
 models+`
  stocks.set(ticker,recordData);
  const s={ticker,type,inputs};
  const f={r:recordData,cap,peTTM:pe,p:price};
  return {growth:growthModel(s,f),burry:burryModel(s,f),burryHtml:burryPlot(s,f)};
 `);

const income=[14,10,7,5].map((v,i)=>({
 end:String(2025-i)+"-12-31",value:v
}));
const annual={annualHistory:{netIncome:income}};
for(const [pe,expected] of [[69.99,false],[70,true],[89.99,true],[90,false],[null,null]]){
 const m=make("TEST","growth",annual,{forecastGrowth:35},200,pe,80).growth;
 assert.equal(m.peOk,expected,`PE=${pe}`);
 assert.equal(m.overall,expected,`overall PE=${pe}`);
}
assert.equal(make("TEST","growth",annual,{forecastGrowth:35},200,80,80).growth.overall,true);
assert.equal(make("TEST","growth",annual,{forecastGrowth:29},200,80,80).growth.overall,false);
assert.equal(make("TEST","growth",annual,{forecastGrowth:35},1000,80,80).growth.overall,false);

const prices=Array.from({length:220},(_,i)=>[
 new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),
 10.1+i*0.006
]);
const burryRecord={cash:10,debt:5,ebitda:10,fcf:6,
 currentAssets:100,liabilities:20,low52:10,priceHistory:prices};
const b=make("TEST","cigar",burryRecord,{},50,15,11);
assert.ok(Math.abs(b.burry.evToEbitda-4.5)<1e-8);
assert.ok(Math.abs(b.burry.ncavRatio-0.625)<1e-8);
assert.ok(Math.abs(b.burry.fcfYield-12)<1e-8);
assert.ok(Math.abs(b.burry.fromLow-10)<1e-8);
assert.equal(b.burry.prices.length,220);
assert.ok(b.burryHtml.includes('class="growth-svg"'));
assert.ok(b.burryHtml.includes("200日均线"));
const missing=make("TEST","cigar",{low52:8}, {},50,null,11);
assert.equal(missing.burry.evToEbitda,null);
assert.equal(missing.burry.ncavRatio,null);
assert.ok(missing.burryHtml.includes("暂无足够"));
console.log("PASS: growth PE [70,90), four hard gates, Burry EV/FCF/NCAV, daily chart and missing data");
