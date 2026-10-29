"""Adds or updates glossary terms. Usage: python -X utf8 tools/glossary_add.py terms.json
terms.json: {"key": {"term": "...", "def": "...", "module": "05"}, ...}"""
import json
import sys
from pathlib import Path

p = Path(__file__).parent.parent / "content" / "courses" / "money" / "glossary.json"
g = json.loads(p.read_text(encoding="utf-8"))
new = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
g.update({k.lower(): v for k, v in new.items()})
g = dict(sorted(g.items()))
p.write_text(json.dumps(g, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"{len(new)} added or updated, {len(g)} terms")
