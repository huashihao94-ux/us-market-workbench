#!/usr/bin/env python3
"""Refresh name-first US listed ticker candidates from official SEC data.
No price or financial data is fabricated or fetched here.
"""
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "symbols.json"
URL = "https://www.sec.gov/files/company_tickers_exchange.json"
HEADERS = {
    "User-Agent": os.environ.get(
        "SEC_USER_AGENT",
        "IndividualStockResearch/1.0 (https://github.com/huashihao94-ux/us-market-workbench)"
    ),
    "Accept": "application/json",
}
def main():
    res = requests.get(URL, headers=HEADERS, timeout=55)
    res.raise_for_status()
    body = res.json()
    fields = body["fields"]
    if "name" not in fields or "ticker" not in fields:
        raise ValueError("SEC ticker file schema changed")
    name_i, ticker_i = fields.index("name"), fields.index("ticker")
    exchange_i = fields.index("exchange") if "exchange" in fields else None
    rows = []
    seen = set()
    for item in body["data"]:
        name, ticker = str(item[name_i]).strip(), str(item[ticker_i]).strip().upper()
        exchange = str(item[exchange_i]).strip() if exchange_i is not None else ""
        if not name or not ticker or ticker in seen:
            continue
        seen.add(ticker)
        rows.append([name, ticker, exchange])
    if len(rows) < 2500:
        raise ValueError(f"SEC ticker set unexpectedly small: {len(rows)}")
    rows.sort(key=lambda x: x[0].casefold())
    data = {
        "updatedAt": datetime.now(timezone.utc).date().isoformat(),
        "source": "SEC company_tickers_exchange.json",
        "rows": rows,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",",":")), encoding="utf-8")
    print("Saved", len(rows), "stock symbols")
if __name__ == "__main__":
    main()
