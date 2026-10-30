"""Compare a course's spec map with the official specification PDF.

    python tools/spec_points.py econ-aqa            (downloads the spec from the map's "source" into .tmp/)
    python tools/spec_points.py econ-aqa spec.pdf   (uses a PDF you already have)

Reads the spec's version and date and every section 4 point (number and heading), then lists anything
added, removed or renamed compared with content/courses/<course>/specmap.json. Exit code 1 if they differ.
Run it each September (UPDATING.md). Needs pypdf (pip install pypdf).
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

import pypdf

ROOT = Path(__file__).resolve().parent.parent
JUNK = re.compile(r"^(AQA AS and A-level \w+ \.|Visit for the most up-to-date|\d+\s+Visit for the most|Content Additional information$)")
HEAD = re.compile(r"^(4\.[12](?:\.\d+){0,2})\s+(.+)$")


def read_points(pdf):
    """Version, date and {point id: heading} for every lowest-level section 4 point."""
    text = "\n".join(p.extract_text() or "" for p in pypdf.PdfReader(pdf).pages)
    m = re.search(r"Version (\d+(?:\.\d+)*)\s+(\d{1,2} \w+ \d{4})", text)
    lines = [l.strip() for l in text.splitlines()]
    start = next(i for i, l in enumerate(lines) if i > 100 and re.match(r"^4\.1 \S", l))
    end = next(i for i, l in enumerate(lines) if i > start and re.match(r"^5\s+Scheme of assessment", l))
    body = [l for l in lines[start:end] if l and not JUNK.match(l)]
    points = {}
    for i, l in enumerate(body):
        h = HEAD.match(l)
        if not h or h.group(1).count(".") != 3:
            continue
        title, j = h.group(2), i + 1
        # headings that wrap onto a second line
        while j < len(body) and not body[j].startswith("•") and not HEAD.match(body[j]) and (body[j][0].islower() or (len(title) > 70 and len(body[j]) < 60)):
            title += " " + body[j]
            j += 1
        points[h.group(1)] = title
    return (m.group(1), m.group(2)) if m else (None, None), points


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    course = sys.argv[1]
    spec = json.loads((ROOT / f"content/courses/{course}/specmap.json").read_text(encoding="utf-8"))
    if len(sys.argv) > 2:
        pdf = Path(sys.argv[2])
    else:
        pdf = ROOT / ".tmp" / f"{course}-spec.pdf"
        pdf.parent.mkdir(exist_ok=True)
        urllib.request.urlretrieve(spec["source"], pdf)
    (version, date), found = read_points(pdf)
    print(f"PDF: version {version}, {date}. Map: version {spec['specVersion']}, {spec['specDate']}.")
    mapped = {p["id"]: p["title"] for p in spec["points"]}
    added = sorted(set(found) - set(mapped))
    removed = sorted(set(mapped) - set(found))
    renamed = sorted(k for k in set(found) & set(mapped) if found[k] != mapped[k])
    for k in added:
        print(f"NEW in the PDF: {k} {found[k]}")
    for k in removed:
        print(f"GONE from the PDF: {k} {mapped[k]}")
    for k in renamed:
        print(f"RENAMED {k}: map '{mapped[k]}' -> PDF '{found[k]}'")
    same = not (added or removed or renamed) and version == spec["specVersion"]
    print(f"{len(found)} points in the PDF. " + ("Map matches." if same else "Map needs updating (and specVersion/specDate)."))
    sys.exit(0 if same else 1)


if __name__ == "__main__":
    main()
