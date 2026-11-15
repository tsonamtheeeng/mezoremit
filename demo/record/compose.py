"""Compose the final demo video from record.ts output + tts.py narration.

  python3 demo/record/compose.py

Inputs:  demo/record/out/timeline.json, out/raw/<ctx>/*.webm, out/tts/<scene>.{mp3,json}
Outputs: demo/mezoremit-demo.mp4 (1080p, burned subtitles), demo/mezoremit-demo.srt, demo/mezoremit-demo.subtitles.ass
"""
import json, pathlib, re, subprocess
import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "record" / "out"
SEG = OUT / "seg"
W, H, FPS = 1920, 1080, 30


def run(*args):
    subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def ts_ass(t):
    h, r = divmod(t, 3600)
    m, s = divmod(r, 60)
    return f"{int(h)}:{int(m):02d}:{s:05.2f}"


def ts_srt(t):
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def punctuate(words, text):
    """edge-tts word boundaries drop punctuation; take each word's display form from the script text, in order."""
    tokens, out, j = text.split(), [], 0
    norm = lambda s: re.sub(r"[^\w']", "", s.lower().replace("\u2019", "'"))
    for s, e, w in words:
        k = j
        while k < len(tokens) and norm(tokens[k]) != norm(w):
            k += 1
        if k < len(tokens):
            out.append([s, e, tokens[k]])
            j = k + 1
        else:
            out.append([s, e, w])
    return out


def lines_from_words(words, offset, max_chars=48):
    """Group word timings into subtitle lines: break on sentence/clause ends or when a line gets long."""
    out, cur = [], []
    for i, (s, e, w) in enumerate(words):
        cur.append((s, e, w))
        text = " ".join(x[2] for x in cur)
        gap = words[i + 1][0] - e if i + 1 < len(words) else 9
        # Don't leave a sentence's last word (or two) alone on the next line.
        tail_short = i + 1 < len(words) and any(re.search(r"[.!?]$", x[2]) for x in words[i + 1 : i + 3])
        too_long = len(text) >= max_chars and not (tail_short and len(text) < max_chars + 14)
        if too_long or re.search(r"[.!?]$", w) or (re.search(r"[,;:]$", w) and len(text) > 22) or gap > 0.45:
            out.append((cur[0][0] + offset, cur[-1][1] + offset, text))
            cur = []
    if cur:
        out.append((cur[0][0] + offset, cur[-1][1] + offset, " ".join(x[2] for x in cur)))
    return out


def main():
    tl = json.loads((OUT / "timeline.json").read_text())
    SEG.mkdir(parents=True, exist_ok=True)
    # Playwright paints the 1440x810 viewport into the top-left of the 1920x1080 capture: crop it, then upscale.
    vf = f"crop=1440:810:0:0,scale={W}:{H}:flags=lanczos,fps={FPS},format=yuv420p"

    segs, subs, cursor = [], [], 0.0
    audio_parts = []
    for i, m in enumerate(tl["marks"]):
        meta = json.loads((OUT / "tts" / f"{m['scene']}.json").read_text())
        full = max(0.5, m["end"] - m["start"])
        head = meta["duration"] + 1.5
        # Waiting on Mezo confirmations: keep the narrated start and the last few seconds (the result), cut the wait.
        parts = [(m["start"], full)] if full <= head + 6 else [(m["start"], head), (m["end"] - 3.5, 3.5)]
        dur = sum(d for _, d in parts)
        for j, (st, d) in enumerate(parts):
            seg = SEG / f"{i:02d}{'ab'[j]}-{m['scene']}.mp4"
            run("-ss", f"{st:.3f}", "-t", f"{d:.3f}", "-i", tl["videos"][m["ctx"]], "-vf", vf, "-an",
                "-c:v", "libx264", "-preset", "medium", "-crf", "18", str(seg))
            segs.append(seg)
        # Narration for this scene, padded/trimmed to the segment length.
        clip = OUT / "tts" / f"{m['scene']}.mp3"
        a = SEG / f"{i:02d}-{m['scene']}.wav"
        run("-i", str(clip), "-af", f"adelay=250|250,apad,atrim=0:{dur:.3f}", "-ar", "48000", "-ac", "2", str(a))
        audio_parts.append(a)
        subs += lines_from_words(punctuate(meta["words"], meta["text"]), cursor + 0.25)
        cursor += dur

    (SEG / "v.txt").write_text("".join(f"file '{p.name}'\n" for p in segs))
    (SEG / "a.txt").write_text("".join(f"file '{p.name}'\n" for p in audio_parts))
    run("-f", "concat", "-safe", "0", "-i", str(SEG / "v.txt"), "-c", "copy", str(SEG / "video.mp4"))
    run("-f", "concat", "-safe", "0", "-i", str(SEG / "a.txt"), "-c:a", "pcm_s16le", str(SEG / "audio.wav"))

    subs = [(s, min(e + 0.15, subs[i + 1][0] - 0.02) if i + 1 < len(subs) else e + 0.15, t) for i, (s, e, t) in enumerate(subs)]
    # Subtitles: .srt for players, .ass (styled) burned into the video.
    srt = "".join(f"{n}\n{ts_srt(s)} --> {ts_srt(e)}\n{t}\n\n" for n, (s, e, t) in enumerate(subs, 1))
    (ROOT / "mezoremit-demo.srt").write_text(srt)
    ass = (
        "[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        "Style: Default,Helvetica,46,&H00FFFFFF,&H00FFFFFF,&H00000000,&H9A111111,0,0,0,0,100,100,0,0,3,14,0,2,160,160,56,1\n\n"
        "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
        + "".join(f"Dialogue: 0,{ts_ass(s)},{ts_ass(e)},Default,,0,0,0,,{t}\n" for s, e, t in subs)
    )
    ass_path = ROOT / "mezoremit-demo.subtitles.ass"
    ass_path.write_text(ass)

    final = ROOT / "mezoremit-demo.mp4"
    run("-i", str(SEG / "video.mp4"), "-i", str(SEG / "audio.wav"),
        "-vf", f"ass={ass_path.as_posix()}", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", str(final))
    print(f"wrote {final} ({cursor:.1f}s, {len(subs)} subtitle lines)")


main()
