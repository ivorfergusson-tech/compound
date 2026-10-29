"""Checkpoint tests in the browser on a phone-sized screen. Serve the site first:
    python -m http.server 8765 --bind 127.0.0.1
then: python tests/checkpoint_test.py [base_url] [screenshot_dir]
Passes modules 1-8, checks module 9 waits for checkpoint 1, fails it, passes it, checks module 9 unlocks.
Then opens all four checkpoints with everything before them passed and checks each one builds.
"""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/"
SHOTS = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(".tmp/shots")
SHOTS.mkdir(parents=True, exist_ok=True)
course = json.loads((Path(__file__).parent.parent / "content" / "courses" / "money" / "course.json").read_text(encoding="utf-8"))
errors, fails = [], []


def check(name, cond):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        fails.append(name)


def passed_up_to(stop_id):
    """Progress with every module and checkpoint before stop_id passed."""
    attempts = []
    for i in course["items"]:
        if i["id"] == stop_id:
            break
        if i["kind"] == "intro":
            continue
        attempts.append({"uid": f"t{i['id']}", "at": "2026-10-27T10:00:00Z", "day": "2026-10-27",
                         "kind": "checkpoint" if i["kind"] == "checkpoint" else "quiz", "id": i["id"], "auto": 8, "claimed": 0,
                         "outOf": 8, "passed": True, "autoPassed": True, "missed": [], "wrong": [], "right": []})
    return {"v": 1, "nickname": None, "read": {"00": "2026-10-27"}, "srs": {}, "notes": {}, "guesses": {}, "days": [], "attempts": attempts}


def answer_all(page, right):
    """Answers every question in the quiz box, right or wrong. Returns how many it answered."""
    for n in range(1, 40):
        card = page.locator(".quiz .question").last
        q = page.evaluate("() => { const b = document.querySelector('.quiz'); const i = [...b.querySelectorAll('.dots span')].findIndex(s => s.classList.contains('now')); return b._questions[i]; }")
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
            return n
    return -1


IDX = {i["id"]: n for n, i in enumerate(course["items"])}


def card(page, item_id):
    """The item's card on the course map (locked cards have no link, so find it by position)."""
    return page.locator(".item").nth(IDX[item_id])


def is_locked(page, item_id):
    return "locked" in (card(page, item_id).get_attribute("class") or "")


def new_page(browser, progress):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx.add_init_script(f"if (!localStorage.getItem('compound.progress.v1')) localStorage.setItem('compound.progress.v1', {json.dumps(json.dumps(progress))})")
    page = ctx.new_page()
    page.on("console", lambda m: m.type == "error" and "supabase" not in m.text.lower() and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    return ctx, page


with sync_playwright() as p:
    browser = p.chromium.launch()

    # Checkpoint 1 gates module 9
    ctx, page = new_page(browser, passed_up_to("cp1"))
    page.goto(BASE)
    page.wait_for_selector(".item")
    check("course map has one card per item", page.locator(".item").count() == len(course["items"]))
    check("checkpoint 1 open after module 8", not is_locked(page, "cp1"))
    check("module 9 locked behind checkpoint 1", is_locked(page, "09")
          and "checkpoint test 1" in card(page, "09").inner_text().lower())
    page.goto(BASE + "#/m/09")
    page.wait_for_selector(".locked-view")
    check("module 9 page shows the lock", "checkpoint test 1" in page.locator(".locked-view").inner_text().lower())
    page.goto(BASE + "#/cp/1")
    page.wait_for_selector(".quiz .btn")
    page.screenshot(path=str(SHOTS / "cp1-start.png"))
    page.locator(".quiz .btn").click()
    page.wait_for_selector(".quiz .question")
    modules = page.evaluate("() => document.querySelector('.quiz')._questions.map(q => q.module)")
    check("checkpoint 1 has 18 questions", len(modules) == 18)
    check("checkpoint 1 only uses modules 1-8", all(1 <= m <= 8 for m in modules))
    check("checkpoint 1 mixes at least 5 modules", len(set(modules)) >= 5)
    n = answer_all(page, right=False)
    check("failed run answers all 18", n == 18)
    check("fail shows Not yet", "Not yet" in page.locator(".result").inner_text())
    check("fail says module 9 stays locked", "Module 9 stays locked" in page.locator(".quiz").inner_text())
    page.locator(".result").screenshot(path=str(SHOTS / "cp1-fail.png"))
    page.goto(BASE)
    page.wait_for_selector(".item")
    check("module 9 still locked after failing", is_locked(page, "09"))
    page.goto(BASE + "#/cp/1")
    page.wait_for_selector(".quiz .btn")
    page.locator(".quiz .btn").click()
    page.wait_for_selector(".quiz .question")
    answer_all(page, right=True)
    res = page.locator(".result").inner_text()
    check("pass shows Passed", "Passed" in res)
    check("pass gives XP", "XP" in res)
    check("pass links to module 9", page.locator('.quiz a.btn[href="#/c/money/m/09"]').count() == 1)
    page.locator(".result").screenshot(path=str(SHOTS / "cp1-pass.png"))
    page.goto(BASE)
    page.wait_for_selector(".item")
    check("module 9 unlocked after passing", not is_locked(page, "09"))
    check("module 10 still locked", is_locked(page, "10"))
    page.goto(BASE + "#/m/09")
    page.wait_for_selector(".lesson-section")
    check("module 9 opens", page.locator(".locked-view").count() == 0)
    ctx.close()

    # Every checkpoint builds once reached, and is locked before that
    for num in (1, 2, 3, 4):
        cid = f"cp{num}"
        item = next(i for i in course["items"] if i["id"] == cid)
        lo, hi = item["covers"]
        ctx, page = new_page(browser, passed_up_to(cid))
        page.goto(BASE + f"#/cp/{num}")
        page.wait_for_selector(".quiz .btn")
        page.locator(".quiz .btn").click()
        page.wait_for_selector(".quiz .question")
        mods = page.evaluate("() => document.querySelector('.quiz')._questions.map(q => q.module)")
        recent = sum(1 for m in mods if m > hi - 8)
        want = 20 if num == 4 else 18
        check(f"checkpoint {num}: {len(mods)} questions, {recent} from the latest 8, modules {min(mods)}-{max(mods)}",
              len(mods) == want and all(lo <= m <= hi for m in mods) and (num == 1 or recent >= want // 2))
        check(f"checkpoint {num}: no sideways scroll", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
        page.screenshot(path=str(SHOTS / f"cp{num}-q1.png"))
        ctx.close()
        last = next(i for i in course["items"] if i["kind"] == "module" and i["num"] == hi)
        ctx, page = new_page(browser, passed_up_to(last["id"]))
        page.goto(BASE + f"#/cp/{num}")
        page.wait_for_selector(".locked-view")
        check(f"checkpoint {num} locked until module {hi}'s quiz is passed", "module" in page.locator(".locked-view").inner_text().lower())
        ctx.close()
    browser.close()

check("no console errors", not errors)
for e in errors:
    print("  ", e)
print(f"{len(fails)} failed")
sys.exit(1 if fails else 0)
