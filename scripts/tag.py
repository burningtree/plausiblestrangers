"""Our metadata in every download: files/ (MP3s, FLACs, stems) and the m4a the
site streams (public/audio).

  npm run tag        (uv run --with mutagen scripts/tag.py)

Everything comes from the songs' own pages (src/content), so the tags say what
the site says: title, artist, record and track number, release date, genre,
tempo, key, the machine that made it, the song's page, the licence and the
lyrics as sung. Run it after `npm run downloads` / `npm run import:stems`, then
`npm run files` and `npm run files:upload`. Running it again just rewrites them.
"""
import json
import re
import sys
from pathlib import Path

from mutagen.flac import FLAC
from mutagen.mp4 import MP4, MP4FreeForm
from mutagen.id3 import (
    COMM, ID3, ID3NoHeaderError, TALB, TBPM, TCON, TCOP, TDRC, TIT2, TKEY, TPE1, TPE2, TPUB, TRCK, TSRC, TXXX, USLT, WCOP, WOAF, WOAR,
)

ROOT = Path(__file__).resolve().parent.parent
FILES = ROOT / "files"
SITE = "https://plausiblestrangers.com"
ARTIST = "Plausible Strangers"
LICENCE = "CC0 1.0 Universal — no rights reserved"
LICENCE_URL = "https://creativecommons.org/publicdomain/zero/1.0/"

MINOR = ["A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D"]
MAJOR = ["C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F"]


def front(path: Path):
    text = path.read_text()
    m = re.match(r"^---\n(.*?)\n---\n?(.*)$", text, re.S)
    head, body = (m.group(1), m.group(2)) if m else ("", text)
    fields = {}
    for line in head.splitlines():
        k = re.match(r'^([a-zA-Z]+):\s*"?(.*?)"?\s*$', line)
        if k and not k.group(2).startswith("|"):
            fields[k.group(1)] = k.group(2)
    return fields, body


def key_name(k):  # Open Key ("9m") → "C minor" / ID3's "Cm"
    m = re.match(r"^(\d{1,2})([md])$", k or "")
    if not m:
        return None, None
    i = int(m.group(1)) - 1
    note = (MINOR if m.group(2) == "m" else MAJOR)[i]
    return f"{note} {'minor' if m.group(2) == 'm' else 'major'}", note + ("m" if m.group(2) == "m" else "")


performances = json.loads((ROOT / "src/data/lyric-performances.json").read_text())


def lyrics(body, audio):
    """The lyrics as sung: no [directions], with the sung repeats (lyric-performances.json)."""
    stanzas, lines = [], []
    for raw in body.splitlines():
        line = raw.strip()
        if not line:
            if lines:
                stanzas.append(lines)
                lines = []
            continue
        if re.fullmatch(r"\[.*\]", line):
            continue
        lines.append(re.sub(r"\s*\[[^\]]*\]\s*", " ", line).strip())
    if lines:
        stanzas.append(lines)
    flat = [l for s in stanzas for l in s]
    swap = {p["line"]: p for p in performances.get(audio, [])}
    out, n = [], 0
    for s in stanzas:
        block = []
        for l in s:
            p = swap.get(n)
            block.extend(p["lines"] if p and p.get("prompt") == l else [l])
            n += 1
        out.append("\n".join(block))
    return "\n\n".join(out).strip() if flat else None


# ---- the songs, keyed by their audio path
releases = {p.stem: front(p)[0] for p in (ROOT / "src/content/releases").glob("*.md")}
tracks_on = {}
for p in (ROOT / "src/content/tracks").rglob("*.md"):
    f, _ = front(p)
    tracks_on.setdefault(f.get("release"), []).append(p)

songs = {}
for kind in ("tracks", "archive"):
    for p in sorted((ROOT / "src/content" / kind).rglob("*.md")):
        f, body = front(p)
        audio = f.get("audio")
        if not audio or audio in songs:  # a song on two records: its first one
            continue
        rel = releases.get(f.get("release")) if kind == "tracks" else None
        if kind == "tracks":
            slug = re.sub(r"^\d+-", "", p.stem)
            url = f"{SITE}/records/{f['release']}/{slug}/"
        else:
            url = f"{SITE}/library/{p.stem}/"
        key_long, key_short = key_name(f.get("key"))
        genres = [g.strip() for g in (f.get("tags") or "").split(",") if g.strip()][:3]
        songs[audio] = {
            "title": f["title"],
            "album": rel and rel.get("title"),
            "catalog": rel and rel.get("catalog"),
            "track": f.get("number") and rel and f"{f['number']}/{len(tracks_on.get(f['release'], []))}",
            # the day it came out in the stores, else on the site, else when it was made
            "date": (rel and (rel.get("storeDate") or rel.get("date"))) or f.get("created"),
            "label": (rel and rel.get("label")) or ARTIST,
            "upc": rel and rel.get("upc"),
            "isrc": f.get("isrc"),
            "genre": "; ".join(g[:1].upper() + g[1:] for g in genres) or None,
            "bpm": f.get("bpm"),
            "key": key_long,
            "key_id3": key_short,
            "machine": f.get("machine"),
            "url": url,
            "remix": f.get("remix") == "true",
            "lyrics": None if f.get("instrumental") == "true" else lyrics(body, audio),
        }


def comment(s):
    return f"{s['url']}\nmade with {s['machine']}" if s.get("machine") else s["url"]


