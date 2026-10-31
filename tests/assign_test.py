"""Assignments in the browser: setting work, doing it, autosave and resume, the clock, the teacher's marking.

Runs against a local server with a faked signed-in session. Database calls are answered by a small fake here;
the real rules are tested by tools/assign_sql_test.mjs. Run: python tests/assign_test.py
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/"
SHOTS = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(".tmp/shots")
SHOTS.mkdir(parents=True, exist_ok=True)
AXE = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js"
fails, errors = [], []
USER = "00000000-0000-4000-8000-000000000009"
CID = "11111111-0000-4000-8000-000000000001"
AID = "22222222-0000-4000-8000-000000000001"
SID = "33333333-0000-4000-8000-000000000001"
SESSION = {"access_token": "x.y.z", "refresh_token": "r", "token_type": "bearer", "expires_in": 360000, "expires_at": 4102444800,
           "user": {"id": USER, "email": "s@example.com", "aud": "authenticated", "app_metadata": {}, "user_metadata": {}, "created_at": "2026-01-01T00:00:00Z"}}
iso = lambda d: d.astimezone(timezone.utc).isoformat()
now = lambda: datetime.now(timezone.utc)


def check(name, cond, extra=""):
    print(("ok   " if cond else "FAIL ") + name + (f"  ({extra})" if extra and not cond else ""))
    if not cond:
        fails.append(name)


ITEMS = [
    {"position": 1, "type": "mcq", "text": "Which is scarce?", "marks": 1, "options": ["Air", "Oil"]},
    {"position": 2, "type": "number", "text": "What is 6 x 7?", "marks": 1, "unit": "£"},
    {"position": 3, "type": "tf", "text": "Wants are unlimited.", "marks": 1},
    {"position": 4, "type": "order", "text": "Sort these.", "marks": 1, "shown": ["B", "A", "C"]},
    {"position": 5, "type": "match", "text": "Match up.", "marks": 1, "pairs": [["L1"], ["L2"]], "rightShown": ["R2", "R1"]},
    {"position": 6, "type": "explain", "text": "Why choose?", "marks": 2},
]


class Fake:
    def __init__(self):
        self.calls = []
        self.sub = None
        self.saved = {}
        self.down = False
        self.minutes = None
        self.submitted = False
        self.created = None
        self.marked = None
        self.bank = []
        self.ai = None
        self.ai_calls = 0

    def row(self):
        return {"id": AID, "class_id": CID, "class_name": "13A", "title": "Scarcity homework", "note": "Do it well", "open_at": "2026-01-01T00:00:00Z",
                "due_at": "2099-01-01T00:00:00Z", "max_attempts": 2, "minutes": self.minutes, "questions": len(ITEMS), "out_of": 7,
                "lessons": [{"id": "econ-aqa:4.1.1.1", "title": "A lesson", "done": False}], "attempts": 1 if self.sub or self.submitted else 0,
                "open_sub": None if self.submitted or not self.sub else SID, "best_sub": SID if self.submitted else None, "best_marks": 5 if self.submitted else None,
                "first_submitted": "2026-02-01T00:00:00Z" if self.submitted else None}

    def rpc(self, name, a):
        self.calls.append((name, a))
        if self.down and name in ("save_answers", "submit_attempt"):
            raise ConnectionError
        if name == "my_classes":
            return [{"id": CID, "name": "13A", "teacher": "Ms Tan", "course": "econ-aqa", "year_group": None, "leaderboard_on": False, "joined_at": "2026-01-01T00:00:00Z", "real_name": "Amy"}]
        if name == "my_assignments":
            return [self.row()]
        if name == "start_attempt":
            if not self.sub:
                self.sub = {"id": SID, "attempt": 1, "deadline": iso(now() + timedelta(minutes=self.minutes)) if self.minutes else None, "now": iso(now()), "items": ITEMS}
            return {**self.sub, "answers": self.saved}
        if name == "save_answers":
            self.saved.update(a["p_answers"])
            return {"closed": False}
        if name == "submit_attempt":
            self.saved.update(a["p_answers"])
            self.submitted = True
            return {"id": SID, "marks": 5, "out_of": 7}
        if name == "my_result":
            return {"id": SID, "attempt": 1, "submitted_at": "2026-02-01T00:00:00Z", "marks": 5, "out_of": 7, "title": "Scarcity homework", "due_at": "2099-01-01T00:00:00Z", "released": False,
                    "items": [{**ITEMS[0], "response": 1, "got": 1, "teacher_note": "Nice"}, {**ITEMS[3], "response": ["A", "B", "C"], "got": 0}]}
        if name == "teacher_classes":
            return [{"id": CID, "name": "13A", "course": "econ-aqa", "year_group": None, "join_code": "ABC234", "joining_open": True, "leaderboard_on": True, "students": 2}]
        if name == "class_roster":
            return []
        if name == "class_plan":
            return []
        if name == "my_teacher_questions":
            return self.bank
        if name == "save_teacher_question":
            self.bank.insert(0, {"id": "44444444-0000-4000-8000-000000000001", "q": a["p_q"]})
            return self.bank[0]["id"]
        if name == "delete_teacher_question":
            self.bank = []
            return None
        if name == "create_assignment":
            self.created = a
            return AID
        if name == "class_assignments":
            return [{"id": AID, "title": "Scarcity homework", "open_at": "2026-01-01T00:00:00Z", "due_at": "2026-02-01T00:00:00Z", "max_attempts": 1, "minutes": None, "questions": 6, "lessons": 0, "out_of": 7, "started": 2, "submitted": 1}]
        if name == "assignment_overview":
            base = {"left_at": None, "attempts": 1, "in_progress": False, "out_of": 7, "auto_submitted": False, "lessons_done": 0, "lessons_at": None}
            return [{**base, "user_id": "a", "real_name": "Amy Ames", "best_sub": SID, "best_marks": 5, "first_submitted": "2026-01-20T00:00:00Z"},
                    {**base, "user_id": "b", "real_name": "Ben Bell", "best_sub": SID, "best_marks": 3, "first_submitted": "2026-03-01T00:00:00Z"},
                    {**base, "user_id": "c", "real_name": "Cal Cole", "attempts": 0, "best_sub": None, "best_marks": None, "first_submitted": None}]
        if name == "submission_detail":
            return {"id": SID, "attempt": 1, "started_at": "2026-01-20T00:00:00Z", "submitted_at": "2026-01-20T00:10:00Z", "marks": 5, "out_of": 7,
                    "items": [{"position": 1, "marks": 2, "text": "Why choose?", "correct": "Scarcity", "why": "Because", "type": "explain", "response": "no idea", "auto": 0, "teacher_marks": None, "teacher_note": None},
                              {"position": 2, "marks": 9, "text": "Evaluate.", "correct": "Model", "scheme": "Level 3", "type": "long", "response": "An essay", "auto": None, "teacher_marks": None, "teacher_note": None, "ai": self.ai}]}
        if name == "fn:mark-answer":
            self.ai_calls += 1
            self.ai = {"level": 3, "marks": 6, "earned": "A clear chain", "missing": "No evaluation", "next_step": "Weigh it up"}
            return {"status": "marked"}
        if name == "set_answer_mark":
            self.marked = a
            return 7
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
            try:
                out = fake.rpc(name, json.loads(route.request.post_data or "{}"))
            except ConnectionError:
                return route.abort()
            return route.fulfill(status=200, content_type="application/json", body=json.dumps(out))
        if "/profiles" in url:
            return route.fulfill(status=200, content_type="application/json", body=json.dumps([{"user_id": USER, "nickname": "Alpha", "nickname_changed_at": None, "nickname_must_change": False}]))
        if "/teachers" in url:
            return route.fulfill(status=200, content_type="application/json", body=json.dumps([{"display_name": "Ms Tan", "school": None, "status": "verified"}]))
        return route.fulfill(status=201 if route.request.method in ("POST", "PATCH") else 200, content_type="application/json", body="[]")

    page.route("**/rest/v1/**", rest)
    page.route("**/functions/v1/**", lambda route: route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(fake.rpc("fn:mark-answer", {}))) if route.request.method == "POST" else route.fulfill(status=200, headers={"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*"}))
    return ctx, page


def axe(page, name):
    page.add_script_tag(url=AXE)
    page.wait_for_function("window.axe")
    bad = page.evaluate("axe.run({ resultTypes: ['violations'] }).then(r => r.violations.filter(v => ['serious','critical'].includes(v.impact)).map(v => v.id))")
    check(f"axe: no serious issues on {name}", not bad, bad)


with sync_playwright() as p:
    browser = p.chromium.launch()

    # A student does the work
    fake = Fake()
    ctx, page = new_page(browser, fake)
    page.goto(BASE + "#/")
    page.wait_for_selector(".due-soon")
    check("the dashboard shows due work", "Scarcity homework" in page.locator(".due-soon").inner_text())
    page.goto(BASE + "#/classes")
    page.wait_for_selector(".work-list")
    check("work is listed on the classes page", "Scarcity homework" in page.locator(".work-list").inner_text())
    check("its status shows", "Not started" in page.locator(".work-list").inner_text())
    axe(page, "the classes page with work")
    page.locator(".work-list a").click()
    page.wait_for_selector(".start")
    text = page.locator("main").inner_text()
    check("the intro shows the note, lessons and attempts", "Do it well" in text and "A lesson" in text and "2 attempts allowed" in text)
    page.locator(".start").click()
    page.wait_for_selector(".work-qs .question")
    check("every question shows", page.locator(".work-qs .question").count() == 6)
    check("there's no Check button", page.locator(".check-btn").count() == 0)
    check("nothing counts as answered at the start", "0 of 6 answered" in page.locator(".work-count").inner_text())
    page.screenshot(path=str(SHOTS / "work-doing.png"), full_page=True)
    axe(page, "doing the work")
    q = page.locator(".work-qs .question")
    q.nth(0).locator(".option").nth(1).click()
    q.nth(1).locator("input").fill("42")
    q.nth(2).locator(".option").nth(0).click()
    q.nth(3).locator("[data-move='-1']").nth(1).click()
    q.nth(4).locator("select").nth(0).select_option("R1")
    q.nth(4).locator("select").nth(1).select_option("R2")
    q.nth(5).locator("textarea").fill("Because of scarcity")
    page.wait_for_function("document.querySelector('.work-saved').textContent === 'Saved'")
    page.wait_for_timeout(1800)
    check("answers autosave", fake.saved.get("1") == 1 and fake.saved.get("2") == "42" and fake.saved.get("6") == "Because of scarcity", fake.saved)
    check("the order is saved as moved", fake.saved.get("4") == ["A", "B", "C"], fake.saved.get("4"))
    check("the count updates", "6 of 6 answered" in page.locator(".work-count").inner_text())

    # Resume, with the connection down for the last change
    fake.down = True
    q.nth(5).locator("textarea").fill("Because of scarcity and choice")
    page.wait_for_function("document.querySelector('.work-saved').textContent.includes('Not saved yet')", timeout=5000)
    check("a lost connection is shown plainly", True)
    page.reload()
    page.wait_for_selector(".start")
    check("it offers to carry on", "Carry on" in page.locator(".start").inner_text())
    page.locator(".start").click()
    page.wait_for_selector(".work-qs .question")
    q = page.locator(".work-qs .question")
    check("resume fills in a choice", q.nth(0).locator(".option").nth(1).get_attribute("aria-checked") == "true")
    check("resume fills in a number", q.nth(1).locator("input").input_value() == "42")
    check("resume keeps the moved order", q.nth(3).locator(".order li").nth(0).get_attribute("data-item") == "A")
    check("resume fills in the matches", q.nth(4).locator("select").nth(1).input_value() == "R2")
    check("unsent work comes back from this device", q.nth(5).locator("textarea").input_value() == "Because of scarcity and choice")
    fake.down = False
    page.locator(".hand-in").click()
    check("handing in asks first", "Sure" in page.locator(".hand-in").inner_text() and not fake.submitted)
    page.locator(".hand-in").click()
    page.wait_for_selector(".join-big")
    check("the unsent answer goes in with the hand-in", fake.saved.get("6") == "Because of scarcity and choice", fake.saved.get("6"))
    text = page.locator("main").inner_text()
    check("the mark shows", "5/7" in text)
    check("answers wait for the due date", "after the due date" in text)
    check("the teacher's comment shows", "Nice" in text)
    check("the response is shown as text", "Oil" in text and "A → B → C" in text)
    check("the device backup is cleared", page.evaluate(f"localStorage.getItem('compound.work.{SID}')") is None)
    axe(page, "the result")
    ctx.close()

    # The clock
    fake = Fake()
    fake.minutes = 10
    ctx, page = new_page(browser, fake)
    page.goto(BASE + f"#/work/{AID}")
    page.wait_for_selector(".start")
    check("timed work warns first", "keeps running" in page.locator("main").inner_text())
    page.locator(".start").click()
    page.wait_for_selector(".work-clock")
    check("the clock counts down", page.locator(".work-clock").inner_text().startswith("9:") or page.locator(".work-clock").inner_text() == "10:00")
    fake.sub["deadline"] = iso(now() + timedelta(seconds=3))
    page.reload()
    page.wait_for_selector(".start")
    page.locator(".start").click()
    page.wait_for_selector(".work-qs .question")
    page.locator(".work-qs .question").nth(1).locator("input").fill("42")
    page.wait_for_selector(".join-big", timeout=8000)
    check("time up hands in on its own", fake.submitted and fake.saved.get("2") == "42", fake.saved)
    ctx.close()

    # Phone width
    fake = Fake()
    ctx, page = new_page(browser, fake, 390)
    page.goto(BASE + f"#/work/{AID}")
    page.wait_for_selector(".start")
    page.locator(".start").click()
    page.wait_for_selector(".work-qs .question")
    check("no sideways scroll on a phone", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
    page.screenshot(path=str(SHOTS / "work-phone.png"), full_page=True)
    ctx.close()

    # A teacher sets work
    fake = Fake()
    ctx, page = new_page(browser, fake)
    page.goto(BASE + f"#/teach/{CID}")
    page.wait_for_selector("#work .work-list")
    check("the class page lists work", "Scarcity homework" in page.locator("#work").inner_text())
    page.goto(BASE + f"#/teach/{CID}/set")
    page.wait_for_selector(".set-form")
    page.locator(".set-form .btn.wide").click()
    check("a title is needed", page.evaluate("document.querySelector('.set-form input[name=title]').validity.valid") is False)
    page.fill("input[name=title]", "Week 1")
    page.locator(".set-form .btn.wide").click()
    check("something must be chosen", "Choose at least one" in page.locator(".auth-msg").inner_text() and not fake.created)
    page.select_option(".topic", index=1)
    page.wait_for_selector(".pick")
    page.locator(".pick summary").first.click()
    boxes = page.locator(".pick").first.locator("input[type=checkbox]")
    boxes.nth(0).check()
    boxes.nth(1).check()
    boxes.nth(2).check()
    check("the total updates", "2 questions" in page.locator(".set-total").inner_text() and "1 lesson" in page.locator(".set-total").inner_text())
    page.fill("input[name=due]", "2099-01-01T09:00")
    page.fill("input[name=minutes]", "30")
    page.fill("input[name=attempts]", "2")
    page.screenshot(path=str(SHOTS / "work-set.png"), full_page=True)
    axe(page, "the set work page")
    page.locator(".set-form .btn.wide").click()
    page.wait_for_selector(".roster")
    c = fake.created
    check("the work is sent with its settings", c and c["p_title"] == "Week 1" and c["p_minutes"] == 30 and c["p_attempts"] == 2 and c["p_due"].startswith("2099-01-01"))
    check("lessons and questions both go", [i["kind"] for i in c["p_items"]] == ["lesson", "question", "question"], c and c["p_items"])
    check("a question carries its frozen answer", "text" in c["p_items"][1]["q"] and "whyText" in c["p_items"][1]["q"])

    # The teacher's own questions
    page.goto(BASE + f"#/teach/{CID}/bank")
    page.wait_for_selector(".q-form")
    axe(page, "the question bank")
    page.fill(".q-form textarea[name=text]", "Evaluate the sugar tax.")
    page.fill(".q-form input[name=marks]", "25")
    page.fill(".q-form textarea[name=scheme]", "Level 5: well-developed chains")
    page.locator(".q-form .btn").click()
    page.wait_for_selector(".del")
    check("a written question saves", fake.bank[0]["q"]["type"] == "long" and fake.bank[0]["q"]["marks"] == 25 and "Level 5" in fake.bank[0]["q"]["scheme"], fake.bank)
    page.select_option(".q-form select[name=type]", "mcq")
    check("the form changes with the type", page.locator("[data-for=mcq]").is_visible() and not page.locator("[data-for=long]").is_visible())
    page.goto(BASE + f"#/teach/{CID}/set")
    page.wait_for_selector(".set-form")
    page.select_option(".topic", "__mine")
    page.wait_for_selector(".picker .check")
    page.locator(".picker input").check()
    check("own questions count", "25 marks" in page.locator(".set-total").inner_text())
    page.fill(".mock-marks", "30")
    page.select_option(".mock-paper", index=1) if page.locator(".mock-paper").count() else None
    page.locator(".build-mock").click()
    page.wait_for_function("document.querySelector('input[name=minutes]').value !== ''")
    check("a mock fills the time and the title", page.input_value("input[name=minutes]") == "83" and page.input_value("input[name=title]").startswith("Mock paper"), page.input_value("input[name=minutes]"))
    check("a mock keeps own questions", "55 marks" in page.locator(".set-total").inner_text(), page.locator(".set-total").inner_text())
    page.locator(".set-form .btn.wide").click()
    page.wait_for_selector(".roster")
    check("the own question goes in as written", fake.created["p_items"][0]["q"]["type"] == "long" and fake.created["p_items"][0]["id"].startswith("t:"), fake.created["p_items"][0])

    # The teacher reads the results
    text = page.locator("main").inner_text()
    check("not finished is named", "Not finished: Cal Cole" in text)
    check("on time, late and overdue show", "Finished late" in text and "Overdue" in text)
    check("marks show", "5/7" in text)
    page.screenshot(path=str(SHOTS / "work-overview.png"), full_page=True)
    axe(page, "the overview")
    page.locator(".roster a").first.click()
    page.wait_for_selector(".mark-form")
    check("the student's answer shows", "no idea" in page.locator("main").inner_text())
    page.locator(".ask-ai").click()
    page.wait_for_selector(".ai-mark")
    text = page.locator(".ai-mark").inner_text()
    check("an AI mark is labelled as an estimate", "AI estimate: 6/9" in text and "Only your teacher's mark counts" in text, text)
    check("the mark box isn't filled in by the AI", page.locator(".mark-form input[name=mark]").nth(1).input_value() == "")
    page.fill(".mark-form input[name=mark] >> nth=0", "2")
    page.fill(".mark-form input[name=note] >> nth=0", "Good thinking")
    page.locator(".mark-form .btn").first.click()
    page.wait_for_function("document.querySelector('.total').textContent === '7/7'")
    check("the mark goes in", fake.marked["p_marks"] == 2 and fake.marked["p_note"] == "Good thinking" and fake.marked["p_position"] == 1)
    axe(page, "the marking page")
    ctx.close()
    browser.close()

check("no page errors", not errors, errors)
print(f"\n{'ALL OK' if not fails else str(len(fails)) + ' FAILED'}")
sys.exit(1 if fails else 0)
