"""Generate the numbered Spanish letter-name clips in slide order."""

import asyncio
from pathlib import Path

import edge_tts

VOICE = "es-MX-DaliaNeural"
LETTER_NAMES = (
    "a", "be", "ce", "de", "e", "efe", "ge", "hache", "i", "jota",
    "ka", "ele", "eme", "ene", "eñe", "o", "pe", "cu", "erre", "ese",
    "te", "u", "uve", "doble uve", "equis", "y griega", "zeta",
)
OUTPUT_DIR = Path(__file__).parent / "audio"

async def main() -> None:
    OUTPUT_DIR.mkdir(exist_ok=True)
    for number, name in enumerate(LETTER_NAMES, start=1):
        destination = OUTPUT_DIR / f"{number}.mp3"
        await edge_tts.Communicate(name, voice=VOICE, rate="-8%").save(str(destination))
        print(f"made {destination.name}")

if __name__ == "__main__":
    asyncio.run(main())
