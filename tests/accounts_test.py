"""Accounts, the sign-up pop-up, display settings, read aloud and accessibility, in the browser.
Serve the site first:
    python -m http.server 8765 --bind 127.0.0.1
then: python tests/accounts_test.py [base_url] [screenshot_dir]
Sign-up and sign-in calls to Supabase are answered with fakes, so no real accounts or emails are made.
axe-core checks the main pages; any serious or critical issue fails.
"""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/"
SHOTS = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(".tmp/shots")
SHOTS.mkdir(parents=True, exist_ok=True)
AXE = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js"
errors, fails = [], []


def check(name, cond):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        fails.append(name)


def new_page(browser, progress=None, signup=None, width=390, extra_init=None, expect_400=False):
    ctx = browser.new_context(viewport={"width": width, "height": 844}, device_scale_factor=2, is_mobile=width < 600, has_touch=width < 600)
    if progress is not None:
        ctx.add_init_script(f"if (!localStorage.getItem('compound.progress.v1')) localStorage.setItem('compound.progress.v1', {json.dumps(json.dumps(progress))})")
    if signup:
        ctx.add_init_script(f"if (!localStorage.getItem('compound.signup')) localStorage.setItem('compound.signup', '{signup}')")
    if extra_init:
        ctx.add_init_script(extra_init)
    page = ctx.new_page()
    # The faked wrong-password answer is a 400; the browser logs it, which is expected.
    page.on("console", lambda m: m.type == "error" and "supabase" not in m.text.lower() and not (expect_400 and "status of 400" in m.text) and errors.append(m.text))
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


def flag(page):
    return page.evaluate("localStorage.getItem('compound.signup')")


