"""Deletes handed-in photos that are due to go: 90 days after marking, or left behind by a deleted account or class.

Run daily by .github/workflows/purge-photos.yml, or by hand: python tools/purge_photos.py
Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment or .env. Prints counts, never names or paths.
"""
import json
import os
import sys
import urllib.request
from pathlib import Path


def env(name):
    if os.environ.get(name):
        return os.environ[name].strip()
    f = Path(__file__).parent.parent / ".env"
    for line in f.read_text(encoding="utf8").splitlines() if f.exists() else []:
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip()
    return ""


URL, KEY = env("SUPABASE_URL").rstrip("/"), env("SUPABASE_SERVICE_ROLE_KEY")


def call(method, path, body):
    req = urllib.request.Request(URL + path, json.dumps(body).encode(), method=method,
                                 headers={"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        text = r.read().decode()
    return json.loads(text) if text else None


def main():
    if not URL or not KEY:
        print("Not set up yet: no Supabase URL or service key.")
        return 0
    paths = call("POST", "/rest/v1/rpc/photos_expired", {}) or []
    for i in range(0, len(paths), 100):
        batch = paths[i:i + 100]
        call("DELETE", "/storage/v1/object/handins", {"prefixes": batch}) # the rows go only once the files have
        call("POST", "/rest/v1/rpc/photos_purged", {"p_paths": batch})
    print(f"{len(paths)} photos deleted")
    return 0


if __name__ == "__main__":
    sys.exit(main())
