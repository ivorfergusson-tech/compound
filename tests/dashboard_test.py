"""The dashboard (#/) in the browser: continue, course cards, refresh knowledge and the exam countdown.
Serve the site first:
    python -m http.server 8765 --bind 127.0.0.1
then: python tests/dashboard_test.py [base_url] [screenshot_dir]
"""
import json
import sys
from datetime import date, timedelta
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/"
SHOTS = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(".tmp/shots")
SHOTS.mkdir(parents=True, exist_ok=True)
ROOT = Path(__file__).resolve().parent.parent
AXE = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js"
errors, fails = [], []


def check(name, cond):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        fails.append(name)


def new_page(browser, progress=None, width=390, extra_init=None):
    ctx = browser.new_context(viewport={"width": width, "height": 844}, device_scale_factor=2, is_mobile=width < 600, has_touch=width < 600)
    ctx.add_init_script("if (!localStorage.getItem('compound.signup')) localStorage.setItem('compound.signup', 'dismissed')")
    if progress is not None:
        ctx.add_init_script(f"if (!localStorage.getItem('compound.progress.v1')) localStorage.setItem('compound.progress.v1', {json.dumps(json.dumps(progress))})")
    if extra_init:
        ctx.add_init_script(extra_init)
    page = ctx.new_page()
    page.on("console", lambda m: m.type == "error" and "supabase" not in m.text.lower() and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    return ctx, page


def axe(page, label):
    page.add_script_tag(url=AXE)
    res = page.evaluate("""async () => {
      const r = await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] });
      return r.violations.filter(v => ['serious', 'critical'].includes(v.impact)).map(v => v.id + ' (' + v.impact + '): ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | '));
    }""")
    check(f"axe: no serious issues on {label}", not res)
    for r in res:
        print("     " + r)


def answer_all_right(page):
    for _ in range(20):
        card = page.locator(".quiz .question").last
        q = page.evaluate("() => { const b = document.querySelector('.quiz'); const i = [...b.querySelectorAll('.dots span')].findIndex(s => s.classList.contains('now')); return b._questions[i]; }")
        t = q["type"]
        if t == "mcq":
            card.locator(f'.option[data-v="{q["answer"]}"]').click()
        elif t == "tf":
            card.locator(f'.option[data-v="{str(q["answer"]).lower()}"]').click()
        elif t == "number":
            card.locator("input").fill(str(q["answerValue"]))
        elif t == "order":
            page.evaluate("items => { const ol = document.querySelector('.quiz .order'); for (const it of items) ol.append([...ol.children].find(li => li.dataset.item === it)); }", q["items"])
        elif t == "match":
            for left, r in q["pairs"]:
                card.locator(f'select[data-left="{left}"]').select_option(label=r)
        card.locator(".check-btn").click()
        nxt = card.locator(".next-btn")
        label = nxt.inner_text()
        nxt.click()
        if "result" in label:
            return


def no_sideways(page):
    return page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")


today = date.today()
iso = lambda d: d.isoformat()
quiz1 = json.loads((ROOT / "content/courses/money/quizzes/01.json").read_text(encoding="utf-8"))["questions"]
quick = [q for q in quiz1 if q["type"] != "explain"][:3]
started = {
    "v": 1, "nickname": None,
    "read": {"00": "2026-10-20T10:00:00Z", "01": "2026-10-21T10:00:00Z"},
    "attempts": [{
        "uid": "11111111-1111-4111-8111-111111111111", "at": "2026-10-21T11:00:00Z", "day": "2026-10-21", "kind": "quiz", "id": "01",
        "auto": 2, "claimed": 0, "outOf": 8, "passed": False, "autoPassed": False,
        "missed": [q["topic"] for q in quick], "wrong": [q["id"] for q in quick], "right": [],
    }],
    "srs": {q["id"]: {"box": 0, "due": iso(today - timedelta(days=k)), "module": 1, "misses": 1, "at": "2026-10-21T11:00:00Z"} for k, q in enumerate(quick)},
    "notes": {}, "guesses": {}, "days": ["2026-10-20", "2026-10-21"],
}

with sync_playwright() as p:
    browser = p.chromium.launch()

    # A new learner: start here, course cards, no refresh yet, the exam form open
    ctx, page = new_page(browser)
    page.goto(BASE)
    page.wait_for_selector(".course-card")
    check("dashboard at #/", page.locator(".dash-title").inner_text() == "Your dashboard")
    hero = page.locator(".hero.continue")
    check("new learner: start here", "start here" in hero.inner_text().lower() and hero.locator('a[href="#/c/money/m/00"]').count() == 1)
    money = page.locator('a.course-card[href="#/c/money"]')
    check("Money card with a % bar", money.count() == 1 and "0%" in money.inner_text() and money.locator('[role=progressbar][aria-valuenow="0"]').count() == 1)
    soon = page.locator(".course-card.soon")
    check("A-levels shown as coming soon", soon.count() == 2 and "AQA · 7136" in soon.nth(0).inner_text() and "AQA · 7132" in soon.nth(1).inner_text() and "Coming soon" in soon.nth(0).inner_text())
    check("no refresh card before any misses", page.locator(".refresh-card").count() == 0)
    check("exam form open when there are no exams", page.locator(".add-exam[open]").count() == 1)
    check("no sideways scroll on the dashboard", no_sideways(page))
    page.screenshot(path=str(SHOTS / "dashboard-new.png"), full_page=True)
    money.click()
    page.wait_for_selector(".item")
    check("course card opens the Money map", page.evaluate("location.hash") == "#/c/money" and page.locator(".back-link").count() == 1)
    page.locator(".back-link").click()
    page.wait_for_selector(".dash-title")
    check("back link returns to the dashboard", page.evaluate("location.hash") == "#/")
    page.goto(BASE + "#/refresh")
    page.wait_for_selector(".quiz .card")
    check("refresh with nothing missed says so", "Nothing to refresh" in page.locator(".quiz").inner_text())
    ctx.close()

    # Someone part way: continue, refresh, exams and a plan
    ctx, page = new_page(browser, started)
    page.goto(BASE)
    page.wait_for_selector(".refresh-card")
    hero = page.locator(".hero.continue")
    check("continue where you left off", "continue where you left off" in hero.inner_text().lower() and hero.locator('a[href="#/c/money/m/01"]').count() == 1)
    check("continue shows the best score", "25%" in hero.inner_text())
    rc = page.locator(".refresh-card")
    check("refresh card counts what's due", "3 due" in rc.inner_text())

    # exams
    form = page.locator(".exam-form")
    page.locator(".add-exam summary").click() if page.locator(".add-exam[open]").count() == 0 else None
    form.locator(".btn").click()
    check("exam needs a name", "name" in page.locator(".exam-msg").inner_text())
    form.locator("input[name=name]").fill("Economics mock")
    form.locator(".btn").click()
    check("exam needs a date", "date" in page.locator(".exam-msg").inner_text())
    form.locator("input[name=date]").fill(iso(today - timedelta(days=2)))
    form.locator(".btn").click()
    check("past date refused", "passed" in page.locator(".exam-msg").inner_text())
    form.locator("input[name=date]").fill(iso(today + timedelta(days=38)))
    form.locator(".btn").click()
    page.wait_for_selector(".exam-list .exam")
    ex = page.locator(".exam-list .exam").first
    check("exam added with days left", "Economics mock" in ex.inner_text() and "38" in ex.locator(".days").inner_text())
    saved = page.evaluate("JSON.parse(localStorage.getItem('compound.exams'))")
    check("exam saved in this browser", saved["list"][0]["name"] == "Economics mock" and saved["list"][0]["date"] == iso(today + timedelta(days=38)) and saved["updatedAt"])
    plan = page.locator(".plan")
    check("plan for the soonest exam", "This week, for Economics mock" in plan.inner_text() and "6 weeks to go" in plan.inner_text())
    check("plan: refresh first", plan.locator("li").first.locator('a[href="#/refresh"]').count() == 1)
    check("plan: retake the weak module", "Retake" in plan.inner_text() and plan.locator('a[href="#/c/money/m/01"]').count() >= 1 and "best 25%" in plan.inner_text())
    check("plan: weakest topics", "Go back over" in plan.inner_text() and quick[0]["topic"] in plan.inner_text())
    form = page.locator(".exam-form")
    if page.locator(".add-exam[open]").count() == 0:
        page.locator(".add-exam summary").click()
    form.locator("input[name=name]").fill("Physics Paper 1")
    form.locator("input[name=date]").fill(iso(today + timedelta(days=5)))
    form.locator(".btn").click()
    page.wait_for_selector(".exam-list .exam >> nth=1")
    check("soonest exam first", "Physics Paper 1" in page.locator(".exam-list .exam").first.inner_text())
    check("close exam highlighted", page.locator(".exam-list .exam.close").count() == 1)
    check("plan follows the soonest", "for Physics Paper 1" in page.locator(".plan").inner_text() and "every day" in page.locator(".plan").inner_text())
    check("no sideways scroll with exams", no_sideways(page))
    page.screenshot(path=str(SHOTS / "dashboard-started.png"), full_page=True)
    axe(page, "the dashboard with exams and a plan")
    page.locator('.exam-list .remove[aria-label="Remove Physics Paper 1"]').click()
    page.wait_for_timeout(200)
    check("exam removed", page.locator(".exam-list .exam").count() == 1 and "Physics" not in page.locator(".exams").inner_text())
    page.reload()
    page.wait_for_selector(".exam-list .exam")
    check("exams kept after reload", "Economics mock" in page.locator(".exam-list").inner_text())

    # refresh knowledge
    page.locator('.refresh-card a[href="#/refresh"]').click()
    page.wait_for_selector(".quiz .card .btn")
    check("refresh page says what's due", "3 due today" in page.locator(".quiz").inner_text())
    axe(page, "refresh knowledge")
    page.locator(".quiz .card .btn").click()
    page.wait_for_selector(".quiz .question")
    asked = page.evaluate("() => document.querySelector('.quiz')._questions.map(q => q.id)")
    check("refresh asks the missed questions, oldest due first", asked == [quick[2]["id"], quick[1]["id"], quick[0]["id"]])
    answer_all_right(page)
    res = page.locator(".result")
    check("refresh result", "3 of 3 right" in res.inner_text() and "+25 XP" in res.inner_text())
    st = page.evaluate("JSON.parse(localStorage.getItem('compound.progress.v1'))")
    last = st["attempts"][-1]
    check("stored as a refresh recall set", last["kind"] == "recall" and last["id"] == "rf" and last["auto"] == 3)
    check("right answers move on a box", all(st["srs"][q["id"]]["box"] == 1 and st["srs"][q["id"]]["due"] > iso(today) for q in quick))
    page.goto(BASE)
    page.wait_for_selector(".refresh-card")
    check("nothing due after a refresh", "Nothing due today" in page.locator(".refresh-card").inner_text())
    check("plan drops refresh when nothing's due", page.locator('.plan a[href="#/refresh"]').count() == 0)
    ctx.close()

    # Desktop width, both themes
    for theme in ("dark", "light"):
        ctx, page = new_page(browser, started, width=1200, extra_init=f"localStorage.setItem('compound.theme', '{theme}')")
        page.goto(BASE)
        page.wait_for_selector(".refresh-card")
        page.wait_for_timeout(300)
        page.screenshot(path=str(SHOTS / f"dashboard-desktop-{theme}.png"), full_page=True)
        axe(page, f"the dashboard on desktop ({theme})")
        ctx.close()
    browser.close()

check("no console errors", not errors)
if errors:
    print("\n".join(errors[:10]))
print(f"{len(fails)} failed")
sys.exit(1 if fails else 0)
