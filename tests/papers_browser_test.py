"""Past papers in the browser with a faked signed-in session: next paper, logging marks, the gallery, consolidation.

The real rules are tested by tools/papers_test.mjs. Run: python tests/papers_browser_test.py
"""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/"
SHOTS = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(".tmp/shots")
SHOTS.mkdir(parents=True, exist_ok=True)
AXE = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js"
fails, errors = [], []
USER = "00000000-0000-4000-8000-000000000009"
AID = "66666666-0000-4000-8000-000000000001"
SESSION = {"access_token": "x.y.z", "refresh_token": "r", "token_type": "bearer", "expires_in": 360000, "expires_at": 4102444800,
           "user": {"id": USER, "email": "s@example.com", "aud": "authenticated", "app_metadata": {}, "user_metadata": {}, "created_at": "2026-01-01T00:00:00Z"}}


def check(name, cond, extra=""):
    print(("ok   " if cond else "FAIL ") + name + (f"  ({extra})" if extra and not cond else ""))
    if not cond:
        fails.append(name)


class Fake:
    def __init__(self):
        self.attempts = []
        self.reserved = []
        self.logged = None
        self.cons = None

    def rpc(self, name, a):
        if name == "my_papers":
            return self.attempts
        if name == "my_reserved_papers":
            return [{"paper_id": p} for p in self.reserved]
        if name == "log_paper":
            self.logged = a
            got = sum(i["got"] for i in a["p_items"])
            of = sum(i["out_of"] for i in a["p_items"])
            self.attempts.insert(0, {"id": AID, "paper_id": a["p_paper"], "done_on": a["p_done"], "items": a["p_items"], "got": got, "out_of": of, "cons_got": 0, "cons_of": 0})
            return AID
        if name == "set_consolidation":
            self.cons = a
            return None
        return []


def new_page(browser, fake, width=1200):
    ctx = browser.new_context(viewport={"width": width, "height": 900})
    ctx.add_init_script("localStorage.setItem('compound.signup', 'done');"
                        f"localStorage.setItem('sb-zxmvhufnxdpzzabeuxkr-auth-token', {json.dumps(json.dumps(SESSION))});")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))

    def rest(route):
        url = route.request.url
        if "/rpc/" in url:
            name = url.split("/rpc/")[1].split("?")[0]
            return route.fulfill(status=200, content_type="application/json", body=json.dumps(fake.rpc(name, json.loads(route.request.post_data or "{}"))))
        if "/profiles" in url:
            return route.fulfill(status=200, content_type="application/json", body=json.dumps([{"user_id": USER, "nickname": "Alpha", "nickname_changed_at": None, "nickname_must_change": False}]))
        return route.fulfill(status=201 if route.request.method in ("POST", "PATCH") else 200, content_type="application/json", body="[]")

    page.route("**/rest/v1/**", rest)
    return ctx, page


def axe(page, name):
    page.add_script_tag(url=AXE)
    page.wait_for_function("window.axe")
    bad = page.evaluate("axe.run({ resultTypes: ['violations'] }).then(r => r.violations.filter(v => ['serious','critical'].includes(v.impact)).map(v => v.id))")
    check(f"axe: no serious issues on {name}", not bad, bad)


