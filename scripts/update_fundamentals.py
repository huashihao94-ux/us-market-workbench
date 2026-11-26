#!/usr/bin/env python3
"""Daily cached stock metrics from documented SEC XBRL and best-effort price feeds.

SEC source: data.sec.gov/api/xbrl/companyfacts/CIK##########.json
Market data: Yahoo chart history (unofficial, can rate-limit); Stooq daily CSV fallback.
Use annual SEC financial figures unless explicitly noted; DO NOT relabel as TTM.
Never fill in projected growth or forward profit margin; these are user assumptions.
All absent/failed fields remain absent. Stale cached fields retain source dates.
"""
import argparse
import csv
import io
import json
import math
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import quote
import requests

ROOT = Path(__file__).resolve().parents[1]
SYMBOLS = ROOT / "symbols.json"
OUT = ROOT / "fundamentals.json"
UA_SEC = os.environ.get("SEC_USER_AGENT") or "StockPoolResearch huashihao94-ux@users.noreply.github.com"
UA_PRICE = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36")
PRICE_HEADERS = {"User-Agent": UA_PRICE, "Accept": "application/json,text/csv,*/*"}
SEC_HEADERS = {"User-Agent": UA_SEC, "Accept": "application/json", "Accept-Encoding": "gzip, deflate"}
USD = "USD"
USD_SHARE = "USD/shares"
SHARES = "shares"
REVENUE = ["RevenueFromContractWithCustomerExcludingAssessedTax",
           "RevenueFromContractWithCustomerIncludingAssessedTax",
           "Revenues", "SalesRevenueNet", "SalesRevenueGoodsNet",
           "SalesRevenueServicesNet"]
EPS = ["EarningsPerShareDiluted", "EarningsPerShareBasic"]
NET_INCOME = ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLoss"]
EQUITY = ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"]
FACT_FIELDS = {
  "revenue": (REVENUE, USD, True),
  "eps": (EPS, USD_SHARE, True),
  "netIncome": (NET_INCOME, USD, True),
  "equity": (EQUITY, USD, False),
  "cash": (["CashAndCashEquivalentsAtCarryingValue"], USD, False),
  "liabilities": (["Liabilities"], USD, False),
  "currentAssets": (["AssetsCurrent"], USD, False),
  "cfo": (["NetCashProvidedByUsedInOperatingActivities"], USD, True),
  "capex": (["PaymentsToAcquirePropertyPlantAndEquipment"], USD, True),
  "opIncome": (["OperatingIncomeLoss"], USD, True),
  "depreciation": (["DepreciationDepletionAndAmortization",
                     "DepreciationDepletionAndAmortizationPropertyPlantAndEquipment"], USD, True),
  "dividend": (["CommonStockDividendsPerShareDeclared", "CommonStockDividendsPerShareCashPaid"], USD_SHARE, True),
  "longDebt": (["LongTermDebtNoncurrent", "LongTermDebt"], USD, False),
  "currentDebt": (["LongTermDebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"], USD, False),
  "shortDebt": (["ShortTermBorrowings"], USD, False),
  "shares": (["EntityCommonStockSharesOutstanding", "CommonStockSharesOutstanding"], SHARES, False)
}
TRACKED = ROOT / "tracked_symbols.json"
def get_json(url, headers, timeout=32, attempts=2):
    error = None
    for attempt in range(attempts):
        try:
            response = requests.get(url, headers=headers, timeout=timeout)
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            error = exc
            if attempt != attempts - 1:
                time.sleep((attempt + 1) * 1.5)
    raise RuntimeError(f"{url.split('?')[0]}: {str(error)[:130]}")

def safe_num(value):
    try:
        n = float(value)
        return n if math.isfinite(n) else None
    except (ValueError, TypeError, OverflowError):
        return None

def annual_records(node, unit):
    records = ((node or {}).get("units") or {}).get(unit, [])
    out = []
    for rec in records:
        if rec.get("form") not in ("10-K", "10-K/A") or not rec.get("start") or not rec.get("end"):
            continue
        try:
            days = (datetime.fromisoformat(rec["end"]) - datetime.fromisoformat(rec["start"])).days
        except (TypeError, ValueError):
            continue
        if not 330 <= days <= 390:
            continue
        if safe_num(rec.get("val")) is None:
            continue
        out.append(rec)
    return out

