"""Browser test on a phone-sized screen. Serve the site first:
    python -m http.server 8765 --bind 127.0.0.1
then: python tests/browser_test.py [base_url] [screenshot_dir]
Fails a module 1 quiz, checks module 2 stays locked, passes it, checks module 2 unlocks.
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/"
SHOTS = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(".tmp/shots")
SHOTS.mkdir(parents=True, exist_ok=True)
errors, fails = [], []


def check(name, cond):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        fails.append(name)


def answer_all(page, right):
    """Answers every question in the module quiz, right or wrong."""
    for _ in range(20):
        card = page.locator(".quiz .question").last
        q = page.evaluate("() => { const b = document.querySelector('.quiz'); const n = b.querySelectorAll('.dots span').length; const i = [...b.querySelectorAll('.dots span')].findIndex(s => s.classList.contains('now')); return b._questions[i]; }")
        t = q["type"]
        if t == "mcq":
            v = q["answer"] if right else (q["answer"] + 1) % len(q["options"])
            card.locator(f'.option[data-v="{v}"]').click()
        elif t == "tf":
            v = q["answer"] if right else not q["answer"]
            card.locator(f'.option[data-v="{str(v).lower()}"]').click()
        elif t == "number":
            card.locator("input").fill(str(q["answerValue"] if right else q["answerValue"] + 1000))
        elif t == "order":
            if right:
                page.evaluate("items => { const ol = document.querySelector('.quiz .question:last-of-type .order') || document.querySelector('.quiz .order'); for (const it of items) ol.append([...ol.children].find(li => li.dataset.item === it)); }", q["items"])
        elif t == "match":
            for left, r in q["pairs"]:
                sel = card.locator(f'select[data-left="{left}"]')
                if right:
                    sel.select_option(label=r)
                else:
                    sel.select_option(index=1)
        elif t == "explain":
            card.locator("textarea").fill(q["model"] if right else "I am not sure")
        card.locator(".check-btn").click()
        nxt = card.locator(".next-btn")
        label = nxt.inner_text()
        nxt.click()
        if "result" in label:
            return


with sync_playwright() as p:
    browser = p.chromium.launch()
    for scheme in ("light", "dark"):
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, color_scheme=scheme, is_mobile=True, has_touch=True)
        page = ctx.new_page()
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(BASE)
        page.wait_for_selector(".item")
        page.screenshot(path=str(SHOTS / f"home-{scheme}.png"), full_page=True)
        check(f"[{scheme}] module 2 locked at start", "Pass module 1" in page.locator(".item.locked").first.inner_text())
        check(f"[{scheme}] no horizontal scroll", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))

        page.goto(BASE + "#/m/01")
        page.wait_for_selector(".calc")
        check(f"[{scheme}] 3 calculators + 1 chart", page.locator(".calc").count() == 4)
        check(f"[{scheme}] quick checks", page.locator(".question").count() >= 5)
        check(f"[{scheme}] figure chips", page.locator(".fig-chip").count() >= 4)
        check(f"[{scheme}] no horizontal scroll on module", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
        page.locator(".term").first.click()
        check(f"[{scheme}] glossary popover", page.locator(".popover").is_visible())
        page.screenshot(path=str(SHOTS / f"module-top-{scheme}.png"))
        page.locator(".calc").first.scroll_into_view_if_needed()
        page.locator('.calc input[data-in="y"]').first.fill("40")
        check(f"[{scheme}] calculator updates", "8,724.55" in page.locator(".calc").first.inner_text())
        page.locator(".calc").first.screenshot(path=str(SHOTS / f"calc-{scheme}.png"))

        if scheme == "light":
            # quick check
            qc = page.locator(".question").first
            qc.locator('.option[data-v="1"]').click()
            qc.locator(".check-btn").click()
            check("quick check marks right", "Correct" in qc.inner_text())
            # reading to the end marks it read
            page.locator("#own-words").scroll_into_view_if_needed()
            page.mouse.wheel(0, 400)
            page.wait_for_timeout(300)
            check("module read recorded", page.evaluate("JSON.parse(localStorage.getItem('compound.progress.v1')).read['01'] !== undefined"))
            page.locator(".own-words textarea").fill("Interest is the price of money.")
            page.wait_for_timeout(1000)
            # fail the quiz
            page.locator("#quiz .btn").click()
            answer_all(page, right=False)
            res = page.locator(".result")
            check("fail shows Not yet", "Not yet" in res.inner_text())
            res.screenshot(path=str(SHOTS / "quiz-fail.png"))
            page.goto(BASE + "#/")
            page.wait_for_selector(".item")
            check("module 2 still locked after fail", page.locator(".item.locked").count() > 30)
            # pass with new questions (retry)
            page.goto(BASE + "#/m/01")
            page.wait_for_selector("#quiz .btn")
            page.locator("#quiz .btn").click()
            answer_all(page, right=True)
            res = page.locator(".result")
            check("pass shows Passed", "Passed" in res.inner_text())
            res.screenshot(path=str(SHOTS / "quiz-pass.png"))
            page.goto(BASE + "#/")
            page.wait_for_selector(".item")
            st = page.locator(".item").nth(2).inner_text()
            check("module 2 no longer locked (Soon until written)", "Soon" in st or "Start" in st)
            page.screenshot(path=str(SHOTS / "home-after-pass.png"), full_page=True)
            # explain question claim
            page.goto(BASE + "#/glossary")
            page.wait_for_selector(".g-item")
            page.locator(".search input").fill("inflation")
            check("glossary search", page.locator(".g-item:not([hidden])").count() >= 1)
            for route in ("#/about", "#/account", "#/leaderboard"):
                page.goto(BASE + route)
                page.wait_for_timeout(400)
                page.screenshot(path=str(SHOTS / f"{route[2:]}.png"), full_page=True)
        ctx.close()
    browser.close()

check("no console errors", not errors)
for e in errors:
    print("  ", e)
print(f"{len(fails)} failed")
sys.exit(1 if fails else 0)
