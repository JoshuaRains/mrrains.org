"""Generate practice MP3s with the site's usual Edge TTS voice.

Requires Python edge-tts and Node.js. Run: python generate_audio.py
Reads the vocabulary from practice.js so recordings match the pages.
"""

import asyncio
import json
from pathlib import Path
import subprocess
import unicodedata

import edge_tts

BASE = Path(__file__).resolve().parent
VOICE = "es-MX-DaliaNeural"
RATE = "-8%"


def vocabulary():
    result = subprocess.run(
        ["node", "-e", "const fs=require('fs'),vm=require('vm');"
         "const source=fs.readFileSync('practice.js','utf8').split('const kind =')[0];"
         "process.stdout.write(vm.runInNewContext(source+';JSON.stringify(sets)'));"],
        cwd=BASE, check=True, capture_output=True, encoding="utf-8",
    )
    return json.loads(result.stdout)


async def generate(kind, item):
    text = item[1]
    slug = item[2] if len(item) > 2 else ''.join(
        c for c in unicodedata.normalize('NFD', text)
        if not unicodedata.combining(c)
    )
    destination = BASE / 'audio' / kind / f'{slug}.mp3'
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and destination.stat().st_size > 500:
        return
    temporary = destination.with_suffix('.part')
    for attempt in range(1, 4):
        try:
            await edge_tts.Communicate(text, voice=VOICE, rate=RATE).save(str(temporary))
            if temporary.stat().st_size <= 500:
                raise RuntimeError(f'Audio too small: {destination.name}')
            temporary.replace(destination)
            print(f'made {kind}/{destination.name}', flush=True)
            return
        except Exception:
            temporary.unlink(missing_ok=True)
            if attempt == 3:
                raise
            await asyncio.sleep(attempt)


async def main():
    semaphore = asyncio.Semaphore(3)

    async def limited(kind, item):
        async with semaphore:
            await generate(kind, item)

    await asyncio.gather(*(limited(kind, item)
                           for kind, items in vocabulary().items() for item in items))
    print('All 140 practice recordings are ready.', flush=True)


if __name__ == '__main__':
    asyncio.run(main())