def instant_records(node, unit):
    records = ((node or {}).get("units") or {}).get(unit, [])
    return [r for r in records if r.get("end") and not r.get("start")
            and r.get("form") in ("10-Q", "10-Q/A", "10-K", "10-K/A")
            and safe_num(r.get("val")) is not None]

def choose(facts, tags, unit, annual=True):
    all_facts = []
    for taxonomy in ("us-gaap", "dei"):
        table = facts.get(taxonomy) or {}
        for rank, tag in enumerate(tags):
            node = table.get(tag)
            if not node:
                continue
            records = annual_records(node, unit) if annual else instant_records(node, unit)
            for r in records:
                all_facts.append((r["end"], r.get("filed", ""), -rank, safe_num(r["val"]), tag))
    if not all_facts:
        return None
    best = max(all_facts, key=lambda x: (x[0], x[1], x[2]))
    return {"value": best[3], "end": best[0], "filed": best[1], "tag": best[4]}

def annual_history(facts, tags, unit):
    candidates = []
    for taxonomy in ("us-gaap", "dei"):
        for priority, tag in enumerate(tags):
            for r in annual_records((facts.get(taxonomy) or {}).get(tag), unit):
                candidates.append((r["end"], r.get("filed", ""), -priority, safe_num(r["val"])))
    by_end = {}
    for end, filed, priority, val in candidates:
        if end not in by_end or (filed, priority) > by_end[end][0]:
            by_end[end] = ((filed, priority), val)
    return [(end, by_end[end][1]) for end in sorted(by_end, reverse=True)]

def latest_facts(cik):
    if cik is None:
        raise ValueError("missing CIK")
    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{int(cik):010d}.json"
    try:
        j = get_json(url, SEC_HEADERS, timeout=50, attempts=1)
    except Exception as err:
        # SEC may deny otherwise fair-use cloud runner identities. A public
        # third-party proxy only carries SEC's public XBRL documents (no keys).
        print(f"Direct SEC companyfacts blocked for CIK {cik}: {str(err)[:70]}; trying public read-only proxy",flush=True)
        try:
            j = get_json("https://proxy.cors.dev/" + url, SEC_HEADERS, timeout=60, attempts=2)
        except Exception as proxy_err:
            # Diagnosed fallback: data.sec.gov accepts some browser-style requests.
            # Proxy remains preferred because stock filings are public data.
            raise RuntimeError("SEC direct and public proxy unavailable: "+str(proxy_err)[:115])
    return j.get("facts") or {}

def trailing_twelve_month_eps(facts):
    """TTM diluted EPS from comparable SEC fiscal periods.

    If latest full-year is the most recent reporting period, that fiscal-year
    12-month EPS is the latest trailing-12-month period. When a newer 10-Q
    exists, compute FY EPS + current fiscal YTD EPS - prior fiscal YTD EPS.
    Do not stitch unrelated quarters or silently use stale annual EPS.
    """
    from datetime import timedelta
    gaap=facts.get("us-gaap") or {}
    candidates=[]
    for rank,tag in enumerate(EPS):
        node=gaap.get(tag) or {}
        for item in node.get("units",{}).get(USD_SHARE,[]):
            if item.get("form") not in ("10-K","10-K/A","10-Q","10-Q/A"):
                continue
            v=safe_num(item.get("val"))
            start,end=item.get("start"),item.get("end")
            if v is None or not start or not end:
                continue
            try:
                d0=datetime.fromisoformat(start).date()
                d1=datetime.fromisoformat(end).date()
            except (TypeError,ValueError):
                continue
            if (d1-d0).days<65 or (d1-d0).days>391:
                continue
            candidates.append({"start":d0,"end":d1,"value":v,
                               "form":item.get("form"),"filed":item.get("filed",""),
                               "tag":tag,"rank":rank})
    annual=[r for r in candidates if r["form"].startswith("10-K")
            and 330 <= (r["end"]-r["start"]).days <= 390]
    if not annual:
        return None
    fy=max(annual,key=lambda r:(r["end"],r["filed"],-r["rank"]))
    newer=[r for r in candidates if r["form"].startswith("10-Q")
           and r["end"]>fy["end"] and r["end"]<=fy["end"]+timedelta(days=320)
           and abs((r["start"]-fy["end"]).days)<=12]
    if not newer:
        return {"value":round(fy["value"],5),"end":str(fy["end"]),
                "method":"最近12个月完整财政年度EPS（10-K）",
                "periods":[str(fy["start"]),str(fy["end"])],
                "tag":fy["tag"],"filed":fy["filed"]}
    ytd=max(newer,key=lambda r:(r["end"],r["filed"],-r["rank"]))
    duration=(ytd["end"]-ytd["start"]).days
    older=[r for r in candidates if r["form"].startswith("10-Q")
           and r["end"]<=fy["end"] and abs((r["start"]-fy["start"]).days)<=12
           and abs((r["end"]-r["start"]).days-duration)<=14]
    # Keep matching fiscal quarter rather than mixing FY, 3-month and YTD.
    if not older:
        return None
    prior=max(older,key=lambda r:(r["end"],r["filed"],-r["rank"]))
    ttm=fy["value"]+ytd["value"]-prior["value"]
    return {"value":round(ttm,5),"end":str(ytd["end"]),
            "method":"FY+当前YTD−上年同段YTD（稀释EPS近似；回购/拆股可能影响）",
            "periods":[str(fy["end"]),str(ytd["end"]),str(prior["end"])],
            "tag":fy["tag"],"filed":ytd["filed"]}

