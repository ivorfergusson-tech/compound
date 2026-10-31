"""Checks every past paper link still responds. Run: python tools/check_papers.py"""
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

data = json.loads((Path(__file__).parent.parent / "content" / "courses" / "econ-aqa" / "papers.json").read_text(encoding="utf8"))
bad = n = 0
for p in data["papers"]:
    for kind in ("qp", "ms", "insert"):
        url = p.get(kind)
        if not url:
            continue
        n += 1
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Compound link check)", "Range": "bytes=0-0"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                ok = r.status in (200, 206)
        except (urllib.error.URLError, TimeoutError) as e:
            ok = False
            print("BAD", p["id"], kind, getattr(e, "code", e))
        bad += 0 if ok else 1
        time.sleep(0.3)
print(f"{n} links, {bad} bad")
sys.exit(1 if bad else 0)
