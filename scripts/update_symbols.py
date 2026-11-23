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

def main():
    body = fetch()
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