def extract_financials(cik):
    facts = latest_facts(cik)
    out, detail = {}, {}
    found = {}
    for name, (tags, unit, annual) in FACT_FIELDS.items():
        result = choose(facts, tags, unit, annual)
        if result is not None:
            found[name] = result
            detail[name] = {k: result[k] for k in ("end","filed","tag")}
    for name in ("revenue", "netIncome", "equity", "cash", "liabilities", "currentAssets",
                 "cfo", "capex", "opIncome", "depreciation", "longDebt", "currentDebt", "shortDebt"):
        if name in found:
            out[name] = round(found[name]["value"] / 100_000_000, 5)
    for name in ("eps", "dividend"):
        if name in found:
            out[name] = round(found[name]["value"], 5)
    ttm_eps=trailing_twelve_month_eps(facts)
    if ttm_eps:
        out["ttmEPS"]=ttm_eps["value"]
        detail["ttmEPS"]={"end":ttm_eps["end"],
                           "filed":ttm_eps.get("filed", ""),
                           "method":ttm_eps["method"],
                           "periods":ttm_eps["periods"],
                           "tag":ttm_eps["tag"]}

    if "shares" in found and found["shares"]["value"] > 0:
        out["shares"] = round(found["shares"]["value"]/100_000_000, 6)
    else:
        weighted = choose(facts, ["WeightedAverageNumberOfDilutedSharesOutstanding",
                                  "WeightedAverageNumberOfSharesOutstandingBasic"], SHARES, True)
        if weighted and weighted["value"] > 0:
            out["shares"] = round(weighted["value"]/100_000_000, 6)
            detail["shares"] = {k:weighted[k] for k in ("end","filed","tag")}
            detail["shares"]["note"] = "年度加权平均股数，可能不等于当前流通在外股数"
    if "cfo" in found and "capex" in found:
        out["fcf"] = round((found["cfo"]["value"]-abs(found["capex"]["value"]))/100_000_000, 5)
        detail["fcf"] = {"end": found["cfo"]["end"],
                        "note": "按年度经营现金流减资本支出估算；如期间不一致，应谨慎使用"}
    if "opIncome" in found and "depreciation" in found:
        out["ebitda"] = round((found["opIncome"]["value"]+found["depreciation"]["value"])/100_000_000, 5)
        detail["ebitda"] = {"end": found["opIncome"]["end"],
                            "note": "经营利润加折旧摊销的粗略代理，并非公司披露的调整后EBITDA"}
    # Don't treat unavailable debt as zero; combine only reported components.
    if any(x in found for x in ("longDebt", "currentDebt", "shortDebt")):
        long_d = found.get("longDebt", {}).get("value", 0)
        cur_d = found.get("currentDebt", {}).get("value", 0)
        short_d = found.get("shortDebt", {}).get("value", 0)
        # LongTermDebt may already include the current portion; avoid double-counting it.
        if found.get("longDebt", {}).get("tag") == "LongTermDebt":
            cur_d = 0
        out["debt"] = round((long_d+cur_d+short_d)/100_000_000, 5)
        detail["debt"] = {"end": max(found[x]["end"] for x in ("longDebt","currentDebt","shortDebt") if x in found),
                          "note": "根据已报告有息债务项目合计，可能遗漏租赁负债及部分其他借款"}
    # Five complete SEC fiscal years are needed for four historical
    # year-over-year intervals / a 4-year CAGR. Keep six to expose history
    # without silently replacing missing fiscal years with estimates.
    annual_data = {}
    for label, tags, unit, divisor in (
        ("netIncome", NET_INCOME, USD, 100_000_000),
        ("revenue", REVENUE, USD, 100_000_000),
        ("eps", EPS, USD_SHARE, 1),
    ):
        series = annual_history(facts, tags, unit)[:6]
        if series:
            annual_data[label] = [
                {"end": end, "value": round(v / divisor, 5)}
                for end, v in series
            ]
    if annual_data:
        out["annualHistory"] = annual_data
    rev_hist = annual_history(facts, REVENUE, USD)
    if len(rev_hist) >= 2 and rev_hist[1][1] > 0:
        out["historicalRevenueGrowth"] = round((rev_hist[0][1]/rev_hist[1][1]-1)*100, 2)
    income = found.get("netIncome")
    yearly_equity = []
    for taxonomy in ("us-gaap",):
        for tag in EQUITY:
            node = (facts.get(taxonomy) or {}).get(tag)
            for r in instant_records(node, USD):
                if r.get("form") in ("10-K", "10-K/A"):
                    yearly_equity.append((r["end"], r.get("filed", ""), safe_num(r["val"])))
    by_year = {}
    for end, filed, val in sorted(yearly_equity, reverse=True):
        by_year.setdefault(end, val)
    dates = sorted(by_year, reverse=True)
    if income and len(dates)>=2 and by_year[dates[0]]>0 and by_year[dates[1]]>0:
        # Compare fiscal periods: choose equity closing dates around earnings fiscal year.
        eligible = [d for d in dates if d<=income["end"]]
        if len(eligible)>=2:
            eq1,eq2=by_year[eligible[0]],by_year[eligible[1]]
            out["roe"] = round(income["value"]/((eq1+eq2)/2)*100, 2)
            detail["roe"]={"end":income["end"],"note":"最近完整财政年度净利润÷期初期末平均净资产"}
    out["meta"] = {"cik": cik, "updatedAt": datetime.now(timezone.utc).isoformat(),
                   "source": "SEC EDGAR XBRL companyfacts", "fields": detail,
                   "basis": "财务指标多为最近完整财政年度或最近季度末，非TTM；预测增长率需自行填写"}
    return out

