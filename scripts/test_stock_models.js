#!/usr/bin/env node
// Pure calculation regression tests; no browser, remote calls or user data.
const fs=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");

const src=fs.readFileSync(path.resolve(__dirname,"..","stock_pool_v3.js"),"utf8");
const tracked=require(path.resolve(__dirname,"..","tracked_symbols.json"));
assert.ok(tracked.includes("ALAB"),"ALAB must be picked up by the scheduled backend collector");
assert.ok(tracked.includes("COST"),"Costco must remain scheduled for SEC and quote refresh");
assert.match(src,/\["Costco Wholesale Corporation","COST","开市客 好市多 Costco",909832\]/,
 "Chinese Costco name aliases must be searchable");
assert.match(src,/async function refreshOne\(ticker\)/,"single-stock refresh must read the published backend cache first");
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
  const f={r:recordData,cap,peTTM:pe,p:price,roe:recordData.roe??null,eps:recordData.ttmEPS??null,
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
assert.match(u.growthStatus,/历史EPS含亏损，CAGR不适用/);
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
assert.match(nv.growthStatus,/TTM EPS非正，PE不适用/);
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
const ko={roe:23,annualHistory:{eps:[
 {end:"2025-12-31",value:2},{end:"2024-12-31",value:1.6}
]}};
const legacyInputs={consumerForecastEPS:2.81,consumerGrowth:5,consumerEstimateSource:"旧预测不应再使用"};
const sample=make("KO","consumer",ko,legacyInputs,260,25,60.23);
assert.equal(sample.consumer.impliedGrowth,7.5,"TTM PE=25 implies g=(25-10)/2=7.5%");
assert.ok(Math.abs(sample.consumer.actualGrowth-25)<1e-8,"actual growth is latest FY EPS YoY");
assert.ok(Math.abs(sample.consumer.gap+17.5)<1e-8,"implied growth is 17.5pp below actual");
assert.equal(sample.consumer.actualYear,"2025");
assert.match(sample.growthStatus,/7\.50% &lt; 25\.00%/);
assert.match(sample.growthStatus,/隐含增长率低于最近财年实际增长率/);
assert.equal(sample.consumer.roeOk,true);
assert.equal(sample.consumer.overall,true,"ROE is the only consumer hard threshold");
const high=make("KO","consumer",ko,{},260,70,60.23);
assert.equal(high.consumer.impliedGrowth,30);
assert.match(high.growthStatus,/30\.00% &gt; 25\.00%/);
const equal=make("KO","consumer",ko,{},260,60,60.23);
assert.match(equal.growthStatus,/25\.00% = 25\.00%/);
assert.equal(make("KO","consumer",{...ko,roe:20},{},260,25,50).consumer.roeOk,false,
 "ROE must be strictly >20%");
assert.equal(make("KO","consumer",{...ko,roe:20.01},{},260,25,50).consumer.overall,true);
assert.equal(make("KO","consumer",{...ko,roe:null},{},260,25,50).consumer.overall,null);
assert.equal(make("KO","consumer",ko,{},260,null,50).consumer.impliedGrowth,null,
 "no valid TTM PE must not invent implied growth");
const turnaround=make("KO","consumer",{roe:23,annualHistory:{eps:[
 {end:"2025-12-31",value:2},{end:"2024-12-31",value:-1}
]}},{},260,25,60.23);
assert.equal(turnaround.consumer.actualGrowth,null,"loss to profit is not a normal growth percentage");
assert.match(turnaround.growthStatus,/扭亏为盈/);
assert.match(turnaround.growthStatus,/不可比较/);
assert.ok(!src.includes("分析师年度EPS平均预测"),"consumer analyst estimate UI should be removed");
assert.ok(!src.includes("消费股：前瞻PE"),"consumer forward PE comparison should be removed");
assert.ok(!src.includes("前瞻PE ≤ 合理PE"),"consumer fair PE comparison should be removed");
assert.ok(!src.includes('editor("预计年利润／EPS增长率 g'),"consumer growth manual editor should be removed");
console.log("PASS: actual EPS history and growth, Burry, consumer PE-implied g vs real EPS YoY, ROE>20% only");
