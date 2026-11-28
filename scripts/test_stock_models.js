#!/usr/bin/env node
// Pure calculation regression tests; no browser, remote calls or user data.
const fs=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");

const src=fs.readFileSync(path.resolve(__dirname,"..","stock_pool_v3.js"),"utf8");
const start=src.indexOf("const KEY=");
const end=src.indexOf("function effectiveType(");
const comparisonStart=src.indexOf("function keyLine(");
const comparisonEnd=src.indexOf("function renderDetails(");
assert.ok(start>=0&&end>start&&comparisonStart>end&&comparisonEnd>comparisonStart,"missing model functions");
const models=src.slice(start,end)+"\n"+src.slice(comparisonStart,comparisonEnd);
const make=new Function("ticker","type","recordData","inputs","cap","pe","price",
 models+`
  stocks.set(ticker,recordData);
  const s={ticker,type,inputs};
  const f={r:recordData,cap,peTTM:pe,p:price,roe:recordData.roe??null,
   revenue:recordData.revenue??null,income:recordData.netIncome??null,
   ps:cap>0&&recordData.revenue>0?cap/recordData.revenue:null};
  return {growth:growthModel(s,f),growthHtml:growthPlot(s,f),growthStatus:statuses(s,f),burry:burryModel(s,f),burryHtml:burryPlot(s,f),consumer:consumerModel(s,f),
   historyAfterPartialRefresh:mergeAnnualHistory(recordData.annualHistory,{netIncome:[]})};
 `);

const income=[14,10,7,5,3].map((v,i)=>({
 end:String(2025-i)+"-12-31",value:v
}));
const annual={annualHistory:{netIncome:income,revenue:income,eps:income}};
for(const [pe,expected] of [[69.99,false],[70,true],[89.99,true],[90,false],[null,null]]){
 const m=make("TEST","growth",annual,{},200,pe,80).growth;
 assert.equal(m.peOk,expected,`PE=${pe}`);
 assert.equal(m.overall,expected,`overall PE=${pe}`);
}
assert.equal(make("TEST","growth",annual,{},200,80,80).growth.overall,true);
const good=make("TEST","growth",{...annual,roe:24,fcf:2,revenue:16,netIncome:14}, {},200,80,80);
assert.ok(Math.abs(good.growth.epsCagr-((14/5)**(1/3)-1)*100)<0.0001);
assert.ok(Math.abs(good.growth.revenueCagr-((14/5)**(1/3)-1)*100)<0.0001);
assert.match(good.growthStatus,/① 成长性：增长是否持续/);
assert.match(good.growthStatus,/② 增长质量：赚的钱是否扎实/);
assert.match(good.growthStatus,/③ 估值位置：现在贵不贵/);
assert.match(good.growthStatus,/12\.5%/); // 2亿美元FCF / 16亿美元营收
assert.match(good.growthStatus,/70 ≤ 80\.00 &lt; 90/);
assert.match(good.growthStatus,/三项均达标/);
assert.equal(make("TEST","growth",annual,{forecastGrowth:-50},200,80,80).growth.overall,true,
 "saved legacy forecasts must not affect the historical growth screen");
assert.equal(make("TEST","growth",annual,{},1000,80,80).growth.overall,false);
assert.deepEqual(make("TEST","growth",annual,{},200,80,80).growth.series.map(x=>x.year),
 ["2022","2023","2024","2025"],"four actual years, no future estimates");
assert.equal(make("TEST","growth",{annualHistory:{netIncome:income}}, {},200,80,80).growth.pastOk,null,
 "net profit history cannot be mistaken for EPS history");

