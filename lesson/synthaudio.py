import asyncio
import json
import os
import re
from typing import Any, Dict, List, Set, Tuple

import edge_tts  # pip install edge-tts


# =========================
# SETTINGS
# =========================
LESSON_INPUT_DIR = os.path.join(".", "lessonInput")
OUTPUT_DIR = os.path.join(".", "duolingoAudio")

# Latin American female voice (single voice for EVERYTHING)
VOICE = "es-MX-DaliaNeural"

# Do NOT vary speed
RATE = "+0%"

MIN_AUDIO_BYTES = 500
SKIP_EXISTING_AUDIO = True

# =========================


# --------- utilities ---------
_WS_RE = re.compile(r"\s+", flags=re.UNICODE)

# Keep Spanish letters; remove most punctuation for filenames / tokenization
_PUNCT_FOR_FILENAME_RE = re.compile(r"[^\w\sáéíóúüñÁÉÍÓÚÜÑ]+", flags=re.UNICODE)
_PUNCT_FOR_TOKENS_RE = re.compile(r"[^\w\sáéíóúüñÁÉÍÓÚÜÑ]+", flags=re.UNICODE)


def load_json(path: str) -> Any:
	with open(path, "r", encoding="utf-8") as f:
		return json.load(f)


def looks_like_valid_audio(path: str) -> bool:
	try:
		return os.path.exists(path) and os.path.getsize(path) >= MIN_AUDIO_BYTES
	except Exception:
		return False


def clean_text(text: str) -> str:
	return _WS_RE.sub(" ", str(text).strip())


def filename_from_phrase(phrase: str) -> str:
	"""
	Filename convention you described:
	- no punctuation
	- _ instead of spaces
	- lowercase
	"""
	s = str(phrase).strip().lower()
	s = _WS_RE.sub(" ", s)
	s = _PUNCT_FOR_FILENAME_RE.sub("", s)
	s = s.replace(" ", "_")
	s = re.sub(r"_+", "_", s).strip("_")
	if not s:
		s = "untitled"
	return s + ".mp3"


def tokenize_words(spanish_phrase: str) -> List[str]:
	"""
	Word tokens for individual-word MP3s, derived ONLY from Spanish phrases.
	We strip punctuation and split on spaces.
	"""
	s = str(spanish_phrase).strip()
	s = _PUNCT_FOR_TOKENS_RE.sub(" ", s)
	s = _WS_RE.sub(" ", s).strip()
	if not s:
		return []
	return [w for w in s.split(" ") if w.strip()]


# --------- extraction (lesson-config-aware) ---------
def extract_spanish_audio_phrases(lesson: Dict[str, Any]) -> Set[str]:
	"""
	Collect the Spanish phrases we should generate audio for.

	Primary rule (Spanish-only safety):
	- Prefer the explicit 'audio' field (your configs consistently put Spanish there),
	  e.g. listen-es-es / translate-en-es / listen-es-en / translate-es-en / type-es-en-typed / type-en-es-typed, etc.
	  The guide examples show Spanish stored in "audio". :contentReference[oaicite:0]{index=0} :contentReference[oaicite:1]{index=1}

	Fallbacks (only when audio is missing):
	- listen-es-es: use "spanish" :contentReference[oaicite:2]{index=2}
	- listen-es-en: use "spanish" :contentReference[oaicite:3]{index=3}
	- translate-es-en: use "sentence" :contentReference[oaicite:4]{index=4}
	- type-es-en-typed: use "sentence" (Spanish prompt) :contentReference[oaicite:5]{index=5}
	- type-en-es-typed / listen-es-*-typed variants: use "audio" (should exist per your configs) :contentReference[oaicite:6]{index=6}
	"""
	phrases: Set[str] = set()
	questions = lesson.get("questions") or []
	if not isinstance(questions, list):
		return phrases

	for q in questions:
		if not isinstance(q, dict):
			continue

		qtype = str(q.get("type") or "").strip()

		# 1) Preferred: explicit Spanish audio field (works across *all* question types, including your newer ones)
		audio = q.get("audio")
		if isinstance(audio, str) and audio.strip():
			phrases.add(clean_text(audio))
			continue

		# 2) Fallbacks when 'audio' is absent
		if qtype in {"listen-es-es", "listen-es-en"}:
			spanish = q.get("spanish")
			if isinstance(spanish, str) and spanish.strip():
				phrases.add(clean_text(spanish))
				continue

		if qtype == "translate-es-en":
			sentence = q.get("sentence")
			if isinstance(sentence, str) and sentence.strip():
				phrases.add(clean_text(sentence))
				continue

		if qtype == "type-es-en-typed":
			sentence = q.get("sentence")
			if isinstance(sentence, str) and sentence.strip():
				phrases.add(clean_text(sentence))
				continue

	return phrases


