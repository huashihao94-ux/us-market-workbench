#!/usr/bin/env python3
"""Update all searchable SEC exchange-listed company names, tickers and CIKs.

Source: https://www.sec.gov/files/company_tickers_exchange.json
User-Agent can be overridden by a repository SEC_USER_AGENT secret. Keeps
previous file intact when the SEC endpoint is unavailable.
"""
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from requests import Session

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "symbols.json"
SEC = "https://www.sec.gov/files/company_tickers_exchange.json"
UA = os.environ.get("SEC_USER_AGENT") or "StockPoolResearch huashihao94-ux@users.noreply.github.com"
session = Session()
session.headers.update({"User-Agent": UA, "Accept": "application/json", "Accept-Encoding": "gzip, deflate"})

def fetch():
    for attempt in range(3):
        try:
            resp = session.get(SEC, timeout=60)
            if resp.status_code in {403, 429, 500, 502, 503, 504}:
                raise RuntimeError(f"SEC HTTP {resp.status_code}")
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            if attempt == 2:
                raise
            print(f"SEC directory attempt {attempt + 1} failed: {exc}", flush=True)
            time.sleep(2 * (attempt + 1))

def github_fallback():
    """Fallback for name search if SEC main directory is temporarily blocked.
    This mirror uses Nasdaq's screeners; CIK may be unavailable.
    """
    base = "https://raw.githubusercontent.com/e1001925/Improved-US-Stock-Symbols/main"
    prior = {}
    try:
        cached = json.loads(OUT.read_text(encoding="utf-8"))
        prior = {r[1].upper():r[3] for r in cached.get("rows",[]) if len(r)>3}
    except (OSError,ValueError):
        pass
    merged = {}
    for exchange in ("nasdaq", "nyse", "amex"):
        url = f"{base}/{exchange}/{exchange}_full_tickers.json"
        res = session.get(url, timeout=65)
        res.raise_for_status()
        data = res.json()
        if isinstance(data,dict):
            data = data.get("data",{}).get("rows",[]) or data.get("rows",[])
        if not isinstance(data,list):
            raise ValueError(f"Unexpected {exchange} format")
        for item in data:
            if not isinstance(item,dict):
                continue
            sym = str(item.get("symbol") or item.get("ticker") or "").strip().upper()
            name = str(item.get("name") or item.get("companyName") or "").strip()
            if not sym or not name:
                continue
            merged[sym] = [name, sym, exchange.upper(), prior.get(sym)]
    if len(merged)<2500:
        raise ValueError(f"Fallback directory too small: {len(merged)}")
    return sorted(merged.values(), key=lambda x:x[0].casefold())

def main():
    try:
        body = fetch()
    except Exception as exc:
        print("Official SEC directory unavailable:",str(exc)[:150],flush=True)
        rows = github_fallback()
        out = {"updatedAt": datetime.now(timezone.utc).date().isoformat(),
               "source": "GitHub e1001925/Improved-US-Stock-Symbols (Nasdaq mirror, CIK may be absent)",
               "rows": rows}
        OUT.write_text(json.dumps(out,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
        print(f"Saved fallback {len(rows)} ticker names",flush=True)
        return

    fields = body["fields"]
    name_i, ticker_i = fields.index("name"), fields.index("ticker")
    exchange_i = fields.index("exchange") if "exchange" in fields else None
    cik_i = fields.index("cik") if "cik" in fields else None
    rows, seen = [], set()
    for item in body["data"]:
        name, ticker = str(item[name_i]).strip(), str(item[ticker_i]).strip().upper()
        exchange = str(item[exchange_i]).strip() if exchange_i is not None else ""
        cik = int(item[cik_i]) if cik_i is not None and item[cik_i] else None
        if not name or not ticker or ticker in seen:
            continue
        seen.add(ticker)
        rows.append([name, ticker, exchange, cik])
    if len(rows) < 2500:
        raise ValueError(f"SEC ticker set unexpectedly small: {len(rows)}")
    rows.sort(key=lambda x: x[0].casefold())
    out = {"updatedAt": datetime.now(timezone.utc).date().isoformat(),
           "source": "SEC company_tickers_exchange.json", "rows": rows}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Saved {len(rows)} tickers with CIK mapping", flush=True)

if __name__ == "__main__":
    main()
