"""Classes in the browser: joining with consent, the teacher pages, and phone width.

Runs against a local server with a faked signed-in session. Database calls are answered by a small fake here;
the real rules are tested by tools/classes_sql_test.mjs and tools/rls_test.py. Run: python tests/classes_test.py
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
CID = "11111111-0000-4000-8000-000000000001"
SESSION = {"access_token": "x.y.z", "refresh_token": "r", "token_type": "bearer", "expires_in": 360000, "expires_at": 4102444800,
           "user": {"id": USER, "email": "s@example.com", "aud": "authenticated", "app_metadata": {}, "user_metadata": {}, "created_at": "2026-01-01T00:00:00Z"}}


def check(name, cond, extra=""):
    print(("ok   " if cond else "FAIL ") + name + (f"  ({extra})" if extra and not cond else ""))
    if not cond:
        fails.append(name)


class Fake:
    """Just enough of the database functions to drive the pages."""

    def __init__(self):
        self.joined = []
        self.calls = []
        self.teacher = None
        self.klass = {"id": CID, "name": "13A Economics", "course": "econ-aqa", "year_group": "Year 13", "join_code": "ABC234",
                      "joining_open": True, "leaderboard_on": True, "students": 1}
        self.roster = [{"user_id": USER, "real_name": "Amy Ames", "nickname": "Alpha", "joined_at": "2026-10-01T10:00:00Z", "left_at": None, "passed": 3, "last_active": "2026-10-20T10:00:00Z"}]

    def rpc(self, name, a):
        self.calls.append((name, a))
        if name == "class_preview":
            return [{"name": "13A Economics", "teacher": "Ms Tan", "school": "Hill School", "course": "econ-aqa", "year_group": "Year 13", "joining_open": True, "already": False}] if a["p_code"] == "ABC234" else []
        if name == "join_class":
            self.joined.append(a)
            return CID
        if name == "my_classes":
            return [{"id": CID, "name": "13A Economics", "teacher": "Ms Tan", "course": "econ-aqa", "year_group": "Year 13", "leaderboard_on": True, "joined_at": "2026-10-01T10:00:00Z", "real_name": a2["p_real_name"]} for a2 in self.joined]
        if name == "leave_class":
            self.joined.clear()
            return None
        if name == "class_leaderboard":
            return [{"nickname": "Alpha", "xp": 120, "pos": 1, "is_me": True}, {"nickname": "Bravo", "xp": 60, "pos": 2, "is_me": False}]
        if name == "become_teacher":
            self.teacher = {"display_name": a["p_name"], "school": a["p_school"], "status": "unverified"}
            return "unverified"
        if name == "teacher_classes":
            return [self.klass] if self.teacher else []
        if name == "create_class":
            return CID
        if name == "class_roster":
            return self.roster
        if name == "remove_from_class":
            self.roster[0]["left_at"] = "2026-10-30T10:00:00Z"
            return None
        if name == "renew_join_code":
            self.klass["join_code"] = "XYZ789"
            return "XYZ789"
        if name == "update_class":
            self.klass.update(joining_open=a["p_joining_open"], leaderboard_on=a["p_leaderboard_on"])
            return None
        return None


def new_page(browser, fake, width=390):
    ctx = browser.new_context(viewport={"width": width, "height": 844}, is_mobile=width < 600, has_touch=width < 600)
    ctx.add_init_script("localStorage.setItem('compound.signup', 'done');"
                        f"localStorage.setItem('sb-zxmvhufnxdpzzabeuxkr-auth-token', {json.dumps(json.dumps(SESSION))});")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))

    def rest(route):
        url = route.request.url
        if "/rpc/" in url:
            name = url.split("/rpc/")[1].split("?")[0]
            body = route.request.post_data_json or {}
            return route.fulfill(status=200, content_type="application/json", body=json.dumps(fake.rpc(name, body)))
        if "/profiles" in url:
            row = {"user_id": USER, "nickname": "Alpha", "nickname_changed_at": None, "nickname_must_change": False}
            return route.fulfill(status=200, content_type="application/json", body=json.dumps([row]))
        if "/teachers" in url:
            return route.fulfill(status=200, content_type="application/json", body=json.dumps([fake.teacher] if fake.teacher else []))
        if route.request.method in ("POST", "PATCH"):
            return route.fulfill(status=201, content_type="application/json", body="[]")
        return route.fulfill(status=200, content_type="application/json", body="[]")

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

    # Student
    ctx, page = new_page(browser, fake)
    page.goto(BASE + "#/classes")
    page.wait_for_selector(".join-code")
    check("the classes page opens when signed in", "not in a class" in page.locator("main").inner_text())
    page.fill(".join-code input", "abc")
    page.locator(".join-code button").click()
    check("a short code is refused", "6 letters" in page.locator(".auth-msg").inner_text())
    page.fill(".join-code input", "abc234")
    page.locator(".join-code button").click()
    page.wait_for_selector(".join-form")
    text = page.locator("main").inner_text()
    check("the consent screen shows the full wording", "Your teacher will see your real name, your scores, time spent and work you hand in." in text)
    check("it names the class and teacher", "13A Economics" in text and "Ms Tan" in text and "Hill School" in text)
    page.fill(".join-form input[name=real]", "Amy Ames")
    page.locator(".join-form .btn").click()
    check("no tick, no join", "agree" in page.locator(".auth-msg").inner_text() and not fake.joined)
    page.screenshot(path=str(SHOTS / "class-consent.png"))
    axe(page, "the consent screen")
    page.locator(".join-form input[name=ok]").check()
    page.locator(".join-form .btn").click()
    page.wait_for_selector(".leave")
    check("joining sends the name and consent", fake.joined and fake.joined[0]["p_real_name"] == "Amy Ames" and fake.joined[0]["p_consent"] is True)
    check("the class is listed", "13A Economics" in page.locator("main").inner_text() and "Amy Ames" in page.locator("main").inner_text())
    page.locator("a", has_text="Class leaderboard").click()
    page.wait_for_selector(".lb-list")
    check("class leaderboard shows nicknames", "Bravo" in page.locator(".lb-list").inner_text())
    page.goto(BASE + "#/classes")
    page.wait_for_selector(".leave")
    leave = page.locator(".leave")
    leave.click()
    check("leaving asks once", "Sure" in leave.inner_text() and fake.joined)
    leave.click()
    page.wait_for_function("!document.querySelector('.leave')")
    check("leaving works", not fake.joined)
    page.goto(BASE + "#/join/WRONG2")
    page.wait_for_selector("main h1")
    page.wait_for_function("document.querySelector('main h1').textContent.includes('not found')")
    check("a wrong link says so", True)
    ctx.close()

    # Teacher
    ctx, page = new_page(browser, fake, width=1100)
    page.goto(BASE + "#/teach")
    page.wait_for_selector(".teacher-form")
    page.fill(".teacher-form input[name=name]", "Ms Tan")
    page.locator(".teacher-form .btn").click()
    check("teachers must confirm", "teacher" in page.locator(".auth-msg").inner_text().lower() and fake.teacher is None)
    page.locator(".teacher-form input[name=ok]").check()
    page.locator(".teacher-form .btn").click()
    page.wait_for_selector(".new-class")
    check("an unverified teacher is told about the limit", "35 students" in page.locator("main").inner_text())
    check("the course list shows live courses only", "A-level Economics" in page.locator(".new-class select").inner_text() and "Business" not in page.locator(".new-class select").inner_text())
    page.fill(".new-class input[name=name]", "13A Economics")
    page.locator(".new-class .btn").click()
    page.wait_for_selector(".roster")
    text = page.locator("main").inner_text()
    check("the class page shows the code", "ABC234" in text and "#/join/ABC234" in text)
    check("the roster shows the real name", "Amy Ames" in text and "Alpha" in text)
    page.wait_for_selector(".qr svg", timeout=15000)
    check("the QR code draws", page.locator(".qr svg").count() == 1)
    check("an unverified teacher can't reset nicknames", page.locator(".reset").count() == 0)
    page.screenshot(path=str(SHOTS / "class-teacher.png"), full_page=True)
    axe(page, "the teacher's class page")
    renew = page.locator(".renew")
    renew.click()
    check("a new code asks first", "stops working" in renew.inner_text() and fake.klass["join_code"] == "ABC234")
    renew.click()
    page.wait_for_function("document.querySelector('main').innerText.includes('XYZ789')")
    check("a new code replaces the old one", fake.klass["join_code"] == "XYZ789")
    page.locator(".toggle-join").click()
    page.wait_for_function("document.querySelector('main').innerText.includes('Joining is closed')")
    check("joining can be closed", fake.klass["joining_open"] is False)
    rm = page.locator(".remove")
    rm.click()
    rm.click()
    page.wait_for_function("document.querySelector('main').innerText.includes('Left ')")
    check("a removed student stays on the roster as left", "Amy Ames" in page.locator("main").inner_text())
    ctx.close()

    # Phone width
    ctx, page = new_page(browser, fake)
    fake.roster[0]["left_at"] = None
    page.goto(BASE + f"#/teach/{CID}")
    page.wait_for_selector(".roster")
    check("no sideways scroll on a phone", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
    ctx.close()

    # Signed out
    ctx = browser.new_context()
    ctx.add_init_script("localStorage.setItem('compound.signup', 'done')")
    page = ctx.new_page()
    page.goto(BASE + "#/join/ABC234")
    page.wait_for_selector("main h1")
    check("joining needs an account", "account" in page.locator("main").inner_text().lower())
    ctx.close()
    browser.close()

for e in errors:
    print("console:", e)
print(f"\n{'PASS' if not fails and not errors else 'FAIL'}: {len(fails)} failed checks, {len(errors)} console errors")
sys.exit(1 if fails or errors else 0)
