#!/usr/bin/env python3
"""Live-browser functional smoke test for all three Pages apps.
Runs against localhost clone with real GitHub public data plus local fallback.
No order, trade or financial advice, and no account secrets.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json
import sys

URL="http://127.0.0.1:8765/"
TICKERS=[("Uber","UBER",False),("NVIDIA","NVDA",True),
         ("AMD","AMD",False),("NerdWallet","NRDS",False),
         ("Navitas Semiconductor","NVTS",False)]

def check_refresh(page,name):
    button=page.locator("#refreshAll")
    assert button.count()==1,f"{name}: missing top-bar global refresh"
    button.click()
    page.locator("#refreshCenter").wait_for(state="visible",timeout=16000)
    page.get_by_text("检查完成：").first.wait_for(timeout=55000) if False else None
    page.wait_for_function(
      "() => document.querySelector('#refreshAll')?.disabled === false",
      timeout=70000)
    text=page.locator("#refreshCenter").inner_text()
    for label in ("美股指数","美股个股财务","A股股票行情"):
        assert label in text,(name,label,text[:500])
    print(f"REFRESH {name}: "+text.replace("\n"," | ")[:550],flush=True)

def metric(page,label):
    loc=page.locator(".metric").filter(
       has=page.locator("span",has_text=label))
    if not loc.count():return None
    return loc.first.locator("strong").inner_text().strip()

def us_test(page):
    page.goto(URL+"workbench.html",wait_until="domcontentloaded",timeout=60000)
    page.wait_for_selector("#query")
    page.wait_for_function("() => document.querySelector('#universeStatus')?.textContent?.includes('可搜索')",timeout=70000)
    assert page.locator("#categories .cat").count()==5
    assert "消费股" in page.locator("#categories").inner_text()
    assert page.locator(".track").count()==0
    results=[]
    for name,ticker,giant in TICKERS:
        page.locator("#query").fill(name)
        page.locator("#suggestions button").first.wait_for(timeout=15000)
        chosen=page.locator("#suggestions button").filter(has=page.locator("strong",has_text=ticker)).first
        assert chosen.count()>0,f"{ticker}: exact stock-code candidate missing after search {name}"
        chosen.click()
        page.wait_for_function("() => !document.querySelector('#addStock')?.disabled",timeout=70000)
        page.locator("#addStock").click()
        page.wait_for_function(
          "(ticker) => document.querySelector('#detail h2')?.textContent?.includes(ticker)",
          arg=ticker,timeout=20000)
        label=page.locator("#detail .datebox").inner_text()
        price=metric(page,"最近已取得收盘价")
        cap=metric(page,"市值")
        eps=metric(page,"TTM稀释EPS")
        roe=metric(page,"ROE（年报口径）")
        detail=page.locator("#detail").inner_text()
        assert "你的目标与当前比较" in detail
        assert "行情日期" in label
        assert page.locator("#detail .track").count()==0
        if ticker in {"UBER","NVDA","AMD"}:
            assert price and price!="—",(ticker,"price",price,detail[:650])
            assert cap and cap!="—",(ticker,"cap",cap,detail[:650])
            assert eps and eps!="—",(ticker,"ttm",eps,detail[:650])
            assert roe and roe!="—",(ticker,"roe",roe,detail[:650])
        if giant:
            assert "巨无霸" in page.locator("#detail").inner_text()
        if page.locator("#detail .growth-chart").count()==0:
            assert "巨无霸" in page.locator("#detail").inner_text(),(ticker,"unexpected missing chart")
        else:
            assert page.locator("#detail .growth-chart .growth-svg").count()==1,(ticker,"growth line chart")
            assert page.locator("#detail .growth-table tbody tr").count()==4,(ticker,"three actual + one forecast")
            assert "30%硬标准" in page.locator("#detail").inner_text()
            assert "成长股TTM PE硬标准" in detail and "70倍" in detail and "90倍" in detail
            forecast=page.locator('input[data-field="forecastGrowth"]')
            forecast.fill("35")
            forecast.press("Tab")
            forecast_row=page.locator("#detail .growth-table tbody tr").last.inner_text()
            assert "35.0%" in forecast_row and "≥ 30%" in forecast_row,(ticker,forecast_row)
        results.append({"ticker":ticker,"price":price,"cap":cap,"ttm_eps":eps,"roe":roe,"label":label[:135]})
    print("US_STOCKS "+json.dumps(results,ensure_ascii=False),flush=True)
    # Consumer screens use the user's handwritten forward-EPS and ROE>20 rules.
    # Burry's cigar method must expose valuation inputs even before its first
    # one-year daily price-history cache has been regenerated.
    for ticker,kind,required in (
       ("KO","consumer","消费股：自由现金流"),
       ("ON","cigar","Burry：企业价值 EV / EBITDA")
    ):
        page.locator("#newType").select_option(kind)
        page.locator("#query").fill(ticker)
        page.locator("#suggestions button").first.wait_for(timeout=15000)
        page.locator("#suggestions button").first.click()
        page.wait_for_function("() => !document.querySelector('#addStock')?.disabled",timeout=70000)
        page.locator("#addStock").click()
        page.wait_for_function("(t) => document.querySelector('#detail h2')?.textContent?.includes(t)",
                               arg=ticker,timeout=20000)
        detail=page.locator("#detail").inner_text()
        assert required in detail,(ticker,kind,detail[:1000])
        if kind=="consumer":
            assert "消费股：ROE硬标准" in detail
            assert "前瞻PE ≤ 合理PE" in detail
            assert "分析师年度EPS平均预测" in detail
            assert page.locator('input[data-field="consumerForecastEPS"]').count()==1
            assert page.locator('input[data-field="consumerGrowth"]').count()==1
            page.locator('input[data-field="consumerForecastEPS"]').fill("2.81")
            page.locator('input[data-field="consumerForecastEPS"]').press("Tab")
            page.locator('input[data-field="consumerGrowth"]').fill("5")
            page.locator('input[data-field="consumerGrowth"]').press("Tab")
            updated=page.locator("#detail").inner_text()
            assert "10＋2×5.0% = 20.00倍" in updated,updated[:2000]
        else:
            assert "Burry：现价相对52周低点" in detail
            assert "Michael Burry 参考：日线位置与低位支撑" in detail
            assert page.locator("#detail .growth-chart").count()==1
        print(f"EXTRA_CLASS {ticker} {kind} PASS",flush=True)
    check_refresh(page,"us-stock-pool")

def a_test(page):
    page.goto(URL+"a-share.html",wait_until="domcontentloaded",timeout=60000)
    page.wait_for_selector("#q")
    check_refresh(page,"a-share")
    page.locator("#q").fill("贵州茅台")
    page.wait_for_selector("#matches button",timeout=45000)
    page.locator("#matches button").first.click()
    page.locator("#add").click()
    page.wait_for_selector("#details h2",timeout=18000)
    content=page.locator("#details").inner_text()
    assert "600519" in content
    print("A_SHARE",content[:450].replace("\n"," | "),flush=True)

def index_test(page):
    page.goto(URL+"index.html",wait_until="domcontentloaded",timeout=60000)
    page.wait_for_selector("#refreshAll")
    check_refresh(page,"us-index")
    print("INDEX",page.locator("#fresh").inner_text(),flush=True)

def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,args=["--no-sandbox"])
        page=browser.new_page(viewport={"width":1400,"height":900})
        errors=[]
        page.on("pageerror",lambda ex:errors.append(str(ex)))
        index_test(page)
        us_test(page)
        a_test(page)
        if errors:
            print("BROWSER_JS_ERRORS",errors[:10],flush=True)
            raise AssertionError("Uncaught JavaScript errors")
        browser.close()
    print("PASS: index, 5 US ticker flows, A-share flow, and 3 global refresh controls",flush=True)

if __name__=="__main__":main()