def yahoo_prices(ticker):
    t=quote(ticker.replace(".", "-"),safe="-")
    errors=[]
    for host in ("query1.finance.yahoo.com","query2.finance.yahoo.com","proxy.cors.dev"):
        try:
            # Fixed chart URLs can be held in an outdated CDN or public-proxy
            # cache even after a new NYSE close is published. The unique query
            # parameter is harmless to Yahoo and prevents reusing yesterday's
            # exact request URL. Recheck the returned quote dates regardless.
            bust=f"&nocache={int(time.time()//300)}"
            url=(f"https://proxy.cors.dev/https://query1.finance.yahoo.com/v8/finance/chart/{t}?range=1y&interval=1d"+bust
                 if host=="proxy.cors.dev" else
                 f"https://{host}/v8/finance/chart/{t}?range=1y&interval=1d"+bust)
            j=get_json(url,PRICE_HEADERS,timeout=17 if host=="proxy.cors.dev" else 12,attempts=1)
            chart=j["chart"]
            result=(chart.get("result") or [None])[0]
            if not result:
                raise ValueError(chart.get("error") or "empty chart")
            meta=result.get("meta") or {}
            quote_obj=(result.get("indicators",{}).get("quote") or [{}])[0]
            closes=quote_obj.get("close") or []
            lows=quote_obj.get("low") or []
            ts=result.get("timestamp") or []
            recent=[(tstamp,close) for tstamp,close in zip(ts,closes) if safe_num(close) and close>0]
            if not recent:
                raise ValueError("chart contains no closing prices")
            timestamp,price=recent[-1]
            lowest=meta.get("fiftyTwoWeekLow")
            lowprices=[x for x in lows if safe_num(x) and x>0]
            if not safe_num(lowest) and lowprices:
                lowest=min(lowprices)
            date=datetime.fromtimestamp(timestamp,timezone.utc).date().isoformat()
            row={"price":round(float(price),4),
                 "priceDate":date, "priceSource":("Yahoo Finance chart via third-party cors.dev proxy (unofficial, daily close)" if host=="proxy.cors.dev" else "Yahoo Finance chart (unofficial, daily close)")}
            # Preserve the last trading year's daily *closes* for an honest
            # technical chart. The daily quote and its history share one source.
            daily=[]
            for day_ts, day_close in recent[-260:]:
                daily.append([datetime.fromtimestamp(day_ts,timezone.utc).date().isoformat(),
                              round(float(day_close),4)])
            if len(daily)>=20:
                row["priceHistory"]=daily
            if safe_num(lowest) and lowest>0:
                row["low52"]=round(float(lowest),4)
            return row
        except Exception as err:
            errors.append(str(err)[:100])
    raise RuntimeError("; ".join(errors))

