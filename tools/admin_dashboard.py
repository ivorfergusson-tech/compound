"""Private admin dashboard: every account, how each module is going, and the most-missed topics.

Reads Supabase with the service key from .env and writes .tmp/admin.html (gitignored), then opens it.
Runs on this computer only: the page is never published, and the service key never leaves .env.
Leaves out people's notes, guesses and individual answers.

Run: python tools/admin_dashboard.py [--no-open]
"""
import json
import sys
import urllib.request
import webbrowser
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from html import escape
from pathlib import Path

ROOT = Path(__file__).parent.parent
ENV = dict(
    line.split("=", 1) for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines()
    if "=" in line and not line.startswith("#")
)
URL = ENV["SUPABASE_URL"].strip().rstrip("/")
SECRET = ENV["SUPABASE_SERVICE_ROLE_KEY"].strip()
COURSE = json.loads((ROOT / "content" / "course.json").read_text(encoding="utf-8"))
ITEMS = [i for i in COURSE["items"] if i["kind"] != "intro"]
ORDER = {i["id"]: n for n, i in enumerate(ITEMS)}


def call(path, body=None):
    req = urllib.request.Request(URL + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"apikey": SECRET, "Authorization": f"Bearer {SECRET}", "Content-Type": "application/json"},
                                 method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or "null")


def rows(table, cols):
    out, start = [], 0
    while True:
        page = call(f"/rest/v1/{table}?select={cols}&offset={start}&limit=1000")
        out += page
        if len(page) < 1000:
            return out
        start += 1000


def level_for(xp):
    lv = 1
    while 50 * (lv + 1) * lv <= xp:
        lv += 1
    return lv


def when(ts):
    return ts[:10] if ts else "–"


def build():
    users = call("/auth/v1/admin/users?per_page=1000")["users"]
    profiles = {r["user_id"]: r["nickname"] for r in rows("profiles", "user_id,nickname")}
    admins = {r["user_id"] for r in rows("admins", "user_id")}
    attempts = rows("attempts", "user_id,kind,item_id,auto,claimed,out_of,passed,auto_passed,missed,day,at")
    reads = rows("module_reads", "user_id,item_id")
    days = rows("active_days", "user_id,day")

    by_user = defaultdict(list)
    for a in sorted(attempts, key=lambda a: a["at"]):
        by_user[a["user_id"]].append(a)
    read_count = Counter(r["user_id"] for r in reads)
    last_day = {}
    for d in days:
        last_day[d["user_id"]] = max(last_day.get(d["user_id"], ""), d["day"])

    accounts = []
    for u in users:
        uid = u["id"]
        mine = by_user[uid]
        passed = {a["item_id"] for a in mine if a["passed"] and a["kind"] != "recall"}
        furthest = max(passed, key=lambda i: ORDER.get(i, -1), default=None)
        xp = call("/rest/v1/rpc/xp_for", {"uid": uid}) or 0
        accounts.append({
            "nick": profiles.get(uid), "email": u.get("email") or "–", "admin": uid in admins,
            "via": ", ".join(u.get("app_metadata", {}).get("providers", [])) or "email",
            "joined": when(u.get("created_at")), "seen": max(last_day.get(uid, ""), when(u.get("last_sign_in_at"))),
            "xp": xp, "level": level_for(xp), "read": read_count[uid],
            "modules": sum(1 for i in passed if not i.startswith("cp")), "cps": sum(1 for i in passed if i.startswith("cp")),
            "attempts": sum(1 for a in mine if a["kind"] != "recall"),
            "furthest": next((i.get("short") or i["title"] for i in ITEMS if i["id"] == furthest), "–"),
        })
    accounts.sort(key=lambda a: (a["admin"], -a["xp"]))

    # Per module: learners who tried, first-try average, pass rate, average attempts to pass (admins left out).
    learners = {u["id"] for u in users} - admins
    per = {}
    for item in ITEMS:
        tries = defaultdict(list)
        for a in attempts:
            if a["item_id"] == item["id"] and a["kind"] != "recall" and a["user_id"] in learners:
                tries[a["user_id"]].append(a)
        if not tries:
            continue
        firsts = [t[0] for t in (sorted(v, key=lambda a: a["at"]) for v in tries.values())]
        passers = [v for v in tries.values() if any(a["passed"] for a in v)]
        to_pass = [next(n for n, a in enumerate(sorted(v, key=lambda a: a["at"]), 1) if a["passed"]) for v in passers]
        per[item["id"]] = {
            "title": item.get("short") or item["title"], "people": len(tries),
            "first": round(100 * sum(a["auto"] / a["out_of"] for a in firsts) / len(firsts)),
            "pass": round(100 * len(passers) / len(tries)), "tries": round(sum(to_pass) / len(to_pass), 1) if to_pass else None,
        }

    missed = Counter(t for a in attempts if a["user_id"] in learners for t in (a["missed"] or []))
    week_ago = (date.today() - timedelta(days=7)).isoformat()
    real = [a for a in accounts if not a["admin"]]
    stats = [
        ("Accounts", len(real)),
        ("Active in the last 7 days", sum(1 for a in real if a["seen"] >= week_ago)),
        ("On the leaderboard", sum(1 for a in real if a["nick"])),
        ("Quiz and checkpoint attempts", sum(a["attempts"] for a in real)),
    ]
    return accounts, per, missed, stats