with sync_playwright() as p:
    browser = p.chromium.launch()

    # First visit: the pop-up, with a cross and "Continue without an account"
    ctx, page = new_page(browser)
    page.goto(BASE)
    page.wait_for_selector(".modal")
    m = page.locator(".modal")
    check("pop-up on first visit", "Create an account" in m.inner_text())
    check("pop-up says why", "Track your progress from the start" in m.inner_text())
    check("pop-up has a cross", m.locator(".modal-x").count() == 1)
    check("pop-up has continue without", m.locator(".continue").count() == 1)
    check("pop-up has email + password", m.locator("input[type=email]").count() == 1 and m.locator("input[type=password]").count() == 1)
    check("Google button", m.locator('.oauth[data-provider="google"]').count() == 1)
    check("pop-up is a labelled modal dialog", m.get_attribute("role") == "dialog" and m.get_attribute("aria-modal") == "true")
    check("no sideways scroll with the pop-up", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
    m.screenshot(path=str(SHOTS / "signup-popup.png"))
    axe(page, "the sign-up pop-up")
    # keyboard: focus stays inside, Escape closes
    for _ in range(12):
        page.keyboard.press("Tab")
    check("Tab stays inside the pop-up", page.evaluate("document.querySelector('.modal').contains(document.activeElement)"))
    # password checks happen before anything is sent
    m.locator("input[type=email]").fill("student@example.com")
    m.locator("input[type=password]").fill("short")
    m.locator(".submit").click()
    check("short password refused", "8 characters" in m.locator(".auth-msg").inner_text())
    m.locator(".show-pw").click()
    check("show password", m.locator("input[name=password]").get_attribute("type") == "text")
    page.keyboard.press("Escape")
    check("Escape closes it", page.locator(".modal").count() == 0)
    check("closing remembers", flag(page) == "dismissed")
    page.reload()
    page.wait_for_selector(".course-card")
    page.wait_for_timeout(800)
    check("not shown again", page.locator(".modal").count() == 0)
    ctx.close()

    ctx, page = new_page(browser)
    page.goto(BASE)
    page.wait_for_selector(".modal .continue")
    page.locator(".modal .continue").click()
    check("continue without an account closes it", page.locator(".modal").count() == 0 and flag(page) == "dismissed")
    ctx.close()

    # Someone who has already used the course in this browser isn't interrupted
    ctx, page = new_page(browser, {"v": 1, "nickname": None, "read": {"00": "2026-10-20T10:00:00Z"}, "attempts": [], "srs": {}, "notes": {}, "guesses": {}, "days": []})
    page.goto(BASE)
    page.wait_for_selector(".course-card")
    page.wait_for_timeout(800)
    check("no pop-up for someone with progress", page.locator(".modal").count() == 0)
    ctx.close()

    # Sign-up and sign-in, with Supabase's answers faked
    fake_user = {"id": "00000000-0000-4000-8000-000000000001", "email": "student@example.com", "identities": [{"id": "x"}]}
    ctx, page = new_page(browser, signup="dismissed", expect_400=True)
    page.route("**/auth/v1/signup**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({**fake_user})))
    page.route("**/auth/v1/token?grant_type=password**", lambda r: r.fulfill(status=400, content_type="application/json", body=json.dumps({"code": "invalid_credentials", "error_code": "invalid_credentials", "msg": "Invalid login credentials"})))
    page.route("**/auth/v1/recover**", lambda r: r.fulfill(status=200, content_type="application/json", body="{}"))
    page.goto(BASE + "#/account")
    page.wait_for_selector("#auth-box input[type=password]")
    box = page.locator("#auth-box")
    box.locator("input[type=email]").fill("student@example.com")
    box.locator("input[type=password]").fill("a good long password")
    box.locator(".submit").click()
    page.wait_for_function("document.querySelector('#auth-box .auth-msg').textContent.length > 0")
    check("sign-up asks to confirm the email", "confirm your email" in box.locator(".auth-msg").inner_text())
    check("button waits before another email", box.locator(".submit").is_disabled())
    box.locator('[data-go="signin"]').click()
    page.wait_for_selector('#auth-box .auth[data-mode="signin"]')
    check("email carried to sign in", box.locator("input[type=email]").input_value() == "student@example.com")
    box.locator("input[type=password]").fill("wrong password")
    box.locator(".submit").click()
    page.wait_for_function("document.querySelector('#auth-box .auth-msg').textContent.length > 0")
    check("wrong password explained", "don't match" in box.locator(".auth-msg").inner_text())
    check("email-link users told how to set a password", "Forgot password" in box.inner_text())
    ctx.close()

    ctx, page = new_page(browser, signup="dismissed")  # a fresh page: the email cooldown from sign-up has passed
    page.route("**/auth/v1/recover**", lambda r: r.fulfill(status=200, content_type="application/json", body="{}"))
    page.goto(BASE + "#/account")
    page.wait_for_selector("#auth-box [data-go=signin]")
    box = page.locator("#auth-box")
    box.locator('[data-go="signin"]').click()
    page.wait_for_selector('#auth-box [data-go="forgot"]')
    box.locator('[data-go="forgot"]').click()
    page.wait_for_selector('#auth-box .auth[data-mode="forgot"]')
    check("reset form is email only", box.locator("input[type=password]").count() == 0)
    box.locator("input[type=email]").fill("student@example.com")
    box.locator(".submit").click()
    page.wait_for_function("document.querySelector('#auth-box .auth-msg').textContent.length > 0")
    check("reset link sent", "reset link" in box.locator(".auth-msg").inner_text())
    ctx.close()

    # The one banner after the first quiz, once the pop-up was closed
    ctx, page = new_page(browser, signup="dismissed")
    page.goto(BASE + "#/c/money/m/01")
    page.wait_for_selector("#quiz .btn")
    page.locator("#quiz .btn").click()
    page.wait_for_selector("#quiz .question")
    for _ in range(30):
        card = page.locator("#quiz .question").last
        q = page.evaluate("() => { const b = document.querySelector('#quiz .quiz'); const i = [...b.querySelectorAll('.dots span')].findIndex(s => s.classList.contains('now')); return b._questions[i]; }")
        if q["type"] in ("mcq", "tf"):
            card.locator(".option").first.click()
        elif q["type"] == "number":
            card.locator("input").fill("1")
        elif q["type"] == "match":
            for s in card.locator("select").all():
                s.select_option(index=1)
        elif q["type"] == "explain":
            card.locator("textarea").fill("not sure")
        card.locator(".check-btn").click()
        nxt = card.locator(".next-btn")
        last = "result" in nxt.inner_text()
        nxt.click()
        if last:
            break
    check("banner after the first quiz", page.locator(".save-banner").count() == 1 and "Save your progress" in page.locator(".save-banner").inner_text())
    check("banner only once", flag(page) == "bannered")
    ctx.close()

    # A course that needs an account: the pop-up has no "continue without"
    reg = json.loads(Path(__file__).parent.parent.joinpath("content", "courses.json").read_text(encoding="utf-8"))
    reg["courses"].append({"id": "test-alevel", "subject": "money", "board": None, "title": "Test A-level", "path": "content/courses/money/", "pages": None, "needsAccount": True, "live": True})
    ctx, page = new_page(browser, signup="done")
    page.route("**/content/courses.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(reg)))
    page.goto(BASE + "#/c/test-alevel")
    page.wait_for_selector(".modal")
    check("A-level course asks for an account", "needs a free account" in page.locator(".modal").inner_text())
    check("no continue-without button", page.locator(".modal .continue").count() == 0)
    check("course stays locked behind it", page.locator(".locked-view").count() == 1)
    page.locator(".modal .modal-x").click()
    page.wait_for_function("location.hash === '#/'")
    check("closing it goes back home", page.evaluate("location.hash") == "#/")
    ctx.close()

    # Display settings: apply at once, survive a reload, reach the reading pages
    ctx, page = new_page(browser, signup="done")
    page.goto(BASE + "#/account")
    page.wait_for_selector(".settings-grid")
    base_size = page.evaluate("parseFloat(getComputedStyle(document.querySelector('main p')).fontSize)")
    page.locator('.settings-grid label:has(input[name=size][value=xl])').click()
    check("text size grows", page.evaluate("parseFloat(getComputedStyle(document.querySelector('main p')).fontSize)") > base_size * 1.2)
    page.locator('.settings-grid label:has(input[name=contrast][value=high])').click()
    check("high contrast: black background in dark mode", page.evaluate("getComputedStyle(document.body).backgroundColor") == "rgb(0, 0, 0)")
    page.locator('.settings-grid label:has(input[name=font][value=lexend])').click()
    check("easy-read font loads", page.locator('link[data-font="lexend"]').count() == 1)
    page.locator('.settings-grid label:has(input[name=lines][value=loose])').click()
    page.locator('.settings-grid label:has(input[name=letters][value=wide])').click()
    check("spacing applies", page.evaluate("getComputedStyle(document.body).letterSpacing") != "normal")
    page.screenshot(path=str(SHOTS / "display-settings.png"), full_page=False)
    axe(page, "the account page (high contrast, large text)")
    page.reload()
    page.wait_for_selector(".settings-grid")
    check("settings survive a reload", page.evaluate("document.documentElement.dataset.size") == "xl" and page.locator("input[name=size][value=xl]").is_checked())
    check("no sideways scroll at extra large", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
    page.goto(BASE + "m/01/")
    page.wait_for_selector("main")
    check("reading pages use the settings too", page.evaluate("document.documentElement.dataset.contrast") == "high")
    page.goto(BASE + "#/c/money/m/01")
    page.wait_for_selector(".lesson-section")
    check("lesson has no sideways scroll at extra large", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
    page.locator(".theme-btn").click()
    check("theme button still works", page.evaluate("document.documentElement.dataset.theme") == "light")
    ctx.close()

    # Read aloud (speech is faked: it records what would be said)
    fake_speech = """
      window.__said = [];
      const synth = { speaking: false, paused: false, getVoices: () => [], cancel() {}, pause() { this.paused = true; }, resume() { this.paused = false; },
        speak(u) { window.__said.push(u.text); setTimeout(() => u.onend && u.onend(), 30); } };
      Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
      window.SpeechSynthesisUtterance = function (t) { this.text = t; };
    """
    ctx, page = new_page(browser, signup="done", extra_init=fake_speech)
    page.goto(BASE + "#/c/money/m/01")
    page.wait_for_selector(".read-aloud .listen")
    page.locator(".read-aloud .listen").click()
    page.wait_for_function("window.__said.length > 5")
    said = page.evaluate("window.__said")
    check("reads the title first", said[0] == page.locator(".lesson h1").inner_text())
    check("reads the lesson, not the buttons", not any("Listen" in t or "Check" == t for t in said))
    page.locator(".read-aloud .stop-read").click()
    check("stop brings Listen back", page.locator(".read-aloud .listen").is_visible())
    page.locator(".question .speak-btn").first.click()
    page.wait_for_timeout(100)
    check("questions can be read aloud", page.evaluate("window.__said.at(-1)").startswith(page.locator(".question .q").first.inner_text()[:20]))
    ctx.close()

    # axe on the other main pages (default look, dark and light, desktop width)
    for theme in ("dark", "light"):
        ctx, page = new_page(browser, signup="done", width=1200, extra_init=f"localStorage.setItem('compound.theme', '{theme}')")
        for route, sel in (("#/", ".course-card"), ("#/c/money", ".item"), ("#/refresh", ".quiz .card"), ("#/c/money/m/01", ".lesson-section"), ("#/c/money/glossary", ".g-item"), ("#/leaderboard", "main h1"), ("#/about", "main h1"), ("#/account", ".settings-grid")):
            page.goto(BASE + route)
            page.wait_for_selector(sel)
            page.wait_for_timeout(300)
            axe(page, f"{route} ({theme})")
        ctx.close()
    browser.close()

check("no console errors", not errors)
if errors:
    print("\n".join(errors[:10]))
print(f"{len(fails)} failed")
sys.exit(1 if fails else 0)