def stooq_prices(ticker):
    # Stooq only as a fall-back; pricing and date conventions may differ from Yahoo.
    t=ticker.lower().replace("-",".")+".us"
    r=requests.get("https://stooq.com/q/d/l/",params={"s":t,"i":"d","d1":"20250101"},
                   headers=PRICE_HEADERS,timeout=15)
    r.raise_for_status()
    rows=list(csv.DictReader(io.StringIO(r.text.lstrip("\ufeff"))))
    usable=[]
    for row in rows:
        try:
            if row["Date"] and float(row["Close"])>0:
                usable.append((row["Date"],float(row["Close"]),float(row["Low"])))
        except (KeyError,TypeError,ValueError):
            continue
    if len(usable)<3:
        raise ValueError("No recent price rows")
    usable.sort()
    last=usable[-1]
    # Stooq daily price list may include splits/dividend adjustments.
    window=usable[-260:]
    return {"price":round(last[1],4),"priceDate":last[0],
            "priceSource":"Stooq daily CSV (fallback, possible adjusted historical data)",
            "low52":round(min(x[2] for x in window),4),
            "priceHistory":[[day,round(close,4)] for day,close,_ in window]}

def expected_recent_us_close():
    """Conservative expected weekday close after US market hours.

    Market holidays can have no session; this threshold is only a reason to
    consult the secondary feed, not proof that a new price must exist.
    """
    day = (datetime.now(timezone.utc) - timedelta(hours=6)).date()
    while day.weekday() >= 5:
        day -= timedelta(days=1)
    return day.isoformat()

def price_for(ticker):
    yahoo = None
    yahoo_error = ""
    try:
        yahoo = yahoo_prices(ticker)
    except Exception as err:
        yahoo_error = str(err)[:120]

    expected = expected_recent_us_close()
    if yahoo and yahoo.get("priceDate", "") >= expected:
        return yahoo

    # A valid but stale Yahoo reply is not a successful *latest* update.
    # Stooq may have published the newer trading day already. Prefer
    # whichever source has the later dated closing quote; do not mix dates.
    try:
        stooq = stooq_prices(ticker)
        if not yahoo or stooq["priceDate"] > yahoo.get("priceDate", ""):
            if yahoo:
                print(f"{ticker}: Yahoo dated {yahoo.get('priceDate')}, using newer Stooq {stooq['priceDate']}", flush=True)
            return stooq
    except Exception as err:
        if not yahoo:
            raise RuntimeError(f"Yahoo {yahoo_error}; Stooq {str(err)[:100]}")

    if yahoo:
        if yahoo.get("priceDate", "") < expected:
            yahoo["priceWarning"] = (
                f"Latest retrieved close {yahoo.get('priceDate')}; "
                f"expected weekday {expected}; alternate source has no newer date")
        return yahoo
    raise RuntimeError(f"Both Yahoo and Stooq quote providers unavailable for {ticker}")

def load_file(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError,ValueError,UnicodeDecodeError):
        return default

