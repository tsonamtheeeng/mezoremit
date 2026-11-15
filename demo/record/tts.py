"""Generate per-scene narration (Andrew, en-US-AndrewNeural) + word timings from demo/SCRIPT.md.

Output: demo/record/out/tts/<scene>.mp3 and <scene>.json ({"duration": s, "words": [[start, end, text], ...]}).
"""
import asyncio, json, pathlib, re, sys, time
import edge_tts

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "record" / "out" / "tts"
VOICE = "en-US-AndrewNeural"


def scenes():
    text = (ROOT / "SCRIPT.md").read_text()
    parts = re.split(r"^## (\w+)\s*$", text, flags=re.M)
    return [(parts[i], " ".join(parts[i + 1].split())) for i in range(1, len(parts), 2)]


async def one(name, text):
    mp3, meta = OUT / f"{name}.mp3", OUT / f"{name}.json"
    if mp3.exists() and meta.exists() and json.loads(meta.read_text()).get("text") == text:
        return
    for attempt in range(10):
        try:
            com = edge_tts.Communicate(text, VOICE, boundary="WordBoundary")
            audio, words = bytearray(), []
            async for chunk in com.stream():
                if chunk["type"] == "audio":
                    audio += chunk["data"]
                elif chunk["type"] == "WordBoundary":
                    s = chunk["offset"] / 1e7
                    words.append([s, s + chunk["duration"] / 1e7, chunk["text"]])
            if not audio:
                raise RuntimeError("no audio")
            mp3.write_bytes(audio)
            dur = words[-1][1] if words else 0
            meta.write_text(json.dumps({"text": text, "duration": dur, "words": words}))
            print(f"{name}: {dur:.1f}s")
            return
        except Exception as e:  # edge-tts throttles; back off and retry
            wait = 20 * (attempt + 1)
            print(f"{name}: retry in {wait}s ({e})", file=sys.stderr)
            time.sleep(wait)
    raise SystemExit(f"tts failed for {name}")


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, text in scenes():
        await one(name, text)


asyncio.run(main())
