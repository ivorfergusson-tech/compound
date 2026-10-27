"""Renders every ready module on a phone-sized screen with everything unlocked.
Checks for script errors, blocks that failed to load, calculators that didn't draw, and sideways scrolling.
Serve the site first (python -m http.server 8765 --bind 127.0.0.1), then: python tests/render_all.py [base] [shots dir]
"""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/"
SHOTS = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(".tmp/shots")
SHOTS.mkdir(parents=True, exist_ok=True)
course = json.loads((Path(__file__).parent.parent / "content" / "course.json").read_text(encoding="utf-8"))

# Every module and checkpoint passed, so nothing is locked.
unlock = {"v": 1, "nickname": None, "read": {}, "srs": {}, "notes": {}, "guesses": {}, "days": [], "attempts": [
    {"uid": f"t{i['id']}", "at": "2026-10-27T10:00:00Z", "day": "2026-10-27", "kind": "checkpoint" if i["kind"] == "checkpoint" else "quiz",
     "id": i["id"], "auto": 8, "claimed": 0, "outOf": 8, "passed": True, "autoPassed": True, "missed": [], "wrong": [], "right": []}
    for i in course["items"] if i["kind"] != "intro"]}

fails = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    for scheme in ("light", "dark"):
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, color_scheme=scheme)
        ctx.add_init_script(f"localStorage.setItem('compound.progress.v1', {json.dumps(json.dumps(unlock))})")
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and "supabase" not in m.text.lower() and errors.append(m.text))
        for mid in course["ready"]:
            errors.clear()
            page.goto(f"{BASE}#/m/{mid}")
            page.wait_for_selector(".lesson-section", timeout=15000)
            page.wait_for_timeout(400)
            calcs = page.locator(".calc").count()
            empty = page.evaluate("[...document.querySelectorAll('.calc .stat strong')].filter(e => !e.textContent.trim()).length")
            broken = page.locator("text=This part didn't load").count()
            missing = page.locator("text=[missing figure").count()
            wide = page.evaluate("document.documentElement.scrollWidth > window.innerWidth")
            ok = not errors and not broken and not missing and not wide and not empty
            print(f"{'ok  ' if ok else 'FAIL'} [{scheme}] {mid}: {calcs} calculators, {page.locator('.question').count()} quick checks"
                  + (f" | errors {errors}" if errors else "") + (" | block failed" if broken else "") + (" | missing figure" if missing else "")
                  + (" | sideways scroll" if wide else "") + (f" | {empty} empty results" if empty else ""))
            if not ok:
                fails.append(f"{scheme} {mid}")
            if scheme == "light":
                page.screenshot(path=str(SHOTS / f"m{mid}.png"), full_page=True)
        ctx.close()
    browser.close()
print(f"{len(fails)} failed")
sys.exit(1 if fails else 0)
