#!/usr/bin/env python3
"""
add-caddy-route.py — idempotently add the boomerang webhook route to a Caddyfile.

Usage: add-caddy-route.py CADDYFILE   # add /webhooks/dev/github -> 127.0.0.1:9124
       add-caddy-route.py --check CADDYFILE   # exit 0 if present

Backups nothing itself (the installer backs up first). Never touches the live
service — run the caddy validate + reload separately.
"""
import re
import sys

ROUTE = """\t\t@devgithub path /webhooks/dev/github
\t\thandle @devgithub {
\t\t\turi strip_prefix /webhooks/dev/github
\t\t\treverse_proxy 127.0.0.1:9124
\t\t}

"""


def present(text: str) -> bool:
    return "@devgithub" in text and "127.0.0.1:9124" in text


def add(path: str) -> bool:
    text = open(path, encoding="utf-8").read()
    if present(text):
        return False  # nothing to do
    # insert the block before the first bare fallback proxy ('reverse_proxy localhost')
    new = re.sub(
        r"(?m)^(\s*reverse_proxy\s+localhost.*)$",
        lambda m: ROUTE.rstrip("\n") + "\n\n" + m.group(1),
        text,
        count=1,
    )
    if new == text:
        # fallback: append at the end of the first matching route block
        m = re.search(r"(?ms)^(crm\.[^\n]*\s*\{[^}]*)\}", text)
        if not m:
            return False
        new = text[: m.end(1)] + "\n" + ROUTE + "}" + text[m.end(1) + 1:]
    open(path, "w", encoding="utf-8").write(new)
    return True


def main(argv):
    if len(argv) < 2:
        print("usage: add-caddy-route.py [--check] CADDYFILE", file=sys.stderr)
        return 2
    check = argv[1] == "--check"
    path = argv[2] if check else argv[1]
    if check:
        print("present" if present(open(path, encoding="utf-8").read()) else "absent")
        return 0 if present(open(path, encoding="utf-8").read()) else 1
    changed = add(path)
    print("route added" if changed else "route already present")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
