"""Measure vocal activity on the same media clock as the generated lyric cues."""

import math
import subprocess
from array import array

FRAME = 0.02
SAMPLE_RATE = 8000
SAMPLES_PER_FRAME = round(SAMPLE_RATE * FRAME)


def vocal_levels(path):
    pcm = array("f", subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SAMPLE_RATE),
        "-af", "highpass=f=120,lowpass=f=3600", "-f", "f32le", "-",
    ]))
    return [
        10 * math.log10(max(sum(x * x for x in pcm[i:i + SAMPLES_PER_FRAME]) / SAMPLES_PER_FRAME, 1e-12))
        for i in range(0, len(pcm) - SAMPLES_PER_FRAME + 1, SAMPLES_PER_FRAME)
    ]


def trim_vocal_gaps(rows, levels):
    """Shorten only words with a clear, sustained rise out of a quiet lead-in."""
    changes = []
    for index, row in enumerate(rows):
        if not row:
            continue
        for cue in row[1]:
            _, _, start, end = cue
            if end - start < 0.55:
                continue
            first = max(0, math.ceil(start / FRAME))
            stop = min(len(levels), math.floor(end / FRAME))
            samples = levels[first:stop]
            if len(samples) < 8:
                continue

            # Use several loud frames so a single click can't set the threshold.
            peak = sorted(samples)[-3]
            if peak < -46:
                continue
            activity = peak - 17
            rise = next((i for i in range(len(samples) - 2)
                         if sum(level >= activity for level in samples[i:i + 3]) >= 2), None)
            if rise is None:
                continue
            # Only trim a substantial quiet lead-in. Retain a little room for
            # quiet consonants immediately before the stronger vowel energy.
            adjusted = round((first + rise) * FRAME - 0.06, 2)
            lead_in = samples[:max(0, rise - 3)]
            if adjusted - start < 0.24 or not lead_in:
                continue
            if sum(level <= peak - 22 for level in lead_in) / len(lead_in) < 0.85:
                continue
            cue[2] = adjusted
            changes.append({"line": index + 1, "offset": cue[0], "from": start, "to": adjusted})
    return changes