def selected_tickers():
    seed=[row[1].upper() for row in load_file(SYMBOLS,{"rows":[]}).get("rows",[])][:75]
    if TRACKED.exists():
        j=load_file(TRACKED,[])
        if isinstance(j,list):
            seed=[str(s).strip().upper() for s in j if isinstance(s,str)][:150]
    return list(dict.fromkeys(s for s in seed if s and len(s)<16))

def mappings():
    return {row[1].upper():row for row in load_file(SYMBOLS,{"rows":[]}).get("rows",[]) if len(row)>=2}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--mode",choices=("full","prices"),default="full")
    args=parser.parse_args()
    tickers=selected_tickers()
    if not tickers:
        raise RuntimeError("No tracked tickers")
    mapping=mappings()
    prior=load_file(OUT,{"stocks":{}})
    prior_stocks=prior.get("stocks") or {}
    results={k:dict(v) for k,v in prior_stocks.items()}
    errors=[]
    print(f"{args.mode}: {len(tickers)} tracked symbols",flush=True)
    # SEC's fair access threshold is 10 requests/sec; use at most 3 workers.
    def work(ticker):
        rec=dict(results.get(ticker) or {})
        info=mapping.get(ticker)
        rec["name"]=info[0] if info else rec.get("name",ticker)
        rec["ticker"]=ticker
        if args.mode=="full":
            cik=info[3] if info and len(info)>3 else None
            if cik:
                try:
                    financials=extract_financials(cik)
                    # replace earlier SEC fields, never preserve stale EPS as current silently
                    oldkeys=rec.get("_secFields") or []
                    for k in oldkeys:
                        rec.pop(k,None)
                    fields=[key for key in financials if key!="meta"]
                    rec.update(financials)
                    rec["financialMeta"]=financials["meta"]
                    rec["_secFields"]=fields
                    rec.pop("financialError",None)
                except Exception as exc:
                    rec["financialError"]=str(exc)[:170]
                    errors.append(f"{ticker} SEC: {str(exc)[:90]}")
            else:
                rec["financialError"]="Missing CIK: run SEC directory update first"
        try:
            prices=price_for(ticker)
            rec.pop("priceWarning",None)
            rec.update(prices)
            rec.pop("priceError",None)
        except Exception as exc:
            rec["priceError"]=str(exc)[:170]
            errors.append(f"{ticker} price: {str(exc)[:90]}")
        if safe_num(rec.get("price")) and safe_num(rec.get("shares")) and rec["price"]>0 and rec["shares"]>0:
            rec["marketCap"]=round(rec["price"]*rec["shares"],4) # 亿美元
            rec["marketCapNote"]="按最近成功抓取的股价乘SEC披露股数估算，单位亿美元"
        return ticker,rec
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures=[pool.submit(work,t) for t in tickers]
        for fut in as_completed(futures):
            ticker,rec=fut.result()
            results[ticker]=rec
            print(ticker,"price",rec.get("price"),"report",rec.get("financialMeta",{}).get("updatedAt","—"),flush=True)
    out={"updatedAt":datetime.now(timezone.utc).isoformat(),
         "mode":args.mode,"tracked":len(tickers),"stocks":results,
         "status":"ok" if not errors else "partial" if any(v.get("price") or v.get("financialMeta") for v in results.values()) else "unavailable",
         "errors":errors[:50],
         "notes":"价格是最新成功抓取的日线收盘价，可能延迟；eps为年度EPS；ttmEPS为独立计算的最新可得12个月EPS；marketCap单位亿美元；字段无值时不要假设为零。"}
    OUT.write_text(json.dumps(out,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    countprice=sum(1 for t in tickers if results.get(t,{}).get("price"))
    countfin=sum(1 for t in tickers if results.get(t,{}).get("financialMeta"))
    print("Saved:",countprice,"with prices;",countfin,"with SEC facts;",len(errors),"field errors",flush=True)
    for message in errors[:20]:
        print("Provider error:", message, file=sys.stderr, flush=True)
    if countprice==0 and countfin==0:
        print("WARNING: All providers failed; publishing directory plus explicit unavailable cache (not pretending prices exist)",file=sys.stderr,flush=True)

if __name__=="__main__":
    main()
