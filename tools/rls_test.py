"""Privacy and account test against the real Supabase project.

Makes two throwaway accounts (A and B) and checks:
- B can't read or write A's notes, answers or progress (Row Level Security)
- the leaderboard shows only nickname, level and XP
- XP is worked out on the server and claimed marks add nothing
- impossible scores and rude nicknames are rejected
- delete_my_account removes every row for that user
Both test accounts are deleted at the end, pass or fail.

Needs SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env. Run: python tools/rls_test.py
"""
import json
import secrets
import uuid
import sys
import urllib.error
import urllib.request
from pathlib import Path

ENV = dict(
    line.split("=", 1) for line in (Path(__file__).parent.parent / ".env").read_text(encoding="utf-8").splitlines()
    if "=" in line and not line.startswith("#")
)
URL = ENV["SUPABASE_URL"].strip().rstrip("/")
ANON = ENV["SUPABASE_ANON_KEY"].strip()
SECRET = ENV.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
TABLES = ["profiles", "module_reads", "attempts", "srs", "notes", "guesses", "active_days", "settings"]
fails = []


def check(name, cond, extra=""):
    print(("ok   " if cond else "FAIL ") + name + (f"  ({extra})" if extra and not cond else ""))
    if not cond:
        fails.append(name)


def call(method, path, body=None, key=ANON, token=None, prefer=None):
    headers = {"apikey": key, "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    elif key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(URL + path, method=method, headers=headers,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req) as r:
            text = r.read().decode()
            return r.status, json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        try:
            return e.code, json.loads(text)
        except ValueError:
            return e.code, text


def admin(method, path, body=None):
    return call(method, "/auth/v1/admin" + path, body, key=SECRET)


def make_user(tag):
    email = f"compound-test-{tag}-{secrets.token_hex(4)}@example.com"
    password = secrets.token_urlsafe(18) + "aA1!"  # meets any character rule set in Supabase
    s, u = admin("POST", "/users", {"email": email, "password": password, "email_confirm": True})
    assert s in (200, 201), f"create user: {s} {u}"
    s, t = call("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": password})
    assert s == 200, f"sign in: {s} {t}"
    return {"id": u["id"], "token": t["access_token"]}


def rows(table, user, uid_filter=None):
    q = f"/rest/v1/{table}?select=*" + (f"&user_id=eq.{uid_filter}" if uid_filter else "")
    return call("GET", q, token=user["token"])


