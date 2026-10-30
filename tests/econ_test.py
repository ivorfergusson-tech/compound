"""The A-level Economics draft lessons, in the browser. Serve the site first:
    python -m http.server 8765 --bind 127.0.0.1
then: python tests/econ_test.py [base_url] [screenshot_dir]
The registry and course.json are answered with no account needed, so every lesson can be opened. Checks every lesson renders with its parts,
the PPF diagram responds, quizzes and the recall check run, and axe-core finds no serious issues.
"""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/"
SHOTS = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(".tmp/shots")
SHOTS.mkdir(parents=True, exist_ok=True)
AXE = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js"
ROOT = Path(__file__).parent.parent / "content"
errors, fails = [], []


def check(name, cond):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        fails.append(name)


def axe(page, label):
    page.add_script_tag(url=AXE)
    res = page.evaluate("""async () => {
      const r = await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] });
      return r.violations.filter(v => ['serious', 'critical'].includes(v.impact)).map(v => v.id + ' (' + v.impact + '): ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | '));
    }""")
    check(f"axe: no serious issues on {label}", not res)
    for r in res:
        print("     " + r)


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


reg = json.loads((ROOT / "courses.json").read_text(encoding="utf-8"))
for c in reg["courses"]:
    if c["id"] == "econ-aqa":
        c.update(live=True, needsAccount=False)
course = json.loads((ROOT / "courses" / "econ-aqa" / "course.json").read_text(encoding="utf-8"))
course["ready"] = [i["id"] for i in course["items"]]
course["review"] = {"status": "reviewed-by-owner", "by": "Test", "role": "Owner", "date": "2026-10-30"}
lessons = [i["id"] for i in course["items"] if i["kind"] == "module"]


def passed_all():
    at = [{"uid": f"t{i}", "at": "2026-10-20T10:00:00Z", "day": "2026-10-20", "kind": "quiz", "id": f"econ-aqa:{i}", "auto": 6, "claimed": 0,
           "outOf": 6, "passed": True, "autoPassed": True, "missed": [], "wrong": [], "right": []} for i in lessons + ["cp1", "cp2", "cp3", "cp4"]]
    return {"v": 1, "nickname": None, "read": {}, "srs": {}, "notes": {}, "guesses": {}, "days": [], "attempts": at}