def build_required_audio(phrases: Set[str]) -> Tuple[Set[str], Set[str]]:
	"""
	Return (full_phrases, individual_words) derived ONLY from the Spanish phrases we extracted.
	"""
	full_phrases: Set[str] = set()
	words: Set[str] = set()

	for p in phrases:
		p2 = clean_text(p)
		if not p2:
			continue
		full_phrases.add(p2)
		for w in tokenize_words(p2):
			w2 = clean_text(w)
			if w2:
				words.add(w2)

	return full_phrases, words


# --------- synthesis ---------
async def synthesize_to_file(text: str, out_path: str) -> None:
	os.makedirs(os.path.dirname(out_path), exist_ok=True)
	communicate = edge_tts.Communicate(text, voice=VOICE, rate=RATE)
	await communicate.save(out_path)


async def synthesize_with_retries(text: str, out_path: str, attempts: int = 3) -> None:
	last_err: Exception | None = None
	for attempt in range(1, attempts + 1):
		try:
			await synthesize_to_file(text, out_path)
			if not looks_like_valid_audio(out_path):
				raise RuntimeError("Audio file missing/too small after save")
			return
		except Exception as e:
			last_err = e
			await asyncio.sleep(0.5 * attempt)
	if last_err:
		raise last_err
	raise RuntimeError("Unknown TTS failure")


def list_lesson_files(folder: str) -> List[str]:
	if not os.path.isdir(folder):
		return []
	out: List[str] = []
	for name in os.listdir(folder):
		if name.lower().endswith(".json"):
			out.append(os.path.join(folder, name))
	out.sort()
	return out


async def main_async() -> None:
	lesson_files = list_lesson_files(LESSON_INPUT_DIR)
	if not lesson_files:
		print(f"No .json files found in {LESSON_INPUT_DIR}")
		return

	print(f"Lesson input: {LESSON_INPUT_DIR}")
	print(f"Output dir:   {OUTPUT_DIR}")
	print(f"Voice: {VOICE} | Rate: {RATE}\n")

	# Collect across ALL lesson files first, so we don’t synthesize duplicates
	all_phrases: Set[str] = set()

	for path in lesson_files:
		try:
			lesson = load_json(path)
			if isinstance(lesson, dict):
				phrases = extract_spanish_audio_phrases(lesson)
				all_phrases |= phrases
				print(f"✅ {os.path.basename(path)} -> phrases found: {len(phrases)}")
			else:
				print(f"⚠️  {os.path.basename(path)} -> root is not an object; skipped")
		except Exception as e:
			print(f"❌ {os.path.basename(path)} -> ERROR: {type(e).__name__}: {e}")

	full_phrases, words = build_required_audio(all_phrases)

	print("\nTotals across all lessons:")
	print(f"  Unique Spanish phrases: {len(full_phrases)}")
	print(f"  Unique Spanish words:   {len(words)}\n")

	# Synthesize: phrases first, then words
	items: List[Tuple[str, str]] = []
	for p in sorted(full_phrases, key=lambda x: x.lower()):
		items.append(("phrase", p))
	for w in sorted(words, key=lambda x: x.lower()):
		items.append(("word", w))

	made = 0
	skipped = 0
	failed = 0

	for kind, text in items:
		name = filename_from_phrase(text)
		out_path = os.path.join(OUTPUT_DIR, name)

		if SKIP_EXISTING_AUDIO and looks_like_valid_audio(out_path):
			skipped += 1
			continue

		try:
			await synthesize_with_retries(text, out_path, attempts=3)
			made += 1
			print(f"✅ {kind:<6} {name}   <- {text}")
		except Exception as e:
			failed += 1
			print(f"❌ {kind:<6} {name}   ERROR: {type(e).__name__}: {e}")

	print("\nDone.")
	print(f"Made: {made} | Skipped: {skipped} | Failed: {failed}")


def main() -> None:
	asyncio.run(main_async())


if __name__ == "__main__":
	main()