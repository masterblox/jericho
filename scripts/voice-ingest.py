#!/usr/bin/env python3
"""Voice note ingestion bridge for Jericho task queue.
Transcribes Telegram voice notes via faster-whisper (local) and creates queue entries.

Usage:
  python3 voice-ingest.py --file /path/to/voice.ogg
  python3 voice-ingest.py --file-id <telegram_file_id>  # downloads from Telegram API
  python3 voice-ingest.py --process-inbox  # scans jericho/voice-inbox/ for new files
"""

import argparse
import json
import os
import sys
import time
import sqlite3
from pathlib import Path

# Paths
QUEUE_DB = "/opt/data/jericho/state/task-queue.db"
VOICE_INBOX = "/opt/data/jericho/voice-inbox"
VOICE_ARCHIVE = "/opt/data/jericho/voice-inbox/archive"
STATE_FILE = "/opt/data/jericho/state/voice-ingest-state.json"

# faster-whisper model — downloaded on first use from HuggingFace
WHISPER_MODEL = "base"  # tiny/base/small/medium/large-v3


def transcribe(file_path: str) -> dict:
    """Transcribe audio via faster-whisper (local). Returns {text, language, duration} or raises."""
    from faster_whisper import WhisperModel

    model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
    segments, info = model.transcribe(file_path, beam_size=5)

    text = " ".join(seg.text for seg in segments).strip()
    return {
        "text": text,
        "language": info.language,
        "duration": info.duration,
    }


def create_task_from_voice(transcript: str, voice_file_id: str = "", source_file: str = ""):
    """Create a task queue entry from transcribed voice note."""
    conn = sqlite3.connect(QUEUE_DB)
    conn.execute("PRAGMA journal_mode=WAL")

    # Generate a concise title from the first 100 chars of transcript
    title = transcript[:100].strip()
    if len(transcript) > 100:
        title += "..."

    # Detect priority keywords
    priority = "medium"
    urgent_words = ["urgent", "asap", "critical", "emergency", "today", "now", "immediately"]
    high_words = ["important", "priority", "high", "soon", "tomorrow", "fix", "broken", "down", "dead"]
    low_words = ["whenever", "someday", "eventually", "low priority", "nice to have", "minor"]

    tlower = transcript.lower()
    if any(w in tlower for w in urgent_words):
        priority = "high"
    elif any(w in tlower for w in high_words) and not any(w in tlower for w in low_words):
        priority = "high"
    elif all(w in tlower for w in low_words):
        priority = "low"

    cur = conn.execute(
        """INSERT INTO tasks (title, description, source, priority, transcribed_text, voice_file_id, raw_context)
           VALUES (?,?,?,?,?,?,?)""",
        (title, transcript, "voice", priority, transcript, voice_file_id, source_file),
    )
    task_id = cur.lastrowid

    conn.execute(
        "INSERT INTO queue_log (task_id, action, note) VALUES (?,?,?)",
        (task_id, "created", f"Voice note transcribed — {len(transcript)} chars"),
    )
    conn.commit()
    conn.close()
    return task_id


def download_telegram_file(file_id: str, output_path: str) -> bool:
    """Download a file from Telegram Bot API using getFile."""
    import urllib.request

    # Get bot token from environment or .env
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    if not bot_token:
        for src in ["/opt/data/.env", "/opt/data/.env.jericho"]:
            if os.path.exists(src):
                with open(src) as f:
                    for line in f:
                        if "TELEGRAM_BOT_TOKEN" in line:
                            bot_token = line.split("=", 1)[1].strip().strip("\"'")

    if not bot_token:
        raise RuntimeError("No TELEGRAM_BOT_TOKEN found")

    # Step 1: getFile
    get_file_url = f"https://api.telegram.org/bot{bot_token}/getFile?file_id={file_id}"
    try:
        with urllib.request.urlopen(get_file_url, timeout=30) as resp:
            file_info = json.loads(resp.read().decode())
    except Exception as e:
        raise RuntimeError(f"Telegram getFile failed: {e}")

    if not file_info.get("ok"):
        raise RuntimeError(f"Telegram getFile error: {file_info}")

    file_path = file_info["result"]["file_path"]

    # Step 2: download
    download_url = f"https://api.telegram.org/file/bot{bot_token}/{file_path}"
    try:
        with urllib.request.urlopen(download_url, timeout=120) as resp:
            data = resp.read()
    except Exception as e:
        raise RuntimeError(f"Telegram download failed: {e}")

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(data)

    return True