def main():
    if not SECRET:
        sys.exit("Add SUPABASE_SERVICE_ROLE_KEY (the secret key) to .env first.")
    a, b = make_user("a"), make_user("b")
    try:
        nick_a, nick_b = f"TestA{secrets.token_hex(2)}", f"TestB{secrets.token_hex(2)}"
        post = lambda user, table, body, prefer=None: call("POST", f"/rest/v1/{table}", body, token=user["token"], prefer=prefer)

        check("A saves a profile", post(a, "profiles", {"user_id": a["id"], "nickname": nick_a})[0] == 201)
        s, _ = post(b, "profiles", {"user_id": b["id"], "nickname": "big sex"})
        check("rude nickname rejected", s == 400, s)
        s, _ = post(b, "profiles", {"user_id": b["id"], "nickname": nick_a.upper()})
        check("duplicate nickname rejected (any case)", s == 409, s)
        check("B saves a profile", post(b, "profiles", {"user_id": b["id"], "nickname": nick_b})[0] == 201)
        check("A saves display settings", post(a, "settings", {"user_id": a["id"], "display": {"size": "l", "contrast": "high"}})[0] == 201)
        check("A saves a note", post(a, "notes", {"user_id": a["id"], "item_id": "01", "text": "A's private note"})[0] == 201)
        check("A records a read", post(a, "module_reads", {"user_id": a["id"], "item_id": "01"})[0] == 201)
        check("A records a day", post(a, "active_days", {"user_id": a["id"], "day": "2026-10-27"})[0] == 201)
        att = {"user_id": a["id"], "kind": "quiz", "item_id": "01", "auto": 4, "claimed": 1, "out_of": 7,
               "passed": True, "auto_passed": False, "day": "2026-10-27", "wrong": ["01-rule-72"], "missed": ["rule of 72"]}
        check("A records a quiz attempt", post(a, "attempts", {**att, "id": str(uuid.uuid4())})[0] == 201)

        # B can't see or touch A's rows
        for t in TABLES:
            s, data = rows(t, b, a["id"])
            check(f"B sees none of A's {t}", s == 200 and data == [], f"{s} {data}")
        s, data = rows("notes", b)
        check("B's own notes list has no A notes", all(r["user_id"] == b["id"] for r in data))
        s, _ = post(b, "notes", {"user_id": a["id"], "item_id": "02", "text": "sneaky"})
        check("B can't write a note as A", s in (401, 403), s)
        s, _ = call("PATCH", f"/rest/v1/notes?user_id=eq.{a['id']}", {"text": "changed"}, token=b["token"], prefer="return=representation")
        s2, mine = rows("notes", a)
        check("B can't change A's note", mine and mine[0]["text"] == "A's private note")
        s, _ = call("DELETE", f"/rest/v1/notes?user_id=eq.{a['id']}", token=b["token"])
        check("B can't delete A's note", len(rows("notes", a)[1]) == 1)
        s, data = call("GET", "/rest/v1/notes?select=*")
        check("signed-out visitors see no notes", (s == 200 and data == []) or s == 401, f"{s} {data}")

        # leaderboard
        s, lb = call("GET", f"/rest/v1/leaderboard?select=*&nickname=eq.{nick_a}", token=b["token"])
        check("leaderboard readable", s == 200 and len(lb) == 1, f"{s} {lb}")
        if lb:
            check("leaderboard shows only nickname, level, XP (+ position, is-me)", set(lb[0]) == {"nickname", "level", "xp", "pos", "is_me"}, lb[0])
            check("A's XP = 20 read + 40 marks + 10 day = 70 (claim adds nothing)", lb[0]["xp"] == 70, lb[0])
            check("is_me false for B looking at A", lb[0]["is_me"] is False)
        att2 = {**att, "auto": 4, "claimed": 3, "id": str(uuid.uuid4())}
        post(a, "attempts", att2)
        s, lb = call("GET", f"/rest/v1/leaderboard?select=xp&nickname=eq.{nick_a}")
        check("more claimed marks still 70 XP (signed-out view)", lb and lb[0]["xp"] == 70, lb)

        # validation
        bad = {**att, "auto": 9, "out_of": 7, "id": str(uuid.uuid4())}
        check("impossible score rejected", post(a, "attempts", bad)[0] == 400)
        with_recall = {**att, "item_id": "02", "auto": 0, "claimed": 0, "passed": False, "recall_auto": 4, "recall_out_of": 4}
        check("quiz attempt with a recall part saves", post(a, "attempts", {**with_recall, "id": str(uuid.uuid4())})[0] == 201)
        s, lb = call("GET", f"/rest/v1/leaderboard?select=xp&nickname=eq.{nick_a}")
        check("recall part adds no mark XP (still 70)", lb and lb[0]["xp"] == 70, lb)
        check("impossible recall part rejected", post(a, "attempts", {**with_recall, "recall_auto": 5, "id": str(uuid.uuid4())})[0] == 400)
        other = {**att, "item_id": "econ-aqa:4.1.1.1", "auto": 0, "claimed": 0, "passed": False, "id": str(uuid.uuid4())}
        check("other course's item id accepted", post(a, "attempts", other)[0] == 201)
        check("junk item id rejected", post(a, "attempts", {**other, "item_id": "drop table", "id": str(uuid.uuid4())})[0] == 400)
        # nickname lock: 7 days after it's set, enforced by the database
        patch = lambda body: call("PATCH", f"/rest/v1/profiles?user_id=eq.{b['id']}", body, token=b["token"], prefer="return=representation")
        s, err = patch({"nickname": nick_b + "x"})
        check("nickname locked right after it's set", s == 400 and isinstance(err, dict) and err.get("code") == "CN001", f"{s} {err}")
        patch({"nickname_changed_at": "2000-01-01T00:00:00Z", "nickname_must_change": True})
        s, me = rows("profiles", b)
        check("lock date and teacher-reset flag can't be set by the user", me and me[0]["nickname_must_change"] is False and me[0]["nickname_changed_at"] > "2026", me)
        s, err = patch({"nickname": nick_b + "y"})
        check("still locked after trying to move the date", s == 400 and isinstance(err, dict) and err.get("code") == "CN001", f"{s} {err}")
        s, data = rows("settings", b, a["id"])
        check("B can't see A's display settings", s == 200 and data == [], f"{s} {data}")

        # exam dates (P2): saved on the settings row, private, size-limited
        exams = {"list": [{"id": "x1", "name": "Economics mock", "date": "2026-12-07", "course": "money"}], "updatedAt": "2026-10-30T10:00:00Z"}
        s, _ = call("PATCH", f"/rest/v1/settings?user_id=eq.{a['id']}", {"exams": exams}, token=a["token"])
        check("A saves exam dates", s in (200, 204), s)
        s, mine = rows("settings", a)
        check("exam dates kept beside display settings", mine and mine[0]["exams"]["list"][0]["name"] == "Economics mock" and mine[0]["display"].get("size") == "l", mine)
        s, data = call("GET", f"/rest/v1/settings?select=exams&user_id=eq.{a['id']}", token=b["token"])
        check("B can't see A's exam dates", s == 200 and data == [], f"{s} {data}")
        s, _ = call("PATCH", f"/rest/v1/settings?user_id=eq.{a['id']}", {"exams": {"list": [{"name": "x" * 5000}]}}, token=a["token"])
        check("huge exam list rejected", s == 400, s)
        s, _ = call("PATCH", f"/rest/v1/settings?user_id=eq.{a['id']}", {"exams": ["not", "an", "object"]}, token=a["token"])
        check("exam dates must be an object", s == 400, s)
        s, _ = post(b, "settings", {"user_id": a["id"], "exams": exams})
        check("B can't write A's exam dates", s in (401, 403, 409), s)

        # score guards: the full set is in tools/classes_sql_test.mjs
        fake = {**att, "item_id": "econ-aqa:nope", "id": str(uuid.uuid4())}
        post(a, "attempts", fake)
        s, data = call("GET", f"/rest/v1/attempts?select=id&id=eq.{fake['id']}", token=a["token"])
        check("a score for a fake lesson is dropped", s == 200 and data == [], f"{s} {data}")
        s, data = call("DELETE", f"/rest/v1/attempts?user_id=eq.{a['id']}", token=a["token"], prefer="return=representation")
        check("saved scores can't be deleted", s in (200, 204, 403) and not data, f"{s} {data}")
        s, data = call("PATCH", f"/rest/v1/attempts?user_id=eq.{a['id']}", {"auto": 7}, token=a["token"], prefer="return=representation")
        check("saved scores can't be edited", s in (200, 204, 403) and not data, f"{s} {data}")

        # classes (P4): the full set of attacks is in tools/classes_sql_test.mjs; this proves they hold on the real database
        rpc = lambda u, fn, body=None: call("POST", f"/rest/v1/rpc/{fn}", body or {}, token=u["token"])
        s, status = rpc(a, "become_teacher", {"p_name": "Test Teacher"})
        check("A becomes an unverified teacher", s == 200 and status == "unverified", f"{s} {status}")
        s, _ = call("PATCH", f"/rest/v1/teachers?user_id=eq.{a['id']}", {"status": "verified"}, token=a["token"], prefer="return=representation")
        s2, me = call("GET", f"/rest/v1/teachers?select=status&user_id=eq.{a['id']}", token=a["token"])
        check("A can't verify themselves", me and me[0]["status"] == "unverified", f"{s} {me}")
        s, cid = rpc(a, "create_class", {"p_name": "Test class", "p_course": "econ-aqa"})
        check("A makes a class", s == 200, f"{s} {cid}")
        s, mine = rpc(a, "teacher_classes")
        code = mine[0]["join_code"]
        s, data = rpc(b, "class_roster", {"p_class": cid})
        check("B can't read the roster", s in (401, 403), f"{s} {data}")
        s, data = rpc(b, "update_class", {"p_class": cid, "p_name": "x", "p_joining_open": True, "p_leaderboard_on": True})
        check("B can't change the class", s in (401, 403), f"{s} {data}")
        s, data = rpc(b, "join_class", {"p_code": code, "p_real_name": "Bee Test", "p_consent": False})
        check("no consent, no join", s == 400 and data.get("code") == "CN106", f"{s} {data}")
        s, data = rpc(b, "join_class", {"p_code": code, "p_real_name": "Bee Test", "p_consent": True})
        check("B joins with consent", s == 200, f"{s} {data}")
        s, data = rpc(a, "class_roster", {"p_class": cid})
        check("A sees B's real name", s == 200 and data and data[0]["real_name"] == "Bee Test", f"{s} {data}")
        s, data = rpc(b, "class_leaderboard", {"p_class": cid})
        check("the class leaderboard has no real names", s == 200 and "Bee Test" not in json.dumps(data), f"{s} {data}")
        s, data = call("GET", "/rest/v1/class_members?select=real_name", key=ANON)
        check("the public can't read class members", s in (200, 401, 403) and not data or isinstance(data, dict), f"{s} {data}")
        s, data = call("GET", "/rest/v1/classes?select=join_code", token=b["token"])
        check("a student can't list join codes", s == 200 and data == [], f"{s} {data}")
        s, _ = rpc(b, "leave_class", {"p_class": cid})
        s, data = rpc(b, "my_classes")
        check("B can leave", s == 200 and data == [], f"{s} {data}")
        s, _ = rpc(a, "delete_class", {"p_class": cid})
        check("A deletes the class", s in (200, 204), s)

        # delete account
        s, _ = call("POST", "/rest/v1/rpc/delete_my_account", {}, token=a["token"])
        check("A deletes their account", s in (200, 204), s)
        for t in TABLES:
            s, data = call("GET", f"/rest/v1/{t}?select=user_id&user_id=eq.{a['id']}", key=SECRET)
            check(f"no {t} rows left for A", s == 200 and data == [], f"{s} {data}")
        s, _ = admin("GET", f"/users/{a['id']}")
        check("A's login is gone", s == 404, s)
    finally:
        for u in (a, b):
            admin("DELETE", f"/users/{u['id']}")
    print(f"{len(fails)} failed")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
