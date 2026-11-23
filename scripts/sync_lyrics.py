#!/usr/bin/env python3
"""Synced lyrics: find when matched lyric words are sung.

  python3 scripts/sync_lyrics.py            # transcribe what's missing, then align
  python3 scripts/sync_lyrics.py align      # re-run matching and acoustic checks
  python3 scripts/sync_lyrics.py align --track the-door/the-door  # this recording only
  python3 scripts/sync_lyrics.py align --release i-am-your-bug    # one release
  python3 scripts/sync_lyrics.py --force    # redo everything

How it works, per track that has lyrics and audio:
  1. Demucs pulls the vocals out of the mix          (needs `uvx`, downloads once)
  2. Whisper transcribes them with word timestamps   (needs `whisper`, turbo model)
  3. match transcript words to the written lyrics in order. Store only words
     with usable audio timestamps. Directions and unmatched words stay untimed.

Writes src/data/lyric-sync.json: { "<record>/<track>": [[line, [[from, to, start, end], ...]], ...] }
There is one entry per sung line (null when untimed). Text offsets are UTF-16.
Vocal stems are used to trim clearly silent lead-ins from existing cues.
Reviewed cues in src/data/lyric-reviewed.json and lyric-onsets.json are shared
by all catalog entries that point to the same audio file. Reviewed lyric
edits in lyric-performances.json preserve the original prompt text. The run writes a
coverage and timing report to .cache/lyric-sync/audit.json.
Working files live in .cache/lyric-sync/ and can be deleted any time.
"""

import argparse
import difflib
import json
import re
import shutil
import subprocess
import unicodedata
from pathlib import Path

from lyric_acoustics import trim_vocal_gaps, vocal_levels

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "lyric-sync"
OUT = ROOT / "src" / "data" / "lyric-sync.json"
ONSETS = ROOT / "src" / "data" / "lyric-onsets.json"
REVIEWED = ROOT / "src" / "data" / "lyric-reviewed.json"
AUDIT = CACHE / "audit.json"
PERFORMANCES = ROOT / "src" / "data" / "lyric-performances.json"


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


WORD = re.compile(r"[^\W_]+(?:['’][^\W_]+)*", re.UNICODE)


def tokens(text):
    for match in WORD.finditer(text):
        folded = unicodedata.normalize("NFD", match[0].casefold().replace("œ", "oe"))
        token = "".join(c for c in folded if not unicodedata.combining(c) and c not in "'’")
        if token:
            yield token, match.start(), match.end()


def utf16_offset(text, offset):
    return len(text[:offset].encode("utf-16-le")) // 2


def performed_lines(prompt, edits):
    replacements = {}
    for edit in edits:
        index = edit["line"]
        if not 0 <= index < len(prompt) or prompt[index] != edit["prompt"] or index in replacements:
            raise ValueError(f"Performance edit no longer matches prompt line {index + 1}: {edit['prompt']}")
        replacements[index] = edit["lines"]
    return [text for i, line in enumerate(prompt) for text in replacements.get(i, [line])]


def tracks():
    """(key, audio file, lyric lines, duplicate) for playable lyrics."""
    performances = json.loads(PERFORMANCES.read_text())
    sources = sorted((ROOT / "src/content/tracks").glob("*/*.md"))
    sources += sorted((ROOT / "src/content/archive").glob("*.md"))
    seen = set()
    for md in sources:
        fm, body = frontmatter(md.read_text())
        audio = fm.get("audio")
        if not audio or fm.get("instrumental") is True or fm.get("lyricsHidden") is True:
            continue
        lines = performed_lines(sung_lines(body), performances.get(audio, []))
        if not lines:
            continue
        slug = md.stem if md.parent.name == "archive" else re.sub(r"^\d+-", "", md.stem)
        key = f"{md.parent.name}/{slug}"
        yield key, ROOT / "public" / audio.lstrip("/"), lines, audio in seen
        seen.add(audio)


def stem(key):
    return key.replace("/", "__")


