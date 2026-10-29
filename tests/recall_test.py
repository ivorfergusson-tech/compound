"""Course routes and the mandatory recall check, in the browser on a phone-sized screen. Serve the site first:
    python -m http.server 8765 --bind 127.0.0.1
then: python tests/recall_test.py [base_url] [screenshot_dir]
Checks the old Money links redirect, then that a module's quiz always starts with a fresh recall check,
the result shows both parts and the combined score, module 1 has none, and old passes stay passed.
"""
import json
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


def attempt(item_id, auto, out_of, passed, **extra):
    return {"uid": f"t{item_id}{auto}", "at": "2026-10-20T10:00:00Z", "day": "2026-10-20", "kind": "quiz", "id": item_id,
            "auto": auto, "claimed": 0, "outOf": out_of, "passed": passed, "autoPassed": passed,
            "missed": [], "wrong": [], "right": [], **extra}


def state(attempts):
    return {"v": 1, "nickname": None, "read": {}, "srs": {}, "notes": {}, "guesses": {}, "days": [], "attempts": attempts}


def answer_all(page, box, right):
    """Answers every question in the quiz runner inside box (a CSS selector). Returns how many."""
    for n in range(1, 40):
        card = page.locator(f"{box} .question").last
        q = page.evaluate("sel => { const b = document.querySelector(sel); const i = [...b.querySelectorAll('.dots span')].findIndex(s => s.classList.contains('now')); return b._questions[i]; }", box)
        t = q["type"]
        if t == "mcq":
            card.locator(f'.option[data-v="{q["answer"] if right else (q["answer"] + 1) % len(q["options"])}"]').click()
        elif t == "tf":
            card.locator(f'.option[data-v="{str(q["answer"] if right else not q["answer"]).lower()}"]').click()
        elif t == "number":
            card.locator("input").fill(str(q["answerValue"] if right else q["answerValue"] + 1000))
        elif t == "order":
            if right:
                page.evaluate("([sel, items]) => { const ol = document.querySelector(sel + ' .question:last-of-type .order') || document.querySelector(sel + ' .order'); for (const it of items) ol.append([...ol.children].find(li => li.dataset.item === it)); }", [box, q["items"]])
        elif t == "match":
            for left, r in q["pairs"]:
                sel = card.locator(f'select[data-left="{left}"]')
                sel.select_option(label=r) if right else sel.select_option(index=1)
        elif t == "explain":
            card.locator("textarea").fill(q["model"] if right else "I am not sure")
        card.locator(".check-btn").click()
        nxt = card.locator(".next-btn")
        label = nxt.inner_text()
        nxt.click()
        if "result" in label:
            return n
    return -1


def questions(page, box):
    return page.evaluate("sel => document.querySelector(sel)._questions", box)


def saved(page):
    return page.evaluate("JSON.parse(localStorage.getItem('compound.progress.v1'))")