def new_page(browser, width=390, dark=False, progress=None):
    ctx = browser.new_context(viewport={"width": width, "height": 844}, device_scale_factor=2, is_mobile=width < 600, has_touch=width < 600,
                              color_scheme="dark" if dark else "light")
    ctx.add_init_script("localStorage.setItem('compound.signup', 'done')")
    if progress:
        ctx.add_init_script(f"if (!localStorage.getItem('compound.progress.v1')) localStorage.setItem('compound.progress.v1', {json.dumps(json.dumps(progress))})")
    page = ctx.new_page()
    page.on("console", lambda m: m.type == "error" and "supabase" not in m.text.lower() and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.route("**/content/courses.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(reg)))
    page.route("**/content/courses/econ-aqa/course.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(course)))
    return ctx, page


with sync_playwright() as p:
    browser = p.chromium.launch()

    ctx, page = new_page(browser)
    page.goto(BASE + "#/c/econ-aqa")
    page.wait_for_selector(".item")
    check("course map lists every written lesson", page.locator(".item").count() == len(course["items"]))
    check("only the first lesson is open to a new learner", page.locator(f'.item[href="#/c/econ-aqa/m/{lessons[0]}"]').count() == 1 and page.locator(".item:not([href])").count() == len(lessons) + 3)
    ctx.close()

    ctx, page = new_page(browser, progress=passed_all())
    page.goto(BASE + "#/c/econ-aqa")
    page.wait_for_selector(".item")
    check("map links to every lesson once passed", all(page.locator(f'.item[href="#/c/econ-aqa/m/{i}"]').count() == 1 for i in lessons))
    page.screenshot(path=str(SHOTS / "econ-map.png"), full_page=True)

    # Every lesson renders with the A-level parts
    for i in lessons:
        page.goto(BASE + f"#/c/econ-aqa/m/{i}")
        page.wait_for_selector(".lesson-section")
        text = page.locator(".lesson").inner_text()
        check(f"{i}: one-sentence idea, worked exam answer, key terms", "The idea in one sentence".lower() in text.lower() and "Worked exam answer".lower() in text.lower() and "Key terms" in text)
        check(f"{i}: glossary terms are tappable", page.locator(".lesson [data-term]").count() >= 4)
        check(f"{i}: no block failed", page.locator("text=This part didn't load").count() == 0)
        check(f"{i}: no sideways scroll", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))

    # The PPF diagram: inside the boundary, on it, and growth
    page.goto(BASE + "#/c/econ-aqa/m/4.1.1.5")
    page.wait_for_selector(".chart svg")
    desc = page.locator("[data-desc]")
    check("PPF starts on the boundary", "on the boundary" in desc.inner_text())
    cost_mid = page.locator('[data-v="oc"]').inner_text()
    page.locator('[data-in="mix"]').fill("80")
    check("opportunity cost rises further along the curve", float(page.locator('[data-v="oc"]').inner_text().split()[0]) > float(cost_mid.split()[0]))
    page.locator('[data-in="use"]').fill("60")
    check("unused resources put the point inside", "inside the boundary" in desc.inner_text() and "40%" in desc.inner_text())
    page.locator('[data-in="grow"]').fill("20")
    check("growth shifts the boundary out", "shifted out by 20%" in desc.inner_text() and page.locator(".chart svg path.ch-dash").count() == 1)
    check("the diagram has a text label", bool(page.locator(".chart svg").get_attribute("aria-label")))
    page.locator(".calc").screenshot(path=str(SHOTS / "econ-ppf.png"))
    axe(page, "the PPF lesson (light)")

    # Demand and supply: a shift moves the equilibrium the right way
    page.goto(BASE + "#/c/econ-aqa/m/4.1.3.5")
    page.wait_for_selector(".chart svg")
    box = page.locator(".calc", has_text="Demand and supply")
    box.locator('[data-in="d"]').fill("20")
    check("demand shift right raises the price", box.locator('[data-v="p"]').inner_text() == "£70" and "rises" in box.locator("[data-desc]").inner_text())
    box.locator('[data-in="d"]').fill("0")
    box.locator('[data-in="s"]').fill("20")
    check("supply shift right lowers the price", box.locator('[data-v="p"]').inner_text() == "£50" and box.locator('[data-v="q"]').inner_text() == "50")
    box.locator(".chart").screenshot(path=str(SHOTS / "econ-market.png"))
    gap = page.locator(".calc", has_text="Equilibrium and disequilibrium")
    check("a price above equilibrium shows excess supply", "Excess supply of 40" in gap.locator("[data-desc]").inner_text())
    gap.locator('[data-in="price"]').fill("40")
    check("a price below equilibrium shows excess demand", "Excess demand of 40" in gap.locator("[data-desc]").inner_text())
    gap.locator('[data-in="price"]').fill("60")
    check("at £60 there is equilibrium", "Equilibrium" in gap.locator("[data-desc]").inner_text())

    # PED and revenue
    page.goto(BASE + "#/c/econ-aqa/m/4.1.3.2")
    page.wait_for_selector("[data-in='e']")
    check("inelastic demand: a price rise raises revenue", page.locator('[data-v="r"]').inner_text() == "£1045" and "inelastic" in page.locator("[data-desc]").inner_text())
    page.locator('[data-in="e"]').fill("2")
    check("elastic demand: a price rise cuts revenue", page.locator('[data-v="r"]').inner_text() == "£880" and "falls" in page.locator("[data-desc]").inner_text())

    # Cost curves
    page.goto(BASE + "#/c/econ-aqa/m/4.1.4.4")
    page.wait_for_selector(".chart svg")
    before = float(page.locator('[data-v="atc"]').inner_text().strip("£"))
    page.locator('[data-in="w"]').fill("2")
    check("higher wages raise lowest ATC", float(page.locator('[data-v="atc"]').inner_text().strip("£")) > before)
    page.locator(".calc").screenshot(path=str(SHOTS / "econ-costs.png"))
    axe(page, "the cost curves lesson")
    # Market structures
    page.goto(BASE + "#/c/econ-aqa/m/4.1.5.3")
    page.wait_for_selector(".chart svg")
    check("a high price gives abnormal profit", page.locator('[data-v="profit"]').inner_text() == "£1,600" and "Abnormal" in page.locator("[data-desc]").inner_text())
    page.locator('[data-in="price"]').fill("50")
    check("the long-run price gives normal profit", "normal profit" in page.locator("[data-desc]").inner_text() and page.locator(".ch-gain").count() == 0)
    page.locator('[data-in="price"]').fill("40")
    check("a low price gives a loss", page.locator('[data-v="profit"]').inner_text() == "−£500" and page.locator(".ch-loss").count() == 1)
    page.goto(BASE + "#/c/econ-aqa/m/4.1.5.6")
    page.wait_for_selector(".chart svg")
    check("the monopolist makes 60 at £80", page.locator('[data-v="q"]').inner_text() == "60" and page.locator('[data-v="p"]').inner_text() == "£80")
    page.locator(".calc").screenshot(path=str(SHOTS / "econ-monopoly.png"))
    page.goto(BASE + "#/c/econ-aqa/m/4.1.5.4")
    page.wait_for_selector(".chart svg")
    page.locator('[data-in="a"]').fill("72")
    check("monopolistic competition reaches normal profit", "long-run equilibrium" in page.locator("[data-desc]").inner_text())
    page.goto(BASE + "#/c/econ-aqa/m/4.1.5.5b")
    page.wait_for_selector(".chart svg")
    check("the price is stuck at the kink", page.locator('[data-v="p"]').inner_text() == "£70")
    page.locator('[data-in="c"]').fill("40")
    check("a big cost rise moves the price", page.locator('[data-v="p"]').inner_text() != "£70")
    page.locator(".calc").screenshot(path=str(SHOTS / "econ-kinked.png"))
    axe(page, "the kinked demand lesson")
    # Welfare and price discrimination
    page.goto(BASE + "#/c/econ-aqa/m/4.1.5.11")
    page.wait_for_selector(".chart svg")
    check("the competitive output has no deadweight loss", page.locator('[data-v="dwl"]').inner_text() == "£0" and page.locator('[data-v="cs"]').inner_text() == "£800")
    page.locator('[data-in="q"]').fill("30")
    check("restricting output creates a deadweight loss", page.locator('[data-v="dwl"]').inner_text() == "£100" and page.locator('[data-v="ps"]').inner_text() == "£1,050")
    page.locator(".calc").screenshot(path=str(SHOTS / "econ-surplus.png"))
    page.goto(BASE + "#/c/econ-aqa/m/4.1.5.7")
    page.wait_for_selector(".chart svg")
    check("the less elastic market pays more", page.locator('[data-v="pa"]').inner_text() == "£60" and page.locator('[data-v="pb"]').inner_text() == "£35")
    page.locator(".calc").screenshot(path=str(SHOTS / "econ-discrim.png"))
    axe(page, "the price discrimination lesson")
    # Labour markets and inequality
    page.goto(BASE + "#/c/econ-aqa/m/4.1.6.3")
    page.wait_for_selector(".chart svg")
    page.locator('[data-in="w"]').fill("75")
    check("a floor above equilibrium causes unemployment", page.locator('[data-v="gap"]').inner_text() == "20" and page.locator('[data-v="emp"]').inner_text() == "35")
    page.goto(BASE + "#/c/econ-aqa/m/4.1.6.4")
    page.wait_for_selector(".chart svg")
    check("the monopsonist pays £50 to 30 workers", page.locator('[data-v="wage"]').inner_text() == "£50" and page.locator('[data-v="emp"]').inner_text() == "30")
    page.locator('[data-in="w"]').fill("65")
    check("a floor in a monopsony raises jobs", page.locator('[data-v="gap"]').inner_text() == "+15")
    page.locator(".calc").screenshot(path=str(SHOTS / "econ-monopsony.png"))
    page.goto(BASE + "#/c/econ-aqa/m/4.1.7.1")
    page.wait_for_selector(".chart svg")
    before = page.locator('[data-v="low"]').inner_text()
    page.locator('[data-in="g"]').fill("0.6")
    check("a higher Gini leaves the poorest half less", int(page.locator('[data-v="low"]').inner_text().strip("%")) < int(before.strip("%")))
    page.locator(".calc").screenshot(path=str(SHOTS / "econ-lorenz.png"))
    axe(page, "the inequality lesson")
    # Externalities
    page.goto(BASE + "#/c/econ-aqa/m/4.1.8.4")
    page.wait_for_selector(".chart svg")
    box = page.locator(".calc").nth(0)
    check("a negative externality gives over-production", box.locator('[data-v="q"]').inner_text() == "30" and "over-produces" in box.locator("[data-desc]").inner_text())
    box.locator('[data-in="e"]').fill("0")
    check("no externality leaves no loss", box.locator('[data-v="loss"]').inner_text() == "£0" and box.locator(".ch-loss").count() == 0)
    box.locator('[data-in="e"]').fill("20")
    box.screenshot(path=str(SHOTS / "econ-ext-neg.png"))
    box = page.locator(".calc").nth(1)
    check("a positive externality gives under-production", box.locator('[data-v="q"]').inner_text() == "50" and "under-produces" in box.locator("[data-desc]").inner_text())
    box.screenshot(path=str(SHOTS / "econ-ext-pos.png"))
    axe(page, "the externalities lesson")
    # Taxing an externality
    page.goto(BASE + "#/c/econ-aqa/m/4.1.8.9a")
    page.wait_for_selector("[data-in='t']")
    box = page.locator(".calc", has_text="Taxing a negative externality")
    box.locator('[data-in="t"]').fill("20")
    check("a tax equal to the external cost removes the loss", box.locator('[data-v="loss"]').inner_text() == "£0" and "internalised" in box.locator("[data-desc]").inner_text())
    box.locator('[data-in="t"]').fill("40")
    check("too big a tax overshoots", "government failure" in box.locator("[data-desc]").inner_text())
    box.locator(".chart").screenshot(path=str(SHOTS / "econ-tax.png"))
    axe(page, "the intervention lesson")
    # Weighted price index
    page.goto(BASE + "#/c/econ-aqa/m/4.2.1.3")
    page.wait_for_selector("[data-in='food']")
    page.locator('[data-in="food"]').fill("10")
    page.locator('[data-in="energy"]').fill("20")
    page.locator('[data-in="other"]').fill("0")
    check("the index uses the weights", page.locator('[data-v="i"]').inner_text() == "104.0" and page.locator('[data-v="r"]').inner_text() == "4.0%")
    axe(page, "the index numbers lesson")
    # Macro diagrams
    page.goto(BASE + "#/c/econ-aqa/m/4.2.2.1")
    page.wait_for_selector(".chart svg")
    check("equal injections and withdrawals are steady", page.locator('[data-v="dir"]').inner_text() == "Steady")
    page.locator('[data-in="j"]').fill("120")
    check("more injections raise income", page.locator('[data-v="dir"]').inner_text() == "Rising")
    page.locator(".calc").screenshot(path=str(SHOTS / "econ-circular.png"))
    page.goto(BASE + "#/c/econ-aqa/m/4.2.2.2")
    page.wait_for_selector(".chart svg")
    page.locator('[data-in="d"]').fill("20")
    check("more AD raises output and prices", page.locator('[data-v="y"]').inner_text() == "90" and page.locator('[data-v="p"]').inner_text() == "60")
    page.locator('[data-in="d"]').fill("0")
    page.locator('[data-in="s"]').fill("20")
    check("higher costs open a negative gap", page.locator('[data-v="gap"]').inner_text() == "-10" and "cost-push" in page.locator("[data-desc]").inner_text() and "demand-deficient" not in page.locator("[data-desc]").inner_text())
    page.locator('[data-in="s"]').fill("0")
    page.locator('[data-in="d"]').fill("-20")
    check("weak demand gives demand-deficient unemployment", "demand-deficient" in page.locator("[data-desc]").inner_text())
    page.locator('[data-in="d"]').fill("0")
    page.locator('[data-in="s"]').fill("20")
    page.locator(".calc").screenshot(path=str(SHOTS / "econ-adas.png"))
    page.goto(BASE + "#/c/econ-aqa/m/4.2.2.4")
    page.wait_for_selector("[data-in='m']")
    check("MPC 0.8 gives a multiplier of 5", page.locator('[data-v="k"]').inner_text() == "5.0" and page.locator('[data-v="total"]').inner_text() == "£50bn")
    page.locator(".calc").screenshot(path=str(SHOTS / "econ-multiplier.png"))
    page.goto(BASE + "#/c/econ-aqa/m/4.2.2.6")
    page.wait_for_selector(".chart svg")
    check("the Keynesian curve is flat with spare capacity", page.locator('[data-v="p"]').inner_text() == "40")
    page.locator('[data-in="a"]').fill("200")
    check("near capacity, demand raises prices", "mostly raises prices" in page.locator("[data-desc]").inner_text())
    page.locator(".calc").screenshot(path=str(SHOTS / "econ-keynes.png"))
    axe(page, "the long-run AS lesson")
    # Cycle, inflation and the Phillips curve
    page.goto(BASE + "#/c/econ-aqa/m/4.2.3.1b")
    page.wait_for_selector(".chart svg")
    check("the cycle starts at a peak with a positive gap", page.locator('[data-v="ph"]').inner_text() == "Peak (boom)" and "positive output gap" in page.locator("[data-desc]").inner_text())
    page.locator('[data-in="t"]').fill("37.5")
    check("the trough has a negative gap", page.locator('[data-v="ph"]').inner_text() == "Trough" and "negative output gap" in page.locator("[data-desc]").inner_text())
    page.locator(".calc").screenshot(path=str(SHOTS / "econ-cycle.png"))
    page.goto(BASE + "#/c/econ-aqa/m/4.2.3.3a")
    page.wait_for_selector("[data-in='m']")
    check("the Fisher calculator starts at £2", page.locator('[data-v="p"]').inner_text() == "£2.00")
    page.locator('[data-in="m"]').fill("200")
    check("doubling M doubles P", page.locator('[data-v="p"]').inner_text() == "£4.00")
    page.goto(BASE + "#/c/econ-aqa/m/4.2.3.4")
    page.wait_for_selector(".chart svg")
    check("at the natural rate, inflation equals expectations", page.locator('[data-v="pi"]').inner_text() == "2.0%")
    page.locator('[data-in="u"]').fill("3")
    check("below the natural rate, inflation is higher", page.locator('[data-v="pi"]').inner_text() == "6.0%" and "shifts the short-run curve up" in page.locator("[data-desc]").inner_text())
    page.locator(".calc").screenshot(path=str(SHOTS / "econ-phillips.png"))
    axe(page, "the Phillips curve lesson")
    # Bonds
    page.goto(BASE + "#/c/econ-aqa/m/4.2.4.1")
    page.wait_for_selector(".chart svg")
    check("a bond at face value yields its coupon", page.locator('[data-v="y"]').inner_text() == "5.00%")
    page.locator('[data-in="p"]').fill("125")
    check("a higher bond price means a lower yield", page.locator('[data-v="y"]').inner_text() == "4.00%")
    page.locator(".calc").screenshot(path=str(SHOTS / "econ-bond.png"))
    axe(page, "the financial markets lesson")
    # Fiscal calculators
    page.goto(BASE + "#/c/econ-aqa/m/4.2.5.1b")
    page.wait_for_selector(".chart svg")
    check("£30,000 pays £3,486 in income tax", page.locator('[data-v="t"]').inner_text() == "£3,486" and page.locator('[data-v="mg"]').inner_text() == "20%")
    page.locator('[data-in="i"]').fill("60000")
    check("£60,000 pays 40% at the margin", page.locator('[data-v="mg"]').inner_text() == "40%")
    page.locator(".calc").screenshot(path=str(SHOTS / "econ-tax-calc.png"))
    page.goto(BASE + "#/c/econ-aqa/m/4.2.5.1c")
    page.wait_for_selector("[data-in='s']")
    check("a negative gap adds to the deficit", page.locator('[data-v="t"]').inner_text() == "4.0%")
    page.locator('[data-in="g"]').fill("4")
    check("a boom can hide a structural deficit", page.locator('[data-v="t"]').inner_text() == "0.0%")
    axe(page, "the budget lesson")
    # International diagrams
    page.goto(BASE + "#/c/econ-aqa/m/4.2.6.2a")
    page.wait_for_selector("[data-in='ax']")
    check("the lower opportunity cost specialises", page.locator('[data-v="who"]').inner_text() == "UK")
    page.locator('[data-in="ax"]').fill("3")
    check("changing output changes the specialism", page.locator('[data-v="who"]').inner_text() == "France")
    page.goto(BASE + "#/c/econ-aqa/m/4.2.6.2b")
    page.wait_for_selector(".chart svg")
    page.locator('[data-in="t"]').fill("10")
    check("a tariff cuts imports and raises revenue", page.locator('[data-v="m"]').inner_text() == "20" and page.locator('[data-v="r"]').inner_text() == "£200" and page.locator('[data-v="l"]').inner_text() == "£100")
    page.locator(".calc").screenshot(path=str(SHOTS / "econ-tariff.png"))
    page.goto(BASE + "#/c/econ-aqa/m/4.2.6.4")
    page.wait_for_selector(".chart svg")
    page.locator('[data-in="d"]').fill("20")
    check("more demand for pounds appreciates the pound", page.locator('[data-v="c"]').inner_text() == "Appreciates")
    page.locator(".calc").screenshot(path=str(SHOTS / "econ-forex.png"))
    axe(page, "the exchange rates lesson")
    ctx.close()

    # Lessons, not modules
    ctx, page = new_page(browser, progress=passed_all())
    page.goto(BASE + "#/c/econ-aqa/m/4.1.1.2")
    page.wait_for_selector("#quiz")
    text = page.locator("main").inner_text()
    check("Economics says lesson", "Lesson quiz" in text and "Module quiz" not in text and "earlier modules" not in text)
    check("builds on says lesson", "builds on lesson 1" in text)
    ctx.close()

    # Checkpoints: they hold back the next section, and draw only on their own section
    fresh = {k: v for k, v in passed_all().items()}
    fresh["attempts"] = [x for x in fresh["attempts"] if x["id"] != "econ-aqa:cp1"]
    ctx, page = new_page(browser, progress=fresh)
    page.goto(BASE + "#/c/econ-aqa/m/4.1.5.1")
    page.wait_for_selector(".locked-view")
    check("a checkpoint holds back the next section", "checkpoint 1" in page.locator(".locked-view").inner_text().lower())
    page.goto(BASE + "#/c/econ-aqa/cp/1")
    page.wait_for_selector(".quiz .btn")
    check("the checkpoint names its range", "lessons 1 to 21" in page.locator(".quiz").inner_text())
    page.locator(".quiz .btn").click()
    page.wait_for_selector(".quiz .question")
    answer_all(page, ".quiz", right=True)
    check("passing the checkpoint works", "Passed" in page.locator(".quiz .result").inner_text())
    page.goto(BASE + "#/c/econ-aqa/m/4.1.5.1")
    page.wait_for_selector(".lesson-section")
    check("passing it opens the next section", page.locator(".locked-view").count() == 0)
    ctx.close()

    # Exam technique: open at any point once approved, hidden from learners until then
    ctx, page = new_page(browser)
    page.goto(BASE + "#/c/econ-aqa?strand=exam")
    page.wait_for_selector(".item")
    check("the exam technique filter lists four guides", page.locator(".item").count() == 4 and "Exam technique" in page.locator("main").inner_text())
    page.goto(BASE + "#/c/econ-aqa/m/exam-3")
    page.wait_for_selector(".lesson-section")
    check("a guide opens with no lessons passed", page.locator(".locked-view").count() == 0 and page.locator("#quiz").count() == 0)
    page.screenshot(path=str(SHOTS / "econ-guide.png"), full_page=False)
    axe(page, "an exam technique guide")
    ctx.close()

    # Lesson 1's quiz on its own; it should pass when everything is right
    ctx, page = new_page(browser)
    page.goto(BASE + f"#/c/econ-aqa/m/{lessons[0]}")
    page.wait_for_selector("#quiz .btn")
    check("first lesson has no recall check", page.locator("#recall").count() == 0)
    page.locator("#quiz .btn").click()
    page.wait_for_selector("#quiz .question")
    n = answer_all(page, "#quiz .quiz", right=True)
    check("first lesson's quiz runs to the end", n > 0 and "Passed" in page.locator("#quiz .result").inner_text())
    saved = page.evaluate("JSON.parse(localStorage.getItem('compound.progress.v1'))")
    check("progress key is prefixed with the course", any(a["id"] == f"econ-aqa:{lessons[0]}" and a["passed"] for a in saved["attempts"]))

    # Lesson 2 now opens, with a recall check from lesson 1
    page.goto(BASE + f"#/c/econ-aqa/m/{lessons[1]}")
    page.wait_for_selector("#quiz .quiz .btn")
    page.locator("#quiz .quiz .btn").click()
    page.wait_for_selector("#quiz .question")
    rq = page.evaluate("document.querySelector('#quiz .quiz')._questions")
    check("recall questions come from lesson 1", rq and all(q["id"].startswith(f"econ-aqa:{lessons[0]}-") for q in rq))
    answer_all(page, "#quiz .quiz", right=True)
    page.locator("#quiz .go-quiz").click()
    page.wait_for_selector("#quiz .question")
    answer_all(page, "#quiz .quiz", right=True)
    check("lesson 2 passes across recall and quiz", "Passed" in page.locator("#quiz .result").inner_text())
    ctx.close()

    # Dark mode and a desktop screen
    ctx, page = new_page(browser, width=1280, dark=True, progress=passed_all())
    page.goto(BASE + "#/c/econ-aqa/m/4.1.1.5")
    page.wait_for_selector(".chart svg")
    page.screenshot(path=str(SHOTS / "econ-ppf-dark-desktop.png"), full_page=False)
    axe(page, "the PPF lesson (dark, desktop)")
    page.goto(BASE + "#/c/econ-aqa/m/4.1.1.2")
    page.wait_for_selector(".lesson-section")
    axe(page, "the resources lesson with its table (dark)")
    ctx.close()

    # Live: a learner with no account reaches the course, and it says lesson, not module
    ctx = browser.new_context()
    page = ctx.new_page()
    page.goto(BASE + "#/c/econ-aqa")
    page.wait_for_selector("main h1")
    check("the course is open to learners", "not found" not in page.locator("main h1").inner_text().lower())
    ctx.close()
    browser.close()

for e in errors:
    print("console:", e)
print(f"\n{'PASS' if not fails and not errors else 'FAIL'}: {len(fails)} failed checks, {len(errors)} console errors")
sys.exit(1 if fails or errors else 0)
