"""Builds content/courses/econ-aqa/papers.json from the catalogue in the vault. Links only: we never host papers.

Run: python tools/build_papers.py, then python tools/check_papers.py to test every link.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent
CAT = ROOT.parent / "claude v1.5" / "03 School" / "Papers" / "catalogue.md"
OUT = ROOT / "content" / "courses" / "econ-aqa" / "papers.json"
BOUNDARIES = {
    "series": "June 2026", "max": 240, "grades": {"A*": 178, "A": 154, "B": 132, "C": 110, "D": 88, "E": 66},
    "source": "https://wqe.ac.uk/wp-content/uploads/2026/08/Grade-boundaries-June-26.pdf",
    "sourceName": "WQE College's table of the June 2026 boundaries", "official": "https://www.aqa.org.uk/exams-administration/results-days/grade-boundaries",
    "checked": "2026-10-31",
}


def main():
    papers = []
    section = False
    for line in CAT.read_text(encoding="utf8").splitlines():
        if line.startswith("## "):
            section = line.startswith("## Economics")
        m = re.match(r"\|\s*(E-[A-Z0-9-]+)\s*\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|", line) if section else None
        if not m:
            continue
        pid, series, name, qp, ms = (x.strip() for x in m.groups())
        links = dict(re.findall(r"\[([^\]]+)\]\((https://[^)]+)\)", qp))
        marks = re.findall(r"\[[^\]]+\]\((https://[^)]+)\)", ms)
        papers.append({"id": pid, "series": series, "paper": int(pid[-1]), "name": name, "marks": 80, "minutes": 120,
                       "qp": links.get("QP"), "insert": links.get("Insert"), "ms": marks[0] if marks else None, "source": "Physics & Maths Tutor"})
    OUT.write_text(json.dumps({"boundaries": BOUNDARIES, "papers": papers}, indent=1, ensure_ascii=False) + "\n", encoding="utf8", newline="\n")
    print(len(papers), "papers")


if __name__ == "__main__":
    main()
