#!/usr/bin/env python3
"""Synced lyrics: find when each lyric line is sung.

  python3 scripts/sync_lyrics.py            # transcribe what's missing, then align
  python3 scripts/sync_lyrics.py align      # only re-run the matching (fast)
  python3 scripts/sync_lyrics.py --force    # redo everything

How it works, per track that has lyrics and audio:
  1. Demucs pulls the vocals out of the mix          (needs `uvx`, downloads once)
  2. Whisper transcribes them with word timestamps   (needs `whisper`, turbo model)
  3. the transcript is matched, in order, against the real lyrics; each line gets
     the time of its first and last heard word. Lines nobody could hear get a
     time estimated from their neighbours (marked with confidence 0).

Writes src/data/lyric-sync.json:  { "<record>/<track>": [[start, end, conf], ...] }
one entry per sung line (in the order they appear, [directions] skipped).
Working files live in .cache/lyric-sync/ and can be deleted any time.
"""

import difflib
import json
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "lyric-sync"
OUT = ROOT / "src" / "data" / "lyric-sync.json"
FORCE = "--force" in sys.argv
ALIGN_ONLY = "align" in sys.argv


def frontmatter(text):
    m = re.match(r"^---\n(.*?)\n---\n?(.*)$", text, re.S)
    if not m:
        return {}, text
    fm = {}
    for line in m.group(1).splitlines():
        mm = re.match(r"^(\w+): (.*)$", line)
        if mm:
            v = mm.group(2)
            try:
                v = json.loads(v)
            except ValueError:
                pass
            fm[mm.group(1)] = v
    return fm, m.group(2)


def sung_lines(body):
    """Same order as parseLyrics() on the site, directions removed."""
    out = []
    for raw in body.splitlines():
        line = raw.strip()
        if not line or re.match(r"^\[.*\]$", line):
            continue
        out.append(line)
    return out


def tokens(s):
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"[^a-z0-9']+", " ", s).replace("'", "")
    return s.split()


def tracks():
    """(key, audio file, lyric lines) for every playable track with words."""
    seen = {}
    for md in sorted((ROOT / "src/content/tracks").glob("*/*.md")):
        fm, body = frontmatter(md.read_text())
        audio = fm.get("audio")
        if not audio or fm.get("instrumental") is True:
            continue
        lines = sung_lines(body)
        if not lines:
            continue
        key = f"{md.parent.name}/{re.sub(r'^\d+-', '', md.stem)}"
        yield key, ROOT / "public" / audio.lstrip("/"), lines, audio in seen
        seen[audio] = key


def stem(key):
    return key.replace("/", "__")


def transcribe(items):
    vocals_dir = CACHE / "vocals"
    tx_dir = CACHE / "tx"
    vocals_dir.mkdir(parents=True, exist_ok=True)
    tx_dir.mkdir(parents=True, exist_ok=True)

    todo = [(k, a) for k, a in items if FORCE or not (tx_dir / f"{stem(k)}.json").exists()]
    if not todo:
        print("all transcribed.")
        return

    need_sep = [(k, a) for k, a in todo if FORCE or not (vocals_dir / f"{stem(k)}.wav").exists()]
    if need_sep:
        print(f"separating vocals for {len(need_sep)} tracks…", flush=True)
        sep = CACHE / "sep"
        subprocess.run(
            ["uvx", "--python", "3.11", "--with", "soundfile", "--from", "demucs", "demucs",
             "--two-stems", "vocals", "-n", "htdemucs", "-o", str(sep)] + [str(a) for _, a in need_sep],
            check=True,
        )
        for k, a in need_sep:
            shutil.copy(sep / "htdemucs" / a.stem / "vocals.wav", vocals_dir / f"{stem(k)}.wav")

    print(f"transcribing {len(todo)} tracks (slow on CPU, ~1x real time)…", flush=True)
    # one call so the model loads once; outputs are named after the input files
    subprocess.run(
        ["whisper", *[str(vocals_dir / f"{stem(k)}.wav") for k, _ in todo],
         "--model", "turbo", "--word_timestamps", "True", "--output_format", "json",
         "--output_dir", str(tx_dir), "--condition_on_previous_text", "False",
         "--fp16", "False", "--verbose", "False"],
        check=True,
    )


def align(lines, tx):
    lyr = []  # (token, line index)
    for i, line in enumerate(lines):
        lyr += [(t, i) for t in tokens(line)]
    heard = []  # (token, start, end)
    for seg in tx.get("segments", []):
        for w in seg.get("words", []):
            for t in tokens(w["word"]):
                heard.append((t, w["start"], w["end"]))

    sm = difflib.SequenceMatcher(None, [t for t, _ in lyr], [t for t, _, _ in heard], autojunk=False)
    times = {}  # line -> [starts], [ends], matched count
    for a, b, n in sm.get_matching_blocks():
        for k in range(n):
            li = lyr[a + k][1]
            _, s, e = heard[b + k]
            d = times.setdefault(li, [[], [], 0])
            d[0].append(s)
            d[1].append(e)
            d[2] += 1

    totals = [max(1, len(tokens(l))) for l in lines]
    res = [None] * len(lines)
    last = -1.0
    for i in range(len(lines)):
        d = times.get(i)
        if not d:
            continue
        conf = d[2] / totals[i]
        start, end = min(d[0]), max(d[1])
        if conf < 0.34 or start < last:  # weak or out of order: don't trust
            continue
        res[i] = [round(start, 2), round(end, 2), round(min(conf, 1), 2)]
        last = start

    # fill the gaps by spreading lines evenly between known neighbours
    known = [i for i, r in enumerate(res) if r]
    if not known:
        return None
    for i in range(len(res)):
        if res[i]:
            continue
        prev = max((k for k in known if k < i), default=None)
        nxt = min((k for k in known if k > i), default=None)
        if prev is None:
            t0, t1, span = max(0, res[nxt][0] - 3 * (nxt - i + 1)), res[nxt][0], nxt + 1
            pos = i + 1
        elif nxt is None:
            t0 = res[prev][1]
            res[i] = [round(t0 + 3 * (i - prev - 1), 2), round(t0 + 3 * (i - prev), 2), 0]
            continue
        else:
            t0, t1, span = res[prev][1], res[nxt][0], nxt - prev
            pos = i - prev
        s = t0 + (t1 - t0) * (pos - 1) / span
        e = t0 + (t1 - t0) * pos / span
        res[i] = [round(s, 2), round(e, 2), 0]
    return res


def main():
    items = list(tracks())
    if not ALIGN_ONLY:
        transcribe([(k, a) for k, a, _, dup in items if not dup])

    out = {}
    by_audio = {}
    for key, audio, lines, dup in items:
        src = by_audio.get(str(audio), key)
        by_audio.setdefault(str(audio), key)
        f = CACHE / "tx" / f"{stem(src)}.json"
        if not f.exists():
            continue
        res = align(lines, json.loads(f.read_text()))
        if res:
            out[key] = res
            sure = sum(1 for r in res if r[2] > 0)
            print(f"  {key}: {sure}/{len(res)} lines heard")
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUT.relative_to(ROOT)} ({len(out)} tracks)")


if __name__ == "__main__":
    main()
