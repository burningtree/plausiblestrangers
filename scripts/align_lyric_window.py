#!/usr/bin/env python3
# /// script
# dependencies = ["numpy>=1.26,<3", "onnxruntime>=1.20,<2"]
# ///
"""Propose word timings for a missing or uncertain passage.

  uv run scripts/align_lyric_window.py the-door/the-door 5 8 82 93

Line numbers follow the audit report (one-based, directions excluded); the
window is in seconds on the recording. Compare candidates against the audio
before adding their cues to lyric-reviewed.json, which uses zero-based
indices. The model runs locally and is trained on English speech.
"""

import argparse
import json
import subprocess

import numpy as np
import onnxruntime as ort

from sync_lyrics import CACHE, stem, tokens, tracks, utf16_offset

MODEL = "https://huggingface.co/Xenova/wav2vec2-base-960h/resolve/a19f851b3d42865797e410752b4c570c871e4825"


def model_file(name, path):
    destination = CACHE / "ctc-model" / name
    if not destination.exists():
        destination.parent.mkdir(parents=True, exist_ok=True)
        part = destination.with_suffix(".part")
        subprocess.run(["curl", "-fLsS", "--retry", "2", "-o", str(part), f"{MODEL}/{path}"], check=True)
        part.replace(destination)
    return destination


def ctc_spans(logits, labels):
    """Find the highest-scoring monotonic CTC path through the known letters."""
    logp = logits - logits.max(axis=1, keepdims=True)
    logp -= np.log(np.exp(logp).sum(axis=1, keepdims=True))
    states = np.zeros(2 * len(labels) + 1, dtype=np.int64)
    states[1::2] = labels
    skip = (states[2:] != 0) & (states[2:] != states[:-2])
    scores = np.full(len(states), -np.inf)
    scores[0] = 0
    trail = np.empty((len(logp), len(states)), dtype=np.int8)
    columns = np.arange(len(states))

    for frame, emission in enumerate(logp):
        incoming = np.stack((scores, np.r_[-np.inf, scores[:-1]],
                             np.r_[-np.inf, -np.inf, np.where(skip, scores[:-2], -np.inf)]))
        step = incoming.argmax(axis=0)
        scores = incoming[step, columns] + emission[states]
        trail[frame] = step

    state = len(states) - 1 - int(scores[-2] > scores[-1])
    if not np.isfinite(scores[state]):
        raise ValueError("The audio window is too short for these lyrics.")
    spans = [[] for _ in labels]
    for frame in range(len(logp) - 1, -1, -1):
        if state % 2:
            spans[state // 2].append(frame)
        state -= int(trail[frame, state])
    return [(min(frames), max(frames) + 1, float(np.exp(logp[frames, label]).max()))
            for frames, label in zip(spans, labels)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("track")
    parser.add_argument("first_line", type=int)
    parser.add_argument("last_line", type=int)
    parser.add_argument("start", type=float)
    parser.add_argument("end", type=float)
    args = parser.parse_args()

    items = list(tracks())
    item = next((item for item in items if item[0] == args.track), None)
    if not item:
        parser.error("unknown playable lyric track")
    _, audio, lines, _ = item
    if not (1 <= args.first_line <= args.last_line <= len(lines) and 0 <= args.start < args.end):
        parser.error("line range or audio window is out of bounds")
    source = next(key for key, path, _, _ in items if path == audio)
    vocals = CACHE / "vocals" / f"{stem(source)}.wav"
    if not vocals.exists():
        parser.error(f"missing vocal stem: {vocals}. Run scripts/sync_lyrics.py first.")

    vocab = json.loads(model_file("vocab.json", "vocab.json").read_text())
    labels = []
    words = []
    for i in range(args.first_line - 1, args.last_line):
        for token, left, right in tokens(lines[i]):
            if any(char not in vocab for char in token.upper()):
                parser.error(f"model vocabulary does not support {token!r}")
            if labels:
                labels.append(vocab["|"])
            first = len(labels)
            labels.extend(vocab[char] for char in token.upper())
            words.append((i, utf16_offset(lines[i], left), utf16_offset(lines[i], right), first, len(labels)))

    if not words:
        parser.error("the selected lines contain no words")
    pcm = np.frombuffer(subprocess.check_output([
        "ffmpeg", "-v", "error", "-ss", str(args.start), "-i", str(vocals),
        "-t", str(args.end - args.start), "-ac", "1", "-ar", "16000", "-f", "f32le", "-",
    ]), dtype="<f4")
    if pcm.size < 1600 or pcm.std() < 1e-6:
        parser.error("no usable audio in this window")

    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    model = model_file("wav2vec2-base-960h.onnx", "onnx/model_quantized.onnx")
    session = ort.InferenceSession(str(model), options, providers=["CPUExecutionProvider"])
    proposals = []
    for speed in (1.0, 0.85, 0.74):
        waveform = np.interp(np.arange(0, len(pcm) - 1, speed), np.arange(len(pcm)), pcm).astype("float32")
        waveform = (waveform - waveform.mean()) / (waveform.std() + 1e-7)
        logits = session.run(None, {session.get_inputs()[0].name: waveform[None]})[0][0]
        spans = ctc_spans(logits, labels)
        rows = {}
        for i, left, right, first, end in words:
            row = rows.setdefault(i, {"line": i, "text": lines[i], "words": [], "evidence": []})
            start_frame, end_frame = spans[first][0], spans[end - 1][1]
            # The checkpoint emits a frame every 20 ms at 16 kHz.
            t0 = round(args.start + 0.02 * speed * start_frame, 3)
            t1 = round(args.start + 0.02 * speed * end_frame, 3)
            row["words"].append([left, right, t0, t1])
            row["evidence"].append(round(float(np.mean([span[2] for span in spans[first:end]])), 3))
        proposals.append({"speed": speed, "rows": list(rows.values())})
    print(json.dumps({"track": args.track, "window": [args.start, args.end], "proposals": proposals}, indent=2))


if __name__ == "__main__":
    main()
