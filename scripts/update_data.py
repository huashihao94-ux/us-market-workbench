#!/usr/bin/env python3
"""Fetch S&P 500 (^GSPC) and Nasdaq Composite (^IXIC) history, calculate market phase.
All metrics are calculated from daily CLOSE, not intraday quotes. No fictional fallbacks.
"""
import csv
import io
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from zoneinfo import ZoneInfo
import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data.json"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36", "Accept": "text/csv,application/json,*/*"}
SPECS = {
    "sp500": {"name": "标普500", "ticker": "^GSPC", "stooq": "^spx", "bottoms": ["2010-07-02", "2015-08-25", "2018-12-24", "2020-03-23", "2025-04-08", "2026-03-30"]},
    "nasdaq": {"name": "纳斯达克综合指数", "ticker": "^IXIC", "stooq": "^ndq", "bottoms": ["2010-07-02", "2012-11-15", "2015-08-25", "2018-12-24", "2020-03-23", "2025-04-08", "2026-03-30"]}
}

def yahoo(symbol):
    errors = []
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        try:
            url = "https://" + host + "/v8/finance/chart/" + quote(symbol, safe="")
            res = requests.get(url, params={"range": "max", "interval": "1d"}, headers=UA, timeout=28)
            res.raise_for_status()
            payload = res.json()["chart"]
            if payload.get("error"):
                raise ValueError(str(payload["error"]))
            data = payload["result"][0]
            quotes = data["indicators"]["quote"][0]["close"]
            rows = {}
            for ts, close in zip(data["timestamp"], quotes):
                if close is not None and close > 0:
                    date = datetime.fromtimestamp(ts, ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
                    if date >= "2008-01-01":
                        rows[date] = round(float(close), 4)
            if len(rows) < 2000:
                raise ValueError("Not enough data for historical comparisons")
            return sorted(rows.items()), "Yahoo Finance（日收盘价）"
        except Exception as exc:
            errors.append(str(exc)[:180])
            time.sleep(1)
    raise RuntimeError("Yahoo: " + " / ".join(errors))

def stooq(symbol):
    url = "https://stooq.com/q/d/l/"
    resp = requests.get(url, params={"s": symbol, "i": "d", "d1": "20080101"}, headers=UA, timeout=35)
    resp.raise_for_status()
    parsed = list(csv.DictReader(io.StringIO(resp.text)))
    rows = {}
    for p in parsed:
        try:
            dt = p["Date"]
            close = float(p["Close"])
            if close > 0 and dt >= "2008-01-01":
                rows[dt] = round(close, 4)
        except (KeyError, ValueError, TypeError):
            pass
    if len(rows) < 2000:
        raise ValueError("Stooq response invalid or historical data incomplete")
    return sorted(rows.items()), "Stooq（日收盘价）"

def fred(spec):
    """
    FRED graph CSV needs no API key. S&P 500 data on FRED is limited
    to its latest 10 years, so earlier S&P historical curves may be missing.
    """
    series_id = "SP500" if spec["ticker"] == "^GSPC" else "NASDAQCOM"
    response = requests.get(
        "https://fred.stlouisfed.org/graph/fredgraph.csv",
        params={"id": series_id},
        headers=UA,
        timeout=35,
    )
    response.raise_for_status()
    lines = list(csv.reader(io.StringIO(response.text.lstrip("\ufeff"))))
    if not lines or series_id not in lines[0]:
        raise ValueError("Unexpected FRED response, CSV header missing series name")
    price_col = lines[0].index(series_id)
    rows = {}
    for fields in lines[1:]:
        if len(fields) <= price_col:
            continue
        date, value = fields[0].strip(), fields[price_col].strip()
        if date < "2008-01-01" or value in {"", "."}:
            continue
        try:
            price = float(value)
            if price > 0:
                rows[date] = round(price, 4)
        except ValueError:
            continue
    if len(rows) < 250:
        raise ValueError("FRED did not return enough daily closing observations")
    return sorted(rows.items()), "FRED（美联储经济数据库，日收盘数据）"


def fetch(spec):
    # FRED first: keyless CSV often works in GitHub Actions whereas Yahoo can rate-limit
    # shared runners and Stooq's CSV download now often requires a key.
    providers = [
        ("FRED", lambda: fred(spec)),
        ("Yahoo Finance", lambda: yahoo(spec["ticker"])),
        ("Stooq", lambda: stooq(spec["stooq"])),
    ]
    errors = []
    for name, supplier in providers:
        try:
            print(f"Trying {name} for {spec['ticker']}", flush=True)
            rows, source = supplier()
            if len(rows) < 300:
                raise ValueError(f"Only {len(rows)} daily rows")
            latest = datetime.fromisoformat(rows[-1][0]).date()
            age_days = (datetime.now(timezone.utc).date() - latest).days
            if age_days > 14:
                raise ValueError(f"Latest observation {latest} is {age_days} days old")
            print(f"{name}: {len(rows)} days; latest {rows[-1][0]}", flush=True)
            return rows, source
        except Exception as error:
            message = f"{name}: {type(error).__name__}: {str(error)[:250]}"
            print(message, file=sys.stderr, flush=True)
            errors.append(message)
    raise RuntimeError("All providers failed: " + " | ".join(errors))

def make_index(spec, rows, source):
    dates = [d for d, c in rows]
    closes = [c for d, c in rows]
    n = len(closes)
    if n < 300:
        raise ValueError("Insufficient history")
    # Historical sample lows are reproduced from the video, not recomputed.
    # Plot lines and latest metrics use a consistent daily-close methodology.
    ma200, rolling_high, drawdown, deviation = [], [], [], []
    total = 0.0
    for i, p in enumerate(closes):
        total += p
        if i >= 200:
            total -= closes[i-200]
        sma = total / 200 if i >= 199 else None
        high = max(closes[max(0, i-251):i+1])
        ma200.append(sma)
        rolling_high.append(high)
        drawdown.append(round((p / high - 1) * 100, 3))
        deviation.append(round((p / sma - 1) * 100, 3) if sma else None)

    # Current market episode begins at the maximum close over the latest 252 trading sessions.
    recent_start = max(0, n-252)
    peak_idx = max(range(recent_start, n), key=lambda i: closes[i])
    def path(start, end):
        return [{"d": dates[i], "x": i-start, "dd": drawdown[i], "ma": deviation[i]}
                for i in range(start, min(end+1, n)) if deviation[i] is not None]

    # For backtest comparisons, anchor each episode at its preceding 1-year closing high.
    # Use historical per-episode peak for drawdown (not rolling high which can change later).
    episodes = []
    for date in spec["bottoms"]:
        idx = min(range(n), key=lambda i: abs((datetime.fromisoformat(dates[i]) - datetime.fromisoformat(date)).days))
        if abs((datetime.fromisoformat(dates[idx]) - datetime.fromisoformat(date)).days) > 6:
            continue
        before = max(0, idx-251)
        peak = max(range(before, idx+1), key=lambda i: closes[i])
        line = []
        for i in range(peak, min(n, idx+121)):
            if deviation[i] is not None:
                line.append({"x": i-peak, "d": dates[i],
                             "dd": round((closes[i]/closes[peak]-1)*100, 3),
                             "ma": deviation[i]})
        episodes.append({"date": date, "lowDate": dates[idx], "peakDate": dates[peak],
                         "bottomX": idx-peak, "points": line})

    return {
        "name": spec["name"], "ticker": spec["ticker"], "source": source,
        "asof": dates[-1], "price": round(closes[-1], 2),
        "ma200": round(ma200[-1], 2),
        "high1y": round(closes[peak_idx], 2),
        "highDate": dates[peak_idx], "daysFromHigh": n-1-peak_idx,
        "drawdown": round((closes[-1] / closes[peak_idx]-1)*100, 3),
        "deviation": deviation[-1],
        "current": [{"x":i-peak_idx, "d":dates[i],
                     "dd":round((closes[i]/closes[peak_idx]-1)*100, 3),
                     "ma": deviation[i]}
                    for i in range(peak_idx, n) if deviation[i] is not None],
        "episodes": episodes,
        "recent": [{"d": dates[i], "v": round(closes[i],2)} for i in range(max(0,n-260),n)]
    }

def main():
    result = {"updatedAt": datetime.now(timezone.utc).isoformat(), "indices": {}, "errors": []}
    prior = None
    if OUT.exists():
        try: prior = json.loads(OUT.read_text(encoding="utf-8"))
        except Exception: pass
    for key, spec in SPECS.items():
        try:
            rows, source = fetch(spec)
            result["indices"][key] = make_index(spec, rows, source)
            print(key, len(rows), rows[-1][0], source, flush=True)
        except Exception as exc:
            print(key, "FAILED", str(exc), file=sys.stderr)
            result["errors"].append(key + ": " + str(exc)[:190])
            if prior and key in prior.get("indices", {}):
                result["indices"][key] = prior["indices"][key]
                result["indices"][key]["source"] += "（旧缓存）"
    if not result["indices"]:
        # The user sees a clear data-unavailable message; never invent market values.
        result["status"] = "unavailable"
    else:
        result["status"] = "partial" if result["errors"] else "ok"
    OUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("Saved", OUT, result["status"], flush=True)
    if result["status"] == "unavailable":
        raise SystemExit("No usable index data. Check source errors above; marked update as FAILED.")

if __name__ == "__main__":
    main()
