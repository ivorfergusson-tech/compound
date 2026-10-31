"""Writes the list of real items and their top scores into supabase/schema.sql, between the two marker lines.

The database uses it to drop scores for lessons that don't exist, or out of more marks than a quiz can give.
Run this after adding a course or changing a quiz, then run schema.sql in Supabase: python tools/known_items.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
START, END = "-- known items: start (written by tools/known_items.py)", "-- known items: end"
SLACK = 2  # an out-of-date browser can still be holding a slightly older quiz
CHECKPOINT_MAX, REFRESH_MAX = 60, 60


def rows():
    reg = json.loads((ROOT / "content" / "courses.json").read_text(encoding="utf-8"))
    out = {"rf": REFRESH_MAX}
    for entry in reg["courses"]:
        folder = ROOT / entry["path"]
        if not (folder / "course.json").exists():
            continue
        course = json.loads((folder / "course.json").read_text(encoding="utf-8"))
        key = (lambda i: i) if course.get("legacyIds") else (lambda i, c=course["id"]: f"{c}:{i}")
        for item in course["items"]:
            top = 0
            if item["kind"] == "checkpoint":
                top = CHECKPOINT_MAX
            elif item["kind"] == "module":
                quiz = json.loads((folder / "quizzes" / f"{item['id']}.json").read_text(encoding="utf-8"))
                marks = sorted((q.get("marks") or len(q.get("ideas", [])) or 1 for q in quiz["questions"]), reverse=True)
                top = sum(marks[:quiz["pick"]]) + SLACK
            out[key(item["id"])] = top
    return out


def main():
    items = rows()
    values = ",\n".join(f"  ('{k}', {v})" for k, v in sorted(items.items()))
    block = f"{START}\ndelete from public.known_items;\ninsert into public.known_items (item_id, max_out) values\n{values};\n{END}"
    path = ROOT / "supabase" / "schema.sql"
    sql = path.read_text(encoding="utf-8")
    a, b = sql.index(START), sql.index(END) + len(END)
    path.write_text(sql[:a] + block + sql[b:], encoding="utf-8", newline="\n")
    print(f"{len(items)} items")


if __name__ == "__main__":
    main()
