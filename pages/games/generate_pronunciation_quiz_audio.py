"""Generate fixed-choice audio for spanish-pronunciation-listening-quiz.html."""

import asyncio
from pathlib import Path

import edge_tts


OUTPUT_DIR = Path(__file__).parent / "audio" / "pronunciation-quiz"
VOICE = "es-MX-DaliaNeural"

# Audio-only choices. The generator intentionally stores no answer key.
AUDIO_OPTIONS = [
    ["eoya", "ioya", "joya", "joa"],
    ["chasa", "casa", "sasa", "jasa"],
    ["quena", "jena", "cena", "chena"],
    ["guente", "sente", "chente", "gente"],
    ["guitarra", "juitarra", "guitara", "chitarra"],
    ["pingino", "pinquino", "pingüino", "pinchino"],
    ["jola", "gola", "hola", "chola"],
    ["gamón", "samón", "chamón", "jamón"],
    ["rojo", "lojo", "rodo", "rogo"],
    ["perro", "pelo", "pero", "pedo"],
    ["pero", "pelo", "perro", "pedo"],
    ["teto", "dedo", "deyo", "dero"],
    ["cata", "cara", "caja", "cada"],
    ["toca", "boca", "foca", "moca"],
    ["amico", "amijo", "amigo", "amiso"],
    ["kuerra", "jerra", "guerra", "cerra"],
    ["lana", "lina", "lona", "luna"],
    ["masa", "misa", "mesa", "musa"],
    ["veno", "vano", "vono", "vino"],
    ["labo", "lebo", "lobo", "lubo"],
    ["para", "paya", "pala", "pada"],
    ["cale", "care", "case", "calle"],
]


async def generate_one(filename: str, text: str) -> None:
    destination = OUTPUT_DIR / filename
    if destination.exists() and destination.stat().st_size > 500:
        print(f"skip {filename}")
        return

    for attempt in range(1, 4):
        try:
            communicate = edge_tts.Communicate(text, voice=VOICE, rate="-8%")
            await communicate.save(str(destination))
            if destination.stat().st_size <= 500:
                raise RuntimeError("generated file is unexpectedly small")
            print(f"made {filename}")
            return
        except Exception:
            if destination.exists():
                destination.unlink()
            if attempt == 3:
                raise
            await asyncio.sleep(attempt)


async def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for question_number, options in enumerate(AUDIO_OPTIONS, start=1):
        for option_number, text in enumerate(options):
            letter = chr(ord("a") + option_number)
            await generate_one(f"q{question_number:02d}-{letter}.mp3", text)


if __name__ == "__main__":
    asyncio.run(main())