// The deployed SEC cache already includes Uber's historic profits; all years
// must survive a partial on-demand refresh and display as annual year labels.
const uber=require(path.resolve(__dirname,"..","fundamentals.json")).stocks.UBER;
assert.ok(uber?.annualHistory?.netIncome?.length>=5,"Uber SEC history must be cached");
const u=make("UBER","growth",uber,{},100,39.03,66.35);
assert.deepEqual(u.growth.series.map(x=>x.year),["2022","2023","2024","2025"]);
assert.equal(u.growth.series[1].rate,null,"loss-to-profit EPS cannot be a percent");
assert.match(u.growth.series[1].reason,/扭亏为盈/);
assert.ok(Math.abs(u.growth.series[2].profitRate-422.31)<0.05);
assert.ok(Math.abs(u.growth.series[3].profitRate-2.0)<0.01);
assert.ok(Math.abs(u.growth.series[2].rate-(4.56/0.87-1)*100)<0.1);
assert.ok(u.growthHtml.includes("422.3%"),"profit history remains visible as supplementary data");
assert.ok(u.growthHtml.includes("2.0%"));
assert.ok(u.growthHtml.includes("98.56"));
assert.ok(u.growthHtml.includes("年度EPS及同比"));
assert.ok(!u.growthHtml.includes("2026"),"no automatic future-year forecast");
assert.equal(u.growth.epsCagr,null,"Uber historic EPS crosses losses: no misleading EPS CAGR");
assert.ok(u.growth.revenueCagr>0,"Uber 3-year actual revenue CAGR should be visible");
assert.match(u.growthStatus,/不适用／数据不足/);
assert.match(u.growthStatus,/仅合并原来的市值/);
assert.deepEqual(u.historyAfterPartialRefresh.netIncome,uber.annualHistory.netIncome,
 "empty SEC refresh must retain full yearly history");
const nerd=require(path.resolve(__dirname,"..","fundamentals.json")).stocks.NRDS;
const n=make("NRDS","growth",nerd,{},nerd.marketCap,nerd.price/nerd.ttmEPS,nerd.price);
assert.equal(n.growth.epsCagr,null,"NRDS crosses loss years; no invented positive CAGR");
assert.equal(n.growth.capOk,false,"NRDS current market cap is below user's custom growth range");
assert.match(n.growthStatus,/四个真实财年首尾计算/);
const navitas=require(path.resolve(__dirname,"..","fundamentals.json")).stocks.NVTS;
const nv=make("NVTS","growth",navitas,{},navitas.marketCap,null,navitas.price);
assert.equal(nv.growth.epsCagr,null,"NVTS annual losses must not be compounded");
assert.match(nv.growthStatus,/现金流为负/);
assert.match(nv.growthStatus,/TTM PE待财报/);
assert.ok(!src.includes("未来平均每年利润增速 g"),"obsolete growth g comparison must be removed");
assert.ok(!src.includes("未来长期预估年利润增长率 g"),"obsolete growth g editor must be removed");
assert.ok(!src.includes('editor("下一财年预估净利润增长率'),"remove growth-specific forecast editor");

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
const ko={roe:23};
const consumerInputs={consumerForecastEPS:2.81,consumerGrowth:5,consumerEstimateSource:"Yahoo Analysis 示例"};
const sample=make("KO","consumer",ko,consumerInputs,260,25,60.23).consumer;
assert.ok(Math.abs(sample.forwardPe-60.23/2.81)<1e-8);
assert.equal(sample.targetPe,20);
assert.ok(Math.abs(sample.referencePrice-56.2)<1e-8);
assert.equal(sample.peOk,false);
assert.equal(sample.roeOk,true);
assert.equal(sample.overall,false);
assert.equal(make("KO","consumer",{roe:20},consumerInputs,260,25,50).consumer.roeOk,false,"ROE must be strictly >20%");
assert.equal(make("KO","consumer",{roe:20.01},consumerInputs,260,25,50).consumer.overall,true);
assert.equal(make("KO","consumer",{roe:30},consumerInputs,260,25,56.2).consumer.peOk,true,"forward PE equality passes");
assert.equal(make("KO","consumer",{roe:30},{consumerGrowth:5},260,25,50).consumer.overall,null,"missing analyst EPS cannot pass");
assert.equal(make("KO","consumer",{roe:30},{consumerForecastEPS:2.81},260,25,50).consumer.overall,null,"missing growth g cannot pass");
assert.equal(make("KO","consumer",{roe:30},{consumerForecastEPS:-1,consumerGrowth:5},260,25,50).consumer.peOk,false,"non-positive earnings do not pass");
console.log("PASS: four actual EPS growth years, Uber profit/revenue context, legacy forecasts ignored, Burry, consumer PE=10+2g and ROE>20%");
