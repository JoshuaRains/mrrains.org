from pathlib import Path
import random
import re
import xml.etree.ElementTree as ET

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

VERBS = [
    "hablar", "comer", "vivir", "caminar", "beber", "escribir", "trabajar",
    "leer", "abrir", "estudiar", "aprender", "recibir", "mirar", "vender",
    "compartir", "usar", "correr", "decidir", "escuchar", "responder",
    "asistir", "enseñar", "comprender", "sufrir", "sacar", "prometer",
    "permitir", "tocar", "deber",
]
SUBJECTS = ["yo", "tú", "él", "nosotros", "ellos"]
STUDENTS = 65
CARDS_PER_SIDE = 4
TOTAL_CARDS = STUDENTS * 2
MODEL_SIZE = 400
TEMPLATE_PATH = Path(__file__).resolve().parents[1] / "pages" / "tools" / "conjugationbingo" / "assets" / "verb-bingo-template.svg"


def load_title_path():
    root = ET.parse(TEMPLATE_PATH).getroot()
    return next(child.attrib["d"] for child in root if child.tag.endswith("path"))


def draw_svg_path(c, path_data):
    tokens = re.findall(r"[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?", path_data)
    path, i, command = c.beginPath(), 0, None
    current_x = current_y = 0.0
    counts = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6}
    while i < len(tokens):
        if tokens[i].isalpha():
            command, i = tokens[i].upper(), i + 1
            if command == "Z":
                path.close()
                continue
        count = counts[command]
        values = [float(value) for value in tokens[i:i + count]]
        i += count
        if command == "M":
            current_x, current_y = values
            path.moveTo(current_x, MODEL_SIZE - current_y)
            command = "L"
        elif command == "L":
            current_x, current_y = values
            path.lineTo(current_x, MODEL_SIZE - current_y)
        elif command == "H":
            current_x = values[0]
            path.lineTo(current_x, MODEL_SIZE - current_y)
        elif command == "V":
            current_y = values[0]
            path.lineTo(current_x, MODEL_SIZE - current_y)
        elif command == "C":
            x1, y1, x2, y2, current_x, current_y = values
            path.curveTo(x1, MODEL_SIZE - y1, x2, MODEL_SIZE - y2, current_x, MODEL_SIZE - current_y)
    c.drawPath(path, stroke=0, fill=1)


def make_cards(seed=20260831):
    rng = random.Random(seed)
    cards, seen = [], set()
    while len(cards) < TOTAL_CARDS:
        verbs = tuple(rng.sample(VERBS, 5))
        subjects = tuple(rng.sample(SUBJECTS, 5))
        signature = verbs + subjects
        if signature not in seen:
            seen.add(signature)
            cards.append((verbs, subjects))
    return cards


def draw_model_card(c, x, y, width, height, verbs, subjects, title_path):
    """Draw the supplied 400x400 model, changing only its row/column text."""
    # Crop only unused SVG whitespace. All model elements retain their exact
    # proportions and positions relative to one another.
    crop_left, crop_bottom, crop_right, crop_top = 0, 5, 325, 375
    scale = min(width / (crop_right - crop_left), height / (crop_top - crop_bottom))
    rendered_width = (crop_right - crop_left) * scale
    rendered_height = (crop_top - crop_bottom) * scale
    offset_x = x + (width - rendered_width) / 2
    offset_y = y + (height - rendered_height) / 2
    c.saveState()
    clip = c.beginPath()
    clip.rect(x, y, width, height)
    c.clipPath(clip, stroke=0, fill=0)
    c.translate(offset_x - crop_left * scale, offset_y - crop_bottom * scale)
    c.scale(scale, scale)
    c.setFillColorRGB(1, 1, 1)
    c.rect(0, 0, MODEL_SIZE, MODEL_SIZE, stroke=0, fill=1)
    c.setFillColorRGB(0, 0, 0)
    c.setStrokeColorRGB(0, 0, 0)

    draw_svg_path(c, title_path)

    c.setLineWidth(1)
    for row in range(5):
        for col in range(5):
            c.rect(77.5 + col * 49, 61.5 + row * 49, 49, 49, stroke=1, fill=0)

    c.setFont("Helvetica-Bold", 10)
    for verb, center_y in zip(verbs, [282, 233, 184, 135, 86]):
        c.drawRightString(70, center_y - 3.5, verb)

    column_centers = [101.5, 150.5, 199.5, 248.5, 297.5]
    for center_x in column_centers:
        c.line(center_x, 51, center_x, 59)
    for subject, center_x in zip(subjects, column_centers):
        c.saveState()
        c.translate(center_x, 51)
        c.rotate(45)
        c.setFont("Helvetica-Bold", 10)
        c.drawRightString(0, -3.5, subject)
        c.restoreState()
    c.restoreState()


def draw_side(c, cards, start_index, end_index, title_path, mirror_columns=False):
    page_w, page_h = letter
    # Use the full printable page as four large quadrants.
    margin, gutter = 4, 4
    card_width = (page_w - 2 * margin - gutter) / 2
    card_height = (page_h - 2 * margin - gutter) / 2
    positions = [
        (margin, margin + card_height + gutter),
        (margin + card_width + gutter, margin + card_height + gutter),
        (margin, margin),
        (margin + card_width + gutter, margin),
    ]
    if mirror_columns:
        positions = [positions[1], positions[0], positions[3], positions[2]]
    for offset, (x, y) in enumerate(positions):
        index = start_index + offset
        if index < end_index:
            verbs, subjects = cards[index]
            draw_model_card(c, x, y, card_width, card_height, verbs, subjects, title_path)


def build_pdf(output_path):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cards = make_cards()
    title_path = load_title_path()
    pdf = canvas.Canvas(str(output_path), pagesize=letter, pageCompression=1)
    pdf.setTitle("Conjugation Bingo - 65 Students")
    pdf.setAuthor("mrrains.org")
    physical_sheets = (STUDENTS + CARDS_PER_SIDE - 1) // CARDS_PER_SIDE
    for sheet in range(physical_sheets):
        draw_side(pdf, cards, sheet * CARDS_PER_SIDE, STUDENTS, title_path)
        pdf.showPage()
        draw_side(pdf, cards, STUDENTS + sheet * CARDS_PER_SIDE, TOTAL_CARDS, title_path, True)
        if sheet < physical_sheets - 1:
            pdf.showPage()
    pdf.save()


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    build_pdf(root / "output" / "pdf" / "conjugation-bingo-65-students-duplex.pdf")
