"""Synthesizes bank words with Microsoft Edge neural voices (edge-tts).

    python3 scripts/tts_edge.py <items.json> <out dir> <voice,voice,...>

items.json: [{"id": ..., "hanzi": ...}]; writes <out>/<voice>/<id>.mp3, skipping files that exist.
Uses $HTTPS_PROXY when set.
"""
import asyncio, json, os, sys
import edge_tts

items_f, out, voices = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
RATE = os.environ.get('RATE', '-10%')
items = json.load(open(items_f, encoding='utf8'))
sem = asyncio.Semaphore(6)
failed = 0


async def one(voice, it):
    global failed
    f = os.path.join(out, voice, f"{it['id']}.mp3")
    if os.path.exists(f) and os.path.getsize(f) > 0:
        return
    async with sem:
        for attempt in range(5):
            try:
                await edge_tts.Communicate(it['hanzi'], voice, rate=RATE, proxy=os.environ.get('HTTPS_PROXY')).save(f)
                if os.path.getsize(f) > 0:
                    return
            except Exception as e:  # network hiccups: retry with backoff
                err = e
            await asyncio.sleep(2 ** attempt)
        failed += 1
        if os.path.exists(f):
            os.remove(f)
        print('failed', voice, it['hanzi'], file=sys.stderr)


async def main():
    for v in voices:
        os.makedirs(os.path.join(out, v), exist_ok=True)
    await asyncio.gather(*(one(v, it) for v in voices for it in items))


asyncio.run(main())
print(f'{len(items) * len(voices) - failed} clips, {failed} failed', file=sys.stderr)