def transcribe(items, force=False):
    vocals_dir = CACHE / "vocals"
    tx_dir = CACHE / "tx"
    vocals_dir.mkdir(parents=True, exist_ok=True)
    tx_dir.mkdir(parents=True, exist_ok=True)

    todo = [(k, a) for k, a in items if force or not (tx_dir / f"{stem(k)}.json").exists()]
    if not todo:
        print("all transcribed.")
        return

    need_sep = [(k, a) for k, a in todo if force or not (vocals_dir / f"{stem(k)}.wav").exists()]
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
    written = [list(tokens(line)) for line in lines]
    lyric = [(token, i, start, end) for i, words in enumerate(written) for token, start, end in words]
    heard = []
    word_id = 0
    for segment in tx.get("segments", []):
        for word in segment.get("words", []):
            if word["end"] <= word["start"]:
                continue
            for token, _, _ in tokens(word["word"]):
                heard.append((token, word["start"], word["end"], word_id, word.get("probability", 1)))
            word_id += 1

    sm = difflib.SequenceMatcher(None, [item[0] for item in lyric], [item[0] for item in heard], autojunk=False)
    matches = [[] for _ in lines]
    for a, b, n in sm.get_matching_blocks():
        for k in range(n):
            if heard[b + k][4] >= 0.3:
                matches[lyric[a + k][1]].append((a + k, b + k))

    result = [None] * len(lines)
    last_end = 0.0
    for i, pairs in enumerate(matches):
        if not pairs or len(pairs) / len(written[i]) < 0.6:
            continue
        # Reject matches that cross a musical break or splice different repeats.
        if any(
            heard[right][1] - heard[left][2] > max(2.5, (next_token - token) * 1.25)
            for (token, left), (next_token, right) in zip(pairs, pairs[1:])
        ):
            continue

        cues = []
        previous_word = None
        line = lines[i]
        line_end = last_end
        for lyric_index, heard_index in pairs:
            _, _, left, right = lyric[lyric_index]
            _, start, end, identity, _ = heard[heard_index]
            left, right = utf16_offset(line, left), utf16_offset(line, right)
            if identity == previous_word:
                cues[-1][1] = right
                continue
            start, end = round(max(line_end, start), 2), round(end, 2)
            if end - start < 0.03:
                continue
            cues.append([left, right, start, end])
            line_end = end
            previous_word = identity
        if cues:
            result[i] = [line, cues]
            last_end = line_end

    return result if any(result) else None


def trim_checked_onsets(rows, corrections):
    for correction in corrections:
        index = correction["line"]
        if not 0 <= index < len(rows):
            continue
        row = rows[index]
        if not row or row[0] != correction["text"]:
            continue
        for cue in row[1]:
            if cue[0] == correction["offset"] and cue[2] < correction["start"] < cue[3]:
                cue[2] = correction["start"]
                break


def apply_reviewed(rows, lines, review):
    for entry in review:
        index = entry["line"]
        if not 0 <= index < len(lines) or lines[index] != entry["text"]:
            raise ValueError(f"Reviewed cue no longer matches line {index + 1}: {entry['text']}")
        rows[index] = [entry["text"], entry["words"]]


def validate_cues(key, rows):
    previous_end = 0
    for index, row in enumerate(rows):
        if row is None:
            continue
        text, words = row
        right = 0
        limit = utf16_offset(text, len(text))
        for left, stop, start, end in words:
            if not (0 <= right <= left < stop <= limit and 0 <= previous_end <= start < end):
                raise ValueError(f"{key}, line {index + 1}: invalid or overlapping word cue")
            right, previous_end = stop, end


def transcript_differences(lines, transcript):
    written = [token for line in lines for token, _, _ in tokens(line)]
    words = [word for segment in transcript.get("segments", []) for word in segment.get("words", [])
             if word["end"] > word["start"]]
    heard = [(token, i) for i, word in enumerate(words) for token, _, _ in tokens(word["word"])]
    matcher = difflib.SequenceMatcher(None, written, [token for token, _ in heard], autojunk=False)
    differences = []
    for change, left, right, start, end in matcher.get_opcodes():
        if change not in ("insert", "replace") or end == start:
            continue
        original = words[heard[start][1]:heard[end - 1][1] + 1]
        differences.append({
            "start": round(original[0]["start"], 2),
            "end": round(original[-1]["end"], 2),
            "transcript": "".join(word["word"] for word in original).strip(),
            "published_words": " ".join(written[left:right]),
        })
    return differences


