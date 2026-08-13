"""Generate the numbered Spanish audio clips for this listening quiz."""

import asyncio
from pathlib import Path

import edge_tts

VOICE = "es-MX-DaliaNeural"
WORDS = ("oso", "iglesia", "amigo", "uva", "escuela", "uno", "agua", "ojo", "isla", "elefante")
OUTPUT_DIR = Path(__file__).parent / "audio"

async def main() -> None:
    OUTPUT_DIR.mkdir(exist_ok=True)
    for number, word in enumerate(WORDS, start=1):
        destination = OUTPUT_DIR / f"{number}.mp3"
        await edge_tts.Communicate(word, voice=VOICE, rate="-8%").save(str(destination))
        print(f"made {destination.name}")

if __name__ == "__main__":
    asyncio.run(main())
