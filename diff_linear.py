import json, os, shutil

INBOX = "/opt/data/jericho/inbox/realtime"
ARCHIVE = "/opt/data/jericho/inbox/archive"

files = sorted(
    [f for f in os.listdir(INBOX) if f.startswith("linear-changes-") and f.endswith(".json")],
    reverse=True
)

def load_snapshot(path):
    with open(path) as f:
        return json.load(f)

newest = load_snapshot(os.path.join(INBOX, files[0]))
second = load_snapshot(os.path.join(INBOX, files[1]))

newest_ts = files[0].replace("linear-changes-", "").replace(".json", "")
second_ts = files[1].replace("linear-changes-", "").replace(".json", "")

def build_index(data):
    idx = {}
    for t in data.get("changes", []):
        tid = t.get("id")
        if tid:
            idx[tid] = t
    return idx

new_idx = build_index(newest)
old_idx = build_index(second)

new_ids = set(new_idx.keys())
old_ids = set(old_idx.keys())

print(f"=== LINEAR DELTA ===")
print(f"Newer: {newest_ts} | Older: {second_ts}")
print(f"Ticket count: {len(new_idx)} (was {len(old_idx)})")

added = new_ids - old_ids
removed = old_ids - new_ids
common = new_ids & old_ids

if added:
    print(f"\nNEW ({len(added)}):")
    for tid in sorted(added):
        t = new_idx[tid]
        print(f"  + {tid}: \"{t.get('title','?')}\" [{t.get('state','?')}] -> {t.get('assignee','unassigned')}")

if removed:
    print(f"\nDROPPED ({len(removed)}):")
    for tid in sorted(removed):
        t = old_idx[tid]
        print(f"  - {tid}: \"{t.get('title','?')}\"")

changes = []
for tid in sorted(common):
    nt, ot = new_idx[tid], old_idx[tid]
    deltas = {}
    for field in ["state", "assignee", "priority"]:
        nv = nt.get(field)
        ov = ot.get(field)
        if str(nv) != str(ov):
            deltas[field] = (ov, nv)
    if deltas:
        changes.append((tid, nt, deltas))

if changes:
    print(f"\nSTATE CHANGES ({len(changes)}):")
    for tid, t, deltas in changes:
        title = t.get("title", "?")
        parts = [f"{f}: {old} -> {new}" for f, (old, new) in deltas.items()]
        print(f"  ~ {tid}: \"{title}\" | {' | '.join(parts)}")

if not added and not removed and not changes:
    print("\nNo changes detected.")

# Archive older than 3 newest
os.makedirs(ARCHIVE, exist_ok=True)
to_archive = files[3:]
if to_archive:
    print(f"\nARCHIVING {len(to_archive)}:")
    for f in to_archive:
        shutil.move(os.path.join(INBOX, f), os.path.join(ARCHIVE, f))
        print(f"  -> {f}")
else:
    print(f"\nNo archive needed ({len(files)} total, keeping 3).")

remaining = sorted([f for f in os.listdir(INBOX) if f.startswith("linear-changes-")])
print(f"Remaining: {len(remaining)}")
