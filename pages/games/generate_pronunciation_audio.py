"""Generate the model audio used by spanish-pronunciation-practice.html."""

import asyncio
from pathlib import Path

import edge_tts


OUTPUT_DIR = Path(__file__).parent / "audio" / "pronunciation"
LATIN_AMERICAN_VOICE = "es-MX-DaliaNeural"
SPAIN_VOICE = "es-ES-ElviraNeural"

# (filename, spoken text, voice)
WORDS = [
    ("vowel-a-casa.mp3", "casa", LATIN_AMERICAN_VOICE),
    ("vowel-e-mesa.mp3", "mesa", LATIN_AMERICAN_VOICE),
    ("vowel-i-vino.mp3", "vino", LATIN_AMERICAN_VOICE),
    ("vowel-o-lobo.mp3", "lobo", LATIN_AMERICAN_VOICE),
    ("vowel-u-luna.mp3", "luna", LATIN_AMERICAN_VOICE),
    ("bv-boca.mp3", "boca", LATIN_AMERICAN_VOICE),
    ("bv-vaso.mp3", "vaso", LATIN_AMERICAN_VOICE),
    ("bv-ambos.mp3", "ambos", LATIN_AMERICAN_VOICE),
    ("bv-enviar.mp3", "enviar", LATIN_AMERICAN_VOICE),
    ("bv-uva.mp3", "uva", LATIN_AMERICAN_VOICE),
    ("bv-saber.mp3", "saber", LATIN_AMERICAN_VOICE),
    ("c-ca-casa.mp3", "casa", LATIN_AMERICAN_VOICE),
    ("c-co-copa.mp3", "copa", LATIN_AMERICAN_VOICE),
    ("c-cu-cuna.mp3", "cuna", LATIN_AMERICAN_VOICE),
    ("c-ce-cena-mx.mp3", "cena", LATIN_AMERICAN_VOICE),
    ("c-ci-cine-mx.mp3", "cine", LATIN_AMERICAN_VOICE),
    ("c-ce-cena-es.mp3", "cena", SPAIN_VOICE),
    ("c-ci-cine-es.mp3", "cine", SPAIN_VOICE),
    ("g-ga-gato.mp3", "gato", LATIN_AMERICAN_VOICE),
    ("g-go-goma.mp3", "goma", LATIN_AMERICAN_VOICE),
    ("g-gu-gusano.mp3", "gusano", LATIN_AMERICAN_VOICE),
    ("g-soft-amigo.mp3", "amigo", LATIN_AMERICAN_VOICE),
    ("g-soft-agua.mp3", "agua", LATIN_AMERICAN_VOICE),
    ("g-ge-gente.mp3", "gente", LATIN_AMERICAN_VOICE),
    ("g-gi-girasol.mp3", "girasol", LATIN_AMERICAN_VOICE),
    ("g-gue-guerra.mp3", "guerra", LATIN_AMERICAN_VOICE),
    ("g-gui-guitarra.mp3", "guitarra", LATIN_AMERICAN_VOICE),
    ("g-gue-diaeresis-vergueenza.mp3", "vergüenza", LATIN_AMERICAN_VOICE),
    ("g-gui-diaeresis-pingueino.mp3", "pingüino", LATIN_AMERICAN_VOICE),
    ("h-hola.mp3", "hola", LATIN_AMERICAN_VOICE),
    ("h-ahora.mp3", "ahora", LATIN_AMERICAN_VOICE),
    ("j-jamon.mp3", "jamón", LATIN_AMERICAN_VOICE),
    ("j-jirafa.mp3", "jirafa", LATIN_AMERICAN_VOICE),
    ("l-pala.mp3", "pala", LATIN_AMERICAN_VOICE),
    ("ll-calle.mp3", "calle", LATIN_AMERICAN_VOICE),
    ("r-initial-rojo.mp3", "rojo", LATIN_AMERICAN_VOICE),
    ("r-after-n-enrique.mp3", "Enrique", LATIN_AMERICAN_VOICE),
    ("r-after-l-alrededor.mp3", "alrededor", LATIN_AMERICAN_VOICE),
    ("r-after-s-israel.mp3", "Israel", LATIN_AMERICAN_VOICE),
    ("r-tap-pero.mp3", "pero", LATIN_AMERICAN_VOICE),
    ("r-tap-cara.mp3", "cara", LATIN_AMERICAN_VOICE),
    ("rr-perro.mp3", "perro", LATIN_AMERICAN_VOICE),
    ("d-initial-dedo.mp3", "dedo", LATIN_AMERICAN_VOICE),
    ("d-after-n-andar.mp3", "andar", LATIN_AMERICAN_VOICE),
    ("d-after-l-falda.mp3", "falda", LATIN_AMERICAN_VOICE),
    ("d-soft-cada.mp3", "cada", LATIN_AMERICAN_VOICE),
]


async def generate_one(filename: str, text: str, voice: str) -> None:
    destination = OUTPUT_DIR / filename
    if destination.exists() and destination.stat().st_size > 500:
        print(f"skip {filename}")
        return

    for attempt in range(1, 4):
        try:
            communicate = edge_tts.Communicate(text, voice=voice, rate="-8%")
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
    for item in WORDS:
        await generate_one(*item)


if __name__ == "__main__":
    asyncio.run(main())