def audit_track(rows, lines, adjustments, stem_available, transcript):
    missing = [{"line": i + 1, "text": text}
               for i, (row, text) in enumerate(zip(rows, lines)) if row is None]
    partial = []
    for i, row in enumerate(rows):
        if row is None:
            continue
        text, cues = row
        offsets = {(left, right) for left, right, _, _ in cues}
        untimed = [text[start:end] for _, start, end in tokens(text)
                   if (utf16_offset(text, start), utf16_offset(text, end)) not in offsets]
        if untimed:
            partial.append({"line": i + 1, "text": text, "untimed_words": untimed})
    long_words = [
        {"line": i + 1, "offset": a, "start": start, "end": end}
        for i, row in enumerate(rows) if row
        for a, _, start, end in row[1] if end - start >= 1.6
    ]
    return {
        "lines": len(lines),
        "words_timed": sum(len(row[1]) for row in rows if row),
        "vocal_check": stem_available,
        "missing_lines": missing,
        "partially_timed_lines": partial,
        "fully_timed_lines": len(lines) - len(missing) - len(partial),
        "long_words_to_review": long_words,
        "acoustic_adjustments": adjustments,
        "transcript_differences_to_review": transcript_differences(lines, transcript),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", nargs="?", choices=("sync", "align"), default="sync")
    parser.add_argument("--force", action="store_true")
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument("--track", help="limit changes to this catalog entry and aliases of its audio")
    scope.add_argument("--release", help="limit changes to lyric tracks in this release")
    args = parser.parse_args()
    items = list(tracks())
    source_by_audio = {audio: key for key, audio, _, duplicate in items if not duplicate}
    if args.track:
        audio = next((audio for key, audio, _, _ in items if key == args.track), None)
        if audio is None:
            parser.error(f"unknown playable lyric track: {args.track}")
        items = [item for item in items if item[1] == audio]
    elif args.release:
        items = [item for item in items if item[0].partition("/")[0] == args.release]
        if not items:
            parser.error(f"no playable lyric tracks in release: {args.release}")
    if args.mode != "align":
        audio_files = dict.fromkeys(audio for _, audio, _, _ in items)
        transcribe([(source_by_audio[audio], audio) for audio in audio_files], args.force)

    onsets = json.loads(ONSETS.read_text())
    reviewed = json.loads(REVIEWED.read_text())
    scoped = args.track or args.release
    out = json.loads(OUT.read_text()) if scoped and OUT.exists() else {}
    audit = {}
    levels_by_audio = {}
    for key, audio, lines, _ in items:
        src = source_by_audio[audio]
        tx = CACHE / "tx" / f"{stem(src)}.json"
        vocals = CACHE / "vocals" / f"{stem(src)}.wav"
        transcript = json.loads(tx.read_text()) if tx.exists() else {}
        rows = align(lines, transcript) or [None] * len(lines)

        audio_url = "/" + audio.relative_to(ROOT / "public").as_posix()
        levels = levels_by_audio.get(audio)
        if levels is None and vocals.exists():
            levels = levels_by_audio[audio] = vocal_levels(vocals)
        trim_checked_onsets(rows, onsets.get(audio_url, []))
        adjustments = trim_vocal_gaps(rows, levels) if levels else []
        review = reviewed.get(audio_url, [])
        # A review of the whole recording can explicitly leave uncertain
        # lines untimed instead of inheriting automatic matches for them.
        if isinstance(review, dict):
            rows = [None] * len(lines)
            adjustments = []
            review = review["lines"]
        apply_reviewed(rows, lines, review)
        validate_cues(key, rows)
        audit[key] = audit_track(rows, lines, adjustments, bool(levels), transcript)
        if any(rows):
            out[key] = rows
        else:
            out.pop(key, None)
        entry = audit[key]
        print(f"  {key}: {entry['words_timed']} timed words, "
              f"{len(entry['missing_lines'])} untimed lines, {len(adjustments)} acoustic trims")

    OUT.write_text(json.dumps(out, separators=(",", ":")))
    CACHE.mkdir(parents=True, exist_ok=True)
    previous_audit = json.loads(AUDIT.read_text()) if scoped and AUDIT.exists() else {}
    previous_audit.update(audit)
    AUDIT.write_text(json.dumps(previous_audit, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)} and {AUDIT.relative_to(ROOT)} ({len(audit)} entries checked)")


if __name__ == "__main__":
    main()
