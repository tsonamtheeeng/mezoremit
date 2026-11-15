# Demo video

`mezoremit-demo.mp4` (not committed, ~2:40, 1080p): a real run on Mezo Testnet against https://mezoremit.vercel.app.
The sender connects with Mezo Passport, sends 25 MUSD to the Philippines as a 7-day claim link, the recipient claims it
for free through the gas relayer, and the sender's tracking page shows it verified on Mezo.
Voice: Microsoft Andrew (`en-US-AndrewNeural`, edge-tts). Subtitles are burned in; `mezoremit-demo.srt` is alongside.

Re-render (needs ~25 MUSD + a little BTC in the sender wallet; the recipient wallet can be empty):

```bash
python3 -m pip install --user edge-tts imageio-ffmpeg
python3 demo/record/tts.py                       # narration from demo/SCRIPT.md (edge-tts throttles; it retries)
SENDER_PRIVATE_KEY=0x… RECIPIENT_PRIVATE_KEY=0x… npx tsx demo/record/record.ts
python3 demo/record/compose.py                   # → demo/mezoremit-demo.mp4 + .srt + .ass
```

`record.ts` drives two Playwright browsers with a Node-side injected wallet (Passport → "Browser Wallet"); keys come
only from the environment. `STOP_AFTER=<scene>` stops before any later scene (e.g. `review` = before any MUSD moves).