def new_page(browser, progress):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx.add_init_script("if (!localStorage.getItem('compound.signup')) localStorage.setItem('compound.signup', 'dismissed')")  # sign-up pop-up already seen
    ctx.add_init_script(f"if (!localStorage.getItem('compound.progress.v1')) localStorage.setItem('compound.progress.v1', {json.dumps(json.dumps(progress))})")
    page = ctx.new_page()
    page.on("console", lambda m: m.type == "error" and "supabase" not in m.text.lower() and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    return ctx, page


def hash_after(page, route):
    page.goto(BASE + route)
    page.wait_for_function("() => !/^#\\/(m|cp|glossary)(\\/|\\?|$)/.test(location.hash)")
    page.wait_for_selector("main")
    return page.evaluate("location.hash")


with sync_playwright() as p:
    browser = p.chromium.launch()

    # Old Money links redirect to the course routes
    ctx, page = new_page(browser, state([]))
    check("#/m/01 redirects", hash_after(page, "#/m/01") == "#/c/money/m/01")
    page.wait_for_selector(".lesson-section")
    check("module 1 opens at its new route", page.locator(".lesson h1").count() == 1)
    check("#/cp/1 redirects", hash_after(page, "#/cp/1") == "#/c/money/cp/1")
    check("#/glossary keeps its query", hash_after(page, "#/glossary?t=isa") == "#/c/money/glossary?t=isa")
    page.goto(BASE + "#/?strand=money")
    page.wait_for_selector(".item")
    check("#/?strand= still filters", page.locator(".chip.on").inner_text().endswith("Money"))
    page.goto(BASE + "#/c/nope")
    page.wait_for_selector("main h1")
    check("unknown course is not found", "not found" in page.locator("main h1").inner_text().lower())
    page.goto(BASE + "#/c/money")
    page.wait_for_selector(".item")
    check("course home lists every item", page.locator(".item").count() > 30)
    check("cards link to course routes", page.locator('.item[href="#/c/money/m/01"]').count() == 1)

    # Module 1: nothing earlier to recall, the quiz starts straight away
    page.goto(BASE + "#/c/money/m/01")
    page.wait_for_selector("#quiz .btn")
    check("module 1 has no recall check", page.locator("#recall").count() == 0)
    page.locator("#quiz .btn").click()
    page.wait_for_selector("#quiz .question")
    check("module 1 quiz questions are its own", all(q["module"] == 1 for q in questions(page, "#quiz .quiz")))
    answer_all(page, "#quiz .quiz", right=True)
    res = page.locator("#quiz .result").inner_text()
    check("module 1 passes on the quiz alone", "Passed" in res and page.locator("#quiz .score-parts").count() == 0)
    check("module 1 attempt has no recall part", "recall" not in [a for a in saved(page)["attempts"] if a["kind"] == "quiz"][-1])
    ctx.close()

    # Module 2: the quiz can't start without a recall check, and both parts count
    ctx, page = new_page(browser, state([attempt("01", 7, 7, True)]))
    page.goto(BASE + "#/c/money/m/02")
    page.wait_for_selector("#recall .recall-intro")
    check("recall check sits before the lesson", page.evaluate("document.querySelector('#recall').compareDocumentPosition(document.querySelector('.lesson-section')) & 4") > 0)
    check("no skip-and-forget: recall says it counts", "count towards" in page.locator("#recall").inner_text())
    check("quiz rule mentions both parts", "across both parts" in page.locator(".quiz-rule").inner_text())
    btn = page.locator("#quiz .quiz .btn")
    check("quiz button starts the recall check", "recall" in btn.inner_text().lower())
    btn.click()
    page.wait_for_selector("#quiz .question")
    rq = questions(page, "#quiz .quiz")
    check("recall questions come from earlier modules", len(rq) == 4 and all(q["module"] < 2 for q in rq))
    answer_all(page, "#quiz .quiz", right=False)
    check("recall result offers part 2", page.locator("#quiz .go-quiz").count() == 1)
    check("top recall now shows done", "Recall check done" in page.locator("#recall").inner_text())
    page.locator("#quiz .go-quiz").click()
    page.wait_for_selector("#quiz .question")
    check("part 2 is module 2's quiz", all(q["module"] == 2 for q in questions(page, "#quiz .quiz")))
    n = answer_all(page, "#quiz .quiz", right=True)
    res = page.locator("#quiz .result")
    parts = res.locator(".score-parts").inner_text()
    check("result shows recall, quiz and together", "Recall check" in parts and "Module 2 quiz" in parts and "Together" in parts)
    res.screenshot(path=str(SHOTS / "recall-quiz-result.png"))
    a = [x for x in saved(page)["attempts"] if x["kind"] == "quiz" and x["id"] == "02"][-1]
    check("attempt stores the recall part", a.get("recall", {}).get("outOf") == 4 and a["recall"]["auto"] == 0)
    check("together pools the marks", f"{a['auto'] + a['claimed']} of {a['outOf'] + 4}" in parts.split("Together")[1])
    check("quiz part is the quiz alone", a["outOf"] == sum(q.get("marks", 1) for q in questions(page, "#quiz .quiz")) and n == len(questions(page, "#quiz .quiz")))
    want = (a["auto"] + a["claimed"]) / (a["outOf"] + 4) >= 0.6
    check("pass worked out from both parts", a["passed"] == want)
    check("top recall resets for the next try", page.locator("#recall .recall-intro").count() == 1)
    res.locator(".retry").click()
    page.wait_for_selector("#quiz .question")
    check("retry starts with a fresh recall check", all(q["module"] < 2 for q in questions(page, "#quiz .quiz")))

    # Doing the recall check at the top lets the quiz start straight away
    page.goto(BASE + "#/c/money")
    page.wait_for_selector(".item")
    page.goto(BASE + "#/c/money/m/02")
    page.wait_for_selector("#recall .start-recall")
    page.locator("#recall .start-recall").click()
    page.wait_for_selector("#recall .question")
    answer_all(page, "#recall", right=True)
    check("top recall result stays on screen", page.locator("#recall .result").count() == 1)
    check("quiz intro says recall is done", "Recall check done (4 of 4)" in page.locator("#quiz .quiz").inner_text())
    page.reload()
    page.wait_for_selector("#quiz .quiz .btn")
    check("a done recall check survives a refresh", "Recall check done" in page.locator("#recall").inner_text())
    page.locator("#quiz .quiz .btn").click()
    page.wait_for_selector("#quiz .question")
    check("quiz starts straight away after it", all(q["module"] == 2 for q in questions(page, "#quiz .quiz")))
    check("no sideways scroll", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
    ctx.close()

    # Passes from before the rule stay passed
    ctx, page = new_page(browser, state([attempt("01", 7, 7, True), attempt("02", 5, 8, True)]))
    page.goto(BASE + "#/c/money")
    page.wait_for_selector(".item")
    check("old module 2 pass kept", "Passed" in page.locator('.item[href="#/c/money/m/02"]').inner_text())
    check("module 3 open after old pass", page.locator('.item[href="#/c/money/m/03"]').count() == 1)
    ctx.close()
    browser.close()

check("no console errors", not errors)
if errors:
    print("\n".join(errors))
print(f"{len(fails)} failed")
sys.exit(1 if fails else 0)
