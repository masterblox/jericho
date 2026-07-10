#!/usr/bin/env python3
"""Jericho Task Queue CLI — operational queue for Carlos.
Sources: voice (transcribed), chat (directives), bridge (agent handoffs), cron, linear, paperclip.
Usage:
  python3 task-queue.py add --title "Fix X" --source chat --priority high
  python3 task-queue.py list [--status open] [--limit 10]
  python3 task-queue.py update <id> --status in_progress [--note "Working on it"]
  python3 task-queue.py summary  # compact table for morning briefing
  python3 task-queue.py import-tickets  # sync from TICKETS.md
"""

import sqlite3
import argparse
import json
import os
import sys
from datetime import datetime

DB_PATH = "/opt/data/jericho/state/task-queue.db"


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def log_action(conn, task_id, action, old_value="", new_value="", note=""):
    conn.execute(
        "INSERT INTO queue_log (task_id, action, old_value, new_value, note) VALUES (?,?,?,?,?)",
        (task_id, action, old_value, new_value, note),
    )
    conn.commit()


def add_task(args):
    conn = get_db()
    cur = conn.execute(
        """INSERT INTO tasks (title, description, source, priority, agent_assigned, due_date, voice_file_id, transcribed_text, raw_context)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (
            args.title,
            args.description or "",
            args.source or "chat",
            args.priority or "medium",
            args.agent or "",
            args.due or None,
            args.voice_id or None,
            args.transcribed or "",
            args.context or "",
        ),
    )
    task_id = cur.lastrowid
    log_action(conn, task_id, "created", note=f"Source: {args.source or 'chat'}")
    conn.close()
    print(f"Created task #{task_id}: {args.title}")


def list_tasks(args):
    conn = get_db()
    status_filter = args.status or "open"
    limit = args.limit or 50

    if status_filter == "open":
        where = "status NOT IN ('done', 'deferred')"
    elif status_filter == "all":
        where = "1=1"
    else:
        where = f"status = '{status_filter}'"

    rows = conn.execute(
        f"""SELECT id, title, status, priority, agent_assigned, source, created_at, due_date
            FROM tasks WHERE {where}
            ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at DESC
            LIMIT ?""",
        (limit,),
    ).fetchall()

    if args.format == "json":
        print(json.dumps([dict(r) for r in rows], indent=2))
    else:
        print(f"{'ID':<5} {'ST':<12} {'PRI':<6} {'AGENT':<8} {'SRC':<8} {'TITLE'}")
        print("-" * 80)
        for r in rows:
            title = r["title"][:55] if r["title"] else ""
            print(
                f"#{r['id']:<4} {r['status']:<12} {r['priority']:<6} {r['agent_assigned'] or '-':<8} {r['source']:<8} {title}"
            )
        print(f"\n{len(rows)} tasks")

    conn.close()


def update_task(args):
    conn = get_db()
    task_id = args.id

    existing = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not existing:
        print(f"Task #{task_id} not found")
        conn.close()
        sys.exit(1)

    updates = []
    params = []

    if args.status:
        old_status = existing["status"]
        updates.append("status = ?")
        params.append(args.status)
    if args.priority:
        updates.append("priority = ?")
        params.append(args.priority)
    if args.agent:
        updates.append("agent_assigned = ?")
        params.append(args.agent)
    if args.title:
        updates.append("title = ?")
        params.append(args.title)
    if args.due:
        updates.append("due_date = ?")
        params.append(args.due)

    if updates:
        updates.append("updated_at = datetime('now')")
        params.append(task_id)
        conn.execute(f"UPDATE tasks SET {', '.join(updates)} WHERE id = ?", params)

        if args.status and args.status != old_status:
            log_action(
                conn,
                task_id,
                "status_change",
                old_value=old_status,
                new_value=args.status,
                note=args.note or "",
            )
        elif args.note:
            log_action(conn, task_id, "note", note=args.note)
        else:
            log_action(conn, task_id, "updated")

    conn.commit()
    updated = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    conn.close()
    print(f"Updated #{task_id}: [{updated['status']}] {updated['title']}")


def summary(args):
    """Compact morning-briefing format for Carlos."""
    conn = get_db()

    # Open tasks grouped by priority
    high = conn.execute(
        "SELECT id, title, status, agent_assigned FROM tasks WHERE priority='high' AND status NOT IN ('done','deferred') ORDER BY status, id"
    ).fetchall()
    medium = conn.execute(
        "SELECT id, title, status, agent_assigned FROM tasks WHERE priority='medium' AND status NOT IN ('done','deferred') ORDER BY status, id"
    ).fetchall()
    low = conn.execute(
        "SELECT id, title, status, agent_assigned FROM tasks WHERE priority='low' AND status NOT IN ('done','deferred') ORDER BY status, id"
    ).fetchall()

    # Recent activity
    recent = conn.execute(
        "SELECT ql.task_id, ql.action, ql.new_value, ql.note, ql.timestamp, t.title "
        "FROM queue_log ql JOIN tasks t ON ql.task_id = t.id "
        "ORDER BY ql.timestamp DESC LIMIT 5"
    ).fetchall()

    # Voice tasks (new from transcription)
    voice_new = conn.execute(
        "SELECT id, title, transcribed_text FROM tasks WHERE source='voice' AND status='new' LIMIT 5"
    ).fetchall()

    # Counts
    counts = conn.execute(
        "SELECT status, COUNT(*) as cnt FROM tasks GROUP BY status"
    ).fetchall()
    count_map = {r["status"]: r["cnt"] for r in counts}
    total = sum(count_map.values())
    open_count = total - count_map.get("done", 0) - count_map.get("deferred", 0)

    # Print compact summary
    now = datetime.now()
    print(f"TASK QUEUE — {now.strftime('%a %d %b %Y, %H:%M DXB')}")
    print(f"Open: {open_count} | Done: {count_map.get('done', 0)} | Blocked: {count_map.get('blocked', 0)} | Total: {total}")
    print()

    if high:
        print("HIGH PRIORITY:")
        for t in high:
            print(f"  #{t['id']} [{t['status']}] {t['agent_assigned'] or '?'} — {t['title']}")
        print()

    if voice_new:
        print("NEW FROM VOICE:")
        for t in voice_new:
            snippet = (t["transcribed_text"] or t["title"])[:80]
            print(f"  #{t['id']} — {snippet}")
        print()

    if medium:
        print(f"MEDIUM ({len(medium)}):")
        for t in medium:
            print(f"  #{t['id']} [{t['status']}] {t['agent_assigned'] or '?'} — {t['title'][:60]}")
        print()

    if low:
        print(f"LOW ({len(low)}):")
        for t in low:
            print(f"  #{t['id']} [{t['status']}] {t['agent_assigned'] or '?'} — {t['title'][:60]}")
        print()

    if recent:
        print("RECENT ACTIVITY:")
        for r in recent:
            ts = r["timestamp"]
            print(f"  #{r['task_id']} {r['action']} — {r['new_value'] or r['note'] or r['title'][:40]} ({ts})")

    conn.close()


def import_tickets(args):
    """Sync open items from TICKETS.md into the queue."""
    import re

    tickets_path = "/opt/conductor-bridge/outbox/engineer-messages/TICKETS.md"
    if not os.path.exists(tickets_path):
        print(f"TICKETS.md not found at {tickets_path}")
        sys.exit(1)

    with open(tickets_path) as f:
        content = f.read()

    conn = get_db()

    # Parse the DEV and PA sections
    for line in content.split("\n"):
        match = re.match(r"\|\s*(DEV|PA)#(\d+)\s*\|\s*(.+?)\s*\|\s*(OPEN|IN_PROGRESS|BLOCKED|PARKED)\s*\|", line)
        if match:
            lane, num, slug, status = match.groups()
            ticket_id = f"{lane}#{num}"

            # Map TICKETS.md status to queue status
            status_map = {
                "OPEN": "new",
                "IN_PROGRESS": "in_progress",
                "BLOCKED": "blocked",
                "PARKED": "deferred",
            }
            q_status = status_map.get(status, "new")

            agent = "DEV" if lane == "DEV" else "PA"

            # Check if already exists
            existing = conn.execute(
                "SELECT id FROM tasks WHERE raw_context = ?", (ticket_id,)
            ).fetchone()
            if existing:
                continue

            conn.execute(
                """INSERT INTO tasks (title, description, source, status, priority, agent_assigned, raw_context)
                   VALUES (?,?,?,?,?,?,?)""",
                (slug.strip(), "", "bridge", q_status, "medium", agent, ticket_id),
            )

    conn.commit()
    count = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
    conn.close()
    print(f"Import complete. Queue now has {count} tasks.")


def main():
    parser = argparse.ArgumentParser(description="Jericho Task Queue CLI")
    sub = parser.add_subparsers(dest="command")

    # add
    add_p = sub.add_parser("add")
    add_p.add_argument("--title", required=True)
    add_p.add_argument("--description", default="")
    add_p.add_argument("--source", default="chat")
    add_p.add_argument("--priority", default="medium")
    add_p.add_argument("--agent", default="")
    add_p.add_argument("--due", default=None)
    add_p.add_argument("--voice-id", default=None)
    add_p.add_argument("--transcribed", default="")
    add_p.add_argument("--context", default="")

    # list
    list_p = sub.add_parser("list")
    list_p.add_argument("--status", default="open")
    list_p.add_argument("--limit", type=int, default=50)
    list_p.add_argument("--format", default="table")

    # update
    update_p = sub.add_parser("update")
    update_p.add_argument("id", type=int)
    update_p.add_argument("--status", default=None)
    update_p.add_argument("--priority", default=None)
    update_p.add_argument("--agent", default=None)
    update_p.add_argument("--title", default=None)
    update_p.add_argument("--due", default=None)
    update_p.add_argument("--note", default=None)

    # summary
    sub.add_parser("summary")

    # import-tickets
    sub.add_parser("import-tickets")

    args = parser.parse_args()

    if args.command == "add":
        add_task(args)
    elif args.command == "list":
        list_tasks(args)
    elif args.command == "update":
        update_task(args)
    elif args.command == "summary":
        summary(args)
    elif args.command == "import-tickets":
        import_tickets(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