def process_inbox():
    """Scan voice-inbox/ for new audio files, transcribe, create tasks, archive."""
    os.makedirs(VOICE_INBOX, exist_ok=True)
    os.makedirs(VOICE_ARCHIVE, exist_ok=True)

    # Load state
    state = {"processed": {}}
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            state = json.load(f)

    results = []
    for fname in sorted(os.listdir(VOICE_INBOX)):
        fpath = os.path.join(VOICE_INBOX, fname)
        if not os.path.isfile(fpath):
            continue
        if fpath.endswith(".json"):  # skip metadata files
            continue

        file_stat = os.stat(fpath)
        file_key = f"{fname}:{file_stat.st_size}:{file_stat.st_mtime}"

        if file_key in state["processed"]:
            continue

        print(f"Processing: {fname} ({file_stat.st_size} bytes)")

        try:
            result = transcribe(fpath)
            task_id = create_task_from_voice(
                transcript=result["text"],
                source_file=fname,
            )
            state["processed"][file_key] = {
                "task_id": task_id,
                "transcribed_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "language": result["language"],
                "duration": result["duration"],
            }

            # Archive
            os.rename(fpath, os.path.join(VOICE_ARCHIVE, f"{task_id}_{fname}"))

            results.append(
                {
                    "file": fname,
                    "task_id": task_id,
                    "text_preview": result["text"][:100],
                    "language": result["language"],
                }
            )
            print(f"  -> Task #{task_id}: {result['text'][:80]}...")

        except Exception as e:
            print(f"  FAILED: {e}")
            state["processed"][file_key] = {"error": str(e), "failed_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
            # Move failed files too so we don't loop
            os.rename(fpath, os.path.join(VOICE_ARCHIVE, f"FAILED_{fname}"))

    # Save state
    # Prune old entries (>500)
    if len(state["processed"]) > 500:
        keys = sorted(state["processed"].keys())[-500:]
        state["processed"] = {k: state["processed"][k] for k in keys}

    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

    return results


def main():
    parser = argparse.ArgumentParser(description="Voice note ingestion for task queue")
    parser.add_argument("--file", help="Direct file path to transcribe")
    parser.add_argument("--file-id", help="Telegram file_id (not yet implemented)")
    parser.add_argument("--process-inbox", action="store_true", help="Scan voice-inbox/ for new files")
    args = parser.parse_args()

    if args.process_inbox:
        results = process_inbox()
        if results:
            print(f"\nProcessed {len(results)} voice notes:")
            for r in results:
                print(f"  Task #{r['task_id']}: {r['text_preview']}")
        else:
            print("No new voice notes found.")
    elif args.file:
        if not os.path.exists(args.file):
            print(f"File not found: {args.file}")
            sys.exit(1)
        result = transcribe(args.file)
        print(json.dumps(result, indent=2))
        task_id = create_task_from_voice(transcript=result["text"], source_file=args.file)
        print(f"Created task #{task_id}")
    elif args.file_id:
        output_path = os.path.join(VOICE_INBOX, f"tg_{args.file_id}.ogg")
        print(f"Downloading Telegram file {args.file_id}...")
        try:
            download_telegram_file(args.file_id, output_path)
            print(f"Downloaded to {output_path}")
            result = transcribe(output_path)
            print(json.dumps(result, indent=2))
            task_id = create_task_from_voice(
                transcript=result["text"],
                voice_file_id=args.file_id,
                source_file=output_path,
            )
            print(f"Created task #{task_id}")
            os.makedirs(VOICE_ARCHIVE, exist_ok=True)
            os.rename(output_path, os.path.join(VOICE_ARCHIVE, f"{task_id}_tg_{args.file_id}.ogg"))
        except Exception as e:
            print(f"Failed: {e}")
            sys.exit(1)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