with sync_playwright() as p:
    browser = p.chromium.launch()
    fake = Fake()
    ctx, page = new_page(browser, fake)
    page.goto(BASE + "#/c/econ-aqa")
    page.wait_for_selector(".papers-link")
    page.locator(".papers-link").click()
    page.wait_for_selector(".paper-day")
    text = page.locator("main").inner_text()
    check("the next paper is the oldest", "June 2017, Paper 1" in text, text[:300])
    check("the source is shown", "Physics & Maths Tutor" in text and "don't host" in text)
    check("it asks for 3 papers before a grade", "Log 3 papers" in text)
    check("all 30 papers are listed", page.locator(".roster tbody tr").count() == 30)
    check("links go off the site", page.locator(".roster a.btn").first.get_attribute("href").startswith("https://"))
    page.screenshot(path=str(SHOTS / "papers.png"), full_page=True)
    axe(page, "the past papers page")

    # Reserved papers disappear
    fake.reserved = ["E-J17-P1"]
    page.reload()
    page.wait_for_selector(".paper-day")
    check("a reserved paper isn't next", "June 2017, Paper 2" in page.locator("main").inner_text() or "Paper 2" in page.locator("main").inner_text())
    check("nor listed", page.locator(".roster tbody tr").count() == 29)
    fake.reserved = []
    page.select_option(".paper-day", "Sunday")
    page.reload()
    page.wait_for_selector(".paper-day")
    check("the paper day is remembered", page.input_value(".paper-day") == "Sunday")

    # Logging marks
    page.locator("a.btn", has_text="Log marks").first.click()
    page.wait_for_selector(".log-form")
    rows = page.locator(".log-table tbody tr")
    rows.nth(0).locator("[name=got]").fill("5")
    rows.nth(0).locator("[name=out]").fill("4")
    page.locator(".log-form button.btn:not(.ghost)").click()
    check("marks over the top are stopped", "Check question 1" in page.locator(".auth-msg").inner_text() and not fake.logged)
    rows.nth(0).locator("[name=got]").fill("1")
    rows.nth(0).locator("[name=out]").fill("4")
    rows.nth(0).locator("[name=spec]").select_option("4.1.1")
    rows.nth(1).locator("[name=got]").fill("8")
    rows.nth(1).locator("[name=out]").fill("25")
    rows.nth(1).locator("[name=spec]").select_option("4.1.2")
    page.locator(".add-row").click()
    check("a row can be added", page.locator(".log-table tbody tr").count() == 5)
    axe(page, "logging marks")
    page.locator(".log-form button.btn:not(.ghost)").click()
    page.wait_for_selector(".cons .question")
    check("the marks go in", fake.logged["p_paper"] == "E-J17-P1" and len(fake.logged["p_items"]) == 2, fake.logged)
    text = page.locator("main").inner_text()
    check("the attempt shows the total", "9/29" in text and "31%" in text, text[:200])
    check("consolidation names the biggest loss", "Short questions" in text)
    n = page.locator(".cons .question").count()
    check("consolidation has questions", n == 5, n)
    page.screenshot(path=str(SHOTS / "paper-attempt.png"), full_page=True)
    for i in range(n):
        q = page.locator(".cons .question").nth(i)
        kind = q.get_attribute("data-type")
        if kind in ("mcq", "tf"):
            q.locator(".option").first.click()
        elif kind == "number":
            q.locator(".answer input").fill("1")
        elif kind == "explain":
            q.locator("textarea").fill("because")
        elif kind == "match":
            for s in q.locator("select").all():
                s.select_option(index=1)
        q.locator(".check-btn").click()
    page.wait_for_function("document.querySelector('.card .auth-msg')?.textContent.includes('Consolidation')")
    check("consolidation is saved", fake.cons and fake.cons["p_of"] >= 5, fake.cons)
    page.goto(BASE + "#/c/econ-aqa/papers")
    page.wait_for_selector(".paper-card")
    text = page.locator(".paper-card").inner_text()
    check("the gallery shows the paper", "June 2017" in text and "9/29" in text and "31%" in text, text)
    check("it names what was lost", "Lost most on" in text)
    check("the next paper moves on", "Paper 2" in page.locator("section.card").first.inner_text())

    # A rough grade
    for i in range(2):
        fake.attempts.append({**fake.attempts[0], "id": f"66666666-0000-4000-8000-00000000000{i + 2}", "paper_id": f"E-J18-P{i + 1}", "got": 60, "out_of": 80})
    fake.attempts[0] = {**fake.attempts[0], "got": 60, "out_of": 80}
    page.reload()
    page.wait_for_selector(".paper-card")
    text = page.locator("main").inner_text()
    check("a rough grade appears, labelled", "75%" in text and "180 of 240" in text and "rough guide" in text and "A*" in text, text[:500])
    check("the boundaries show their source and AQA's", "WQE College" in text and "AQA's own figures" in text)
    ctx.close()

    # Phone
    fake = Fake()
    ctx, page = new_page(browser, fake, 390)
    page.goto(BASE + "#/c/econ-aqa/papers")
    page.wait_for_selector(".paper-day")
    check("no sideways scroll on a phone", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
    page.goto(BASE + "#/c/econ-aqa/papers/log/E-J17-P1")
    page.wait_for_selector(".log-form")
    check("nor when logging", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
    ctx.close()
    browser.close()

check("no page errors", not errors, errors)
print(f"\n{'ALL OK' if not fails else str(len(fails)) + ' FAILED'}")
sys.exit(1 if fails else 0)