def tag_mp3(path: Path, s: dict, part=None):
    try:
        t = ID3(path)
    except ID3NoHeaderError:
        t = ID3()
    for frame in ("TIT2", "TPE1", "TPE2", "TALB", "TRCK", "TDRC", "TYER", "TCON", "TBPM", "TKEY", "COMM", "USLT", "TCOP", "TPUB", "WOAF", "WOAR", "WCOP", "TSRC", "TXXX"):
        t.delall(frame)
    title = f"{s['title']} ({part.title()})" if part else s["title"]
    t.add(TIT2(encoding=3, text=title))
    t.add(TPE1(encoding=3, text=ARTIST))
    t.add(TPE2(encoding=3, text=ARTIST))
    if s["album"]:
        t.add(TALB(encoding=3, text=s["album"]))
    if s["track"] and not part:
        t.add(TRCK(encoding=3, text=s["track"]))
    if s["date"]:
        t.add(TDRC(encoding=3, text=s["date"]))
    if s["genre"]:
        t.add(TCON(encoding=3, text=s["genre"]))
    if s["bpm"]:
        t.add(TBPM(encoding=3, text=str(round(float(s["bpm"])))))
    if s["key_id3"]:
        t.add(TKEY(encoding=3, text=s["key_id3"]))
    t.add(COMM(encoding=3, lang="eng", desc="", text=comment(s)))
    t.add(TCOP(encoding=3, text=f"{LICENCE} ({LICENCE_URL})"))
    t.add(TPUB(encoding=3, text=s["label"]))
    if s["isrc"] and not part:  # the code is the song's, not a stem's
        t.add(TSRC(encoding=3, text=s["isrc"]))
    if s["upc"]:
        t.add(TXXX(encoding=3, desc="BARCODE", text=s["upc"]))
    t.add(WOAF(url=s["url"]))
    t.add(WOAR(url=SITE + "/"))
    t.add(WCOP(url=LICENCE_URL))
    if s["catalog"]:
        t.add(TXXX(encoding=3, desc="CATALOGNUMBER", text=s["catalog"]))
    if s["machine"]:
        t.add(TXXX(encoding=3, desc="MODEL", text=s["machine"]))
    if part:
        t.add(TXXX(encoding=3, desc="STEM", text=part))
    if s["lyrics"] and part in (None, "vocals", "backing vocals"):
        t.add(USLT(encoding=3, lang="eng", desc="", text=s["lyrics"]))
    t.save(path, v2_version=4)


def tag_flac(path: Path, s: dict):
    f = FLAC(path)
    f.clear()  # the cover is a picture block, not a tag: it stays
    tags = {
        "TITLE": s["title"],
        "ARTIST": ARTIST,
        "ALBUMARTIST": ARTIST,
        "ALBUM": s["album"],
        "TRACKNUMBER": s["track"] and s["track"].split("/")[0],
        "TRACKTOTAL": s["track"] and s["track"].split("/")[1],
        "DATE": s["date"],
        "GENRE": s["genre"],
        "BPM": s["bpm"] and str(round(float(s["bpm"]))),
        "INITIALKEY": s["key_id3"],
        "KEY": s["key"],
        "COMMENT": comment(s),
        "WEBSITE": s["url"],
        "COPYRIGHT": LICENCE,
        "LICENSE": LICENCE_URL,
        "ORGANIZATION": s["label"],
        "LABEL": s["label"] if s["label"] != ARTIST else None,
        "ISRC": s["isrc"],
        "BARCODE": s["upc"],
        "CATALOGNUMBER": s["catalog"],
        "MODEL": s["machine"],
        "LYRICS": s["lyrics"],
    }
    for k, v in tags.items():
        if v:
            f[k] = v
    f.save()


def tag_m4a(path: Path, s: dict):
    f = MP4(path)
    f.delete()
    f = MP4(path)
    t = f.tags if f.tags is not None else (f.add_tags() or f.tags)
    t["\xa9nam"] = s["title"]
    t["\xa9ART"] = ARTIST
    t["aART"] = ARTIST
    if s["album"]:
        t["\xa9alb"] = s["album"]
    if s["track"]:
        n, total = s["track"].split("/")
        t["trkn"] = [(int(n), int(total))]
    if s["date"]:
        t["\xa9day"] = s["date"]
    if s["genre"]:
        t["\xa9gen"] = s["genre"]
    if s["bpm"]:
        t["tmpo"] = [round(float(s["bpm"]))]
    t["\xa9cmt"] = comment(s)
    t["cprt"] = f"{LICENCE} ({LICENCE_URL})"
    if s["lyrics"]:
        t["\xa9lyr"] = s["lyrics"]
    free = {"WEBSITE": s["url"], "LICENSE": LICENCE_URL, "CATALOGNUMBER": s["catalog"], "MODEL": s["machine"], "initialkey": s["key_id3"],
            "ISRC": s["isrc"], "BARCODE": s["upc"], "LABEL": s["label"] if s["label"] != ARTIST else None}
    for k, v in free.items():
        if v:
            t[f"----:com.apple.iTunes:{k}"] = [MP4FreeForm(v.encode())]
    f.save()


done = 0
missing = []
for audio, s in songs.items():
    p = ROOT / "public" / audio.lstrip("/")
    if p.suffix == ".m4a" and p.exists():
        tag_m4a(p, s)
        done += 1
for audio, s in songs.items():
    base = FILES / audio.lstrip("/")
    for ext, fn in ((".mp3", tag_mp3), (".flac", tag_flac)):
        p = base.with_suffix(ext)
        if p.exists():
            fn(p, s)
            done += 1
        elif ext == ".mp3":
            missing.append(audio)

stems = json.loads((ROOT / "src/data/stems.json").read_text())
for audio, data in stems.items():
    s = songs.get(audio)
    if not s:
        continue
    for part in data["parts"]:
        p = FILES / part["src"].lstrip("/")
        if p.exists():
            tag_mp3(p, s, part=part["name"])
            done += 1

print(f"tagged {done} files" + (f"; no mp3 for {len(missing)}: {', '.join(missing)}" if missing else ""))
