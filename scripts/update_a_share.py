#!/usr/bin/env python3
"""Build public A-share stock name index and close quote cache for GitHub Pages.

Eastmoney public clist is best-effort; do not invent dividend yield.
Keep prior cache if all data sources fail. Currency of price = CNY.
"""
import json
import time
from datetime import datetime,timezone
from pathlib import Path
import requests

ROOT=Path(__file__).resolve().parents[1]
FILE=ROOT/"a_share_data.json"
URL="https://push2.eastmoney.com/api/qt/clist/get"
HEADERS={"User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/127.0.0.0 Safari/537.36",
         "Referer":"https://quote.eastmoney.com/center/gridlist.html",
         "Accept":"application/json,*/*"}
def validprice(x):
    try:
        n=float(x)
        return round(n,3) if n>0 and n<1000000 else None
    except (TypeError,ValueError):
        return None
def fetch_eastmoney():
    all_rows={}
    last_total=0
    for pn in range(1,95):
        params={"pn":pn,"pz":100,"po":1,"np":1,"ut":"bd1d9ddb04089700cf9c27f6f7426281",
                "fltt":2,"invt":2,"fid":"f3",
                "fs":"m:0+t:6,m:0+t:80,m:0+t:81,m:1+t:2,m:1+t:23",
                "fields":"f12,f13,f14,f2"}
        r=requests.get(URL,params=params,headers=HEADERS,timeout=25)
        r.raise_for_status()
        data=(r.json().get("data") or {})
        rows=data.get("diff") or []
        if isinstance(rows,dict):rows=list(rows.values())
        if not rows:break
        for x in rows:
            code=str(x.get("f12","")).strip()
            if len(code)!=6 or not code.isdigit():continue
            name=str(x.get("f14") or "").strip()
            if not name:continue
            market=str(x.get("f13") or "")
            exchange="SH" if market=="1" else "SZ" if market=="0" else "BJ"
            p=validprice(x.get("f2"))
            today=datetime.now(timezone.utc).date().isoformat()
            all_rows[code]={"code":code,"name":name,"exchange":exchange,
                            "price":p,"priceDate":today if p else None}
        total=data.get("total")
        try:last_total=int(total)
        except (TypeError,ValueError):pass
        print("page",pn,"new stock count",len(all_rows),flush=True)
        if len(rows)<100 or (last_total and len(all_rows)>=last_total):break
        time.sleep(0.22)
    if len(all_rows)<2500:raise ValueError(f"Eastmoney returned only {len(all_rows)} stocks (expected >2500)")
    return list(sorted(all_rows.values(),key=lambda x:x["code"])), "Eastmoney public clist (prices may be intraday/delayed)"

def main():
    prior=json.loads(FILE.read_text("utf-8")) if FILE.exists() else {"rows":[]}
    try:
        rows,source=fetch_eastmoney()
        out={"updatedAt":datetime.now(timezone.utc).isoformat(),"source":source,"status":"ok","rows":rows}
        FILE.write_text(json.dumps(out,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
        print("Saved",len(rows),"A shares")
    except Exception as exc:
        print("WARNING: A share data refresh failed:",repr(exc),flush=True)
        if not prior.get("rows"):raise
        # Preserve old names and old price dates; don't mark cache newly updated.
        print("Preserving",len(prior["rows"]),"old records",flush=True)

if __name__=="__main__":
    main()