def page(accounts, per, missed, stats):
    e = lambda v: escape(str(v)) if v is not None else "–"
    acc = "".join(
        f"<tr><td>{e(a['nick']) if a['nick'] else '<span class=muted>no nickname</span>'}"
        f"{' <span class=tag>admin</span>' if a['admin'] else ''}</td><td>{e(a['email'])}</td><td>{e(a['via'])}</td>"
        f"<td>{e(a['joined'])}</td><td>{e(a['seen'])}</td><td class=n>{a['level']}</td><td class=n>{a['xp']}</td>"
        f"<td class=n>{a['read']}</td><td class=n>{a['modules']}</td><td class=n>{a['cps']}</td><td class=n>{a['attempts']}</td><td>{e(a['furthest'])}</td></tr>"
        for a in accounts)
    mods = "".join(
        f"<tr><td>{e(i)}</td><td>{e(m['title'])}</td><td class=n>{m['people']}</td><td class=n>{m['first']}%</td>"
        f"<td class=n>{m['pass']}%</td><td class=n>{e(m['tries'])}</td></tr>" for i, m in per.items()) \
        or "<tr><td colspan=6 class=muted>No quiz attempts yet.</td></tr>"
    miss = "".join(f"<li>{e(t)} <span class=muted>× {n}</span></li>" for t, n in missed.most_common(15)) \
        or "<li class=muted>Nothing missed yet.</li>"
    tiles = "".join(f"<div class=tile><strong>{n}</strong><span>{e(label)}</span></div>" for label, n in stats)
    made = datetime.now().strftime("%d %b %Y, %H:%M")
    return f"""<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Compound admin</title><style>
:root {{ --bg:#f6f7f5; --card:#fff; --text:#1b1f1c; --muted:#68706b; --line:#e2e5e1; --accent:#0E7C6B; --soft:#e3f2ef; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg:#131614; --card:#1c201d; --text:#e8ebe8; --muted:#9aa29c; --line:#2c322e; --accent:#4cc2ac; --soft:#1d3430; }} }}
body {{ margin:0; background:var(--bg); color:var(--text); font:15px/1.5 system-ui, sans-serif; }}
main {{ max-width:1200px; margin:0 auto; padding:24px 16px 48px; }}
h1 {{ margin:0 0 4px; }} h2 {{ margin:32px 0 10px; font-size:1.1rem; }}
.muted {{ color:var(--muted); }} .tiles {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:12px; margin-top:20px; }}
.tile {{ background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; display:flex; flex-direction:column; }}
.tile strong {{ font-size:1.8rem; color:var(--accent); }} .scroll {{ overflow-x:auto; background:var(--card); border:1px solid var(--line); border-radius:12px; }}
table {{ border-collapse:collapse; width:100%; font-size:0.9rem; }} th, td {{ padding:8px 12px; text-align:left; border-bottom:1px solid var(--line); white-space:nowrap; }}
th {{ color:var(--muted); font-weight:600; }} td.n, th.n {{ text-align:right; font-variant-numeric:tabular-nums; }} tr:last-child td {{ border-bottom:0; }}
.tag {{ background:var(--soft); color:var(--accent); border-radius:6px; padding:1px 6px; font-size:0.75rem; font-weight:600; }}
ol {{ background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px 12px 12px 36px; margin:0; }}
</style></head><body><main>
<h1>Compound admin</h1><p class="muted">Private: built on this computer at {made} from the live database. Notes, guesses and individual answers are left out. Don't share this page.</p>
<div class="tiles">{tiles}</div>
<h2>Accounts</h2><div class="scroll"><table><tr><th>Nickname</th><th>Email</th><th>Sign-in</th><th>Joined</th><th>Last active</th>
<th class=n>Level</th><th class=n>XP</th><th class=n>Read</th><th class=n>Modules passed</th><th class=n>Checkpoints</th><th class=n>Attempts</th><th>Furthest passed</th></tr>{acc}</table></div>
<h2>How each module is going</h2><p class="muted">Admins left out. First try = average auto-marked score on each person's first attempt.</p>
<div class="scroll"><table><tr><th>#</th><th>Module</th><th class=n>People</th><th class=n>First try</th><th class=n>Passed</th><th class=n>Tries to pass</th></tr>{mods}</table></div>
<h2>Most-missed topics</h2>{f"<ol>{miss}</ol>"}
</main></body></html>"""


if __name__ == "__main__":
    out = ROOT / ".tmp" / "admin.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(page(*build()), encoding="utf-8")
    print(f"Written {out}")
    if "--no-open" not in sys.argv:
        webbrowser.open(out.as_uri())
