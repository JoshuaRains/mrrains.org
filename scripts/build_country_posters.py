import html
import random
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

from analyze_country_paths import path_bbox


PAGE_W, PAGE_H = 11 * 72, 14 * 72
MARGIN = 18
GAP = 6
BIN_W, BIN_H = PAGE_W - 2 * MARGIN, PAGE_H - 2 * MARGIN
BRAZIL_INDEX = 16


@dataclass
class Item:
    index: int
    data: str
    bbox: tuple
    w: float
    h: float


class MaxRectsBin:
    def __init__(self):
        self.free = [(0.0, 0.0, BIN_W, BIN_H)]
        self.used = []

    def candidates(self, item):
        for rotated, (w, h) in ((False, (item.w, item.h)), (True, (item.h, item.w))):
            for x, y, fw, fh in self.free:
                if w <= fw + 1e-7 and h <= fh + 1e-7:
                    yield (min(fw - w, fh - h), max(fw - w, fh - h), fw * fh - w * h,
                           x, y, w, h, rotated)

    def place(self, item, candidate):
        _, _, _, x, y, w, h, rotated = candidate
        used = (x, y, w, h)
        new_free = []
        ux, uy, uw, uh = used
        for fx, fy, fw, fh in self.free:
            if ux >= fx + fw or ux + uw <= fx or uy >= fy + fh or uy + uh <= fy:
                new_free.append((fx, fy, fw, fh))
                continue
            if ux > fx:
                new_free.append((fx, fy, ux - fx, fh))
            if ux + uw < fx + fw:
                new_free.append((ux + uw, fy, fx + fw - ux - uw, fh))
            if uy > fy:
                new_free.append((fx, fy, fw, uy - fy))
            if uy + uh < fy + fh:
                new_free.append((fx, uy + uh, fw, fy + fh - uy - uh))
        pruned = []
        for i, rect in enumerate(new_free):
            x1, y1, w1, h1 = rect
            if w1 < 0.01 or h1 < 0.01:
                continue
            contained = False
            for j, other in enumerate(new_free):
                if i == j:
                    continue
                x2, y2, w2, h2 = other
                if x1 >= x2 and y1 >= y2 and x1 + w1 <= x2 + w2 and y1 + h1 <= y2 + h2:
                    contained = True
                    break
            if not contained:
                pruned.append(rect)
        self.free = pruned
        self.used.append((item, x, y, w, h, rotated))


def try_pack(items, seed):
    rng = random.Random(seed)
    brazil = next(item for item in items if item.index == BRAZIL_INDEX)
    others = [item for item in items if item.index != BRAZIL_INDEX]
    # Large dimensions dominate, with seeded jitter exploring alternate packings.
    others.sort(key=lambda item: (max(item.w, item.h) * rng.uniform(.86, 1.14),
                                  item.w * item.h * rng.uniform(.9, 1.1)), reverse=True)
    bins = [MaxRectsBin()]
    brazil_candidates = list(bins[0].candidates(brazil))
    normal = [c for c in brazil_candidates if not c[-1]]
    bins[0].place(brazil, min(normal))

    for item in others:
        choices = []
        for bin_index, board in enumerate(bins):
            for candidate in board.candidates(item):
                # Prefer filling earlier sheets before opening up space on later
                # sheets; within a sheet, use the standard short-side fit score.
                score = (bin_index,) + candidate[:3]
                choices.append((score, bin_index, candidate))
        if not choices:
            board = MaxRectsBin()
            bins.append(board)
            choices = [((len(bins)-1, c[0], c[1], c[2]), len(bins)-1, c)
                       for c in board.candidates(item)]
        _, bin_index, candidate = min(choices)
        bins[bin_index].place(item, candidate)
    return bins


def overlap(a, b):
    _, ax, ay, aw, ah, _ = a
    _, bx, by, bw, bh, _ = b
    return ax < bx + bw and ax + aw > bx and ay < by + bh and ay + ah > by


def write_sheet(path, board, sheet_number, scale):
    lines = [
        f'<svg width="11in" height="14in" viewBox="0 0 {PAGE_W} {PAGE_H}" xmlns="http://www.w3.org/2000/svg">',
        f'  <title>Latin America map cutouts — sheet {sheet_number}</title>',
        '  <rect width="100%" height="100%" fill="white"/>',
        f'  <rect x="{MARGIN}" y="{MARGIN}" width="{BIN_W}" height="{BIN_H}" fill="none" stroke="#B8B8B8" stroke-width="0.5" stroke-dasharray="3 3"/>',
    ]
    for item, x, y, _, _, rotated in board.used:
        min_x, min_y, max_x, max_y = item.bbox
        px, py = MARGIN + x + GAP / 2, MARGIN + y + GAP / 2
        name = "brazil" if item.index == BRAZIL_INDEX else f"country-{item.index:02d}"
        if rotated:
            tx = px + scale * max_y
            ty = py - scale * min_x
            transform = f"translate({tx:.4f} {ty:.4f}) rotate(90) scale({scale:.6f})"
        else:
            tx = px - scale * min_x
            ty = py - scale * min_y
            transform = f"translate({tx:.4f} {ty:.4f}) scale({scale:.6f})"
        lines.append(f'  <path id="{name}" data-source-index="{item.index}" d="{html.escape(item.data, quote=True)}" transform="{transform}" fill="white" stroke="black" stroke-width="0.5" vector-effect="none"/>')
    lines.append('</svg>')
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(source, output_dir):
    root = ET.parse(source).getroot()
    nodes = root.findall("{http://www.w3.org/2000/svg}path")
    raw = [(i, node.attrib["d"], path_bbox(node.attrib["d"])) for i, node in enumerate(nodes, 1)]
    brazil_bbox = raw[BRAZIL_INDEX - 1][2]
    brazil_width = brazil_bbox[2] - brazil_bbox[0]
    scale = (BIN_W - GAP) / brazil_width
    items = []
    for index, data, bbox in raw:
        w = (bbox[2] - bbox[0]) * scale + GAP
        h = (bbox[3] - bbox[1]) * scale + GAP
        items.append(Item(index, data, bbox, w, h))

    best = None
    for seed in range(12000):
        candidate = try_pack(items, seed)
        if best is None or len(candidate) < len(best):
            best = candidate
        if len(best) == 3:
            break

    output_dir.mkdir(parents=True, exist_ok=True)
    for sheet, board in enumerate(best, 1):
        for i, first in enumerate(board.used):
            for second in board.used[i + 1:]:
                if overlap(first, second):
                    raise RuntimeError(f"Overlap on sheet {sheet}")
        write_sheet(output_dir / f"latin-america-map-cutouts-{sheet}.svg", board, sheet, scale)

    print(f"scale={scale:.6f}")
    print(f"brazil={brazil_width*scale/72:.3f}in x {(brazil_bbox[3]-brazil_bbox[1])*scale/72:.3f}in")
    print(f"sheets={len(best)}")
    for i, board in enumerate(best, 1):
        print(f"sheet {i}: " + ", ".join(
            ("Brazil" if item.index == BRAZIL_INDEX else f"path-{item.index:02d}") + (" rotated" if rotated else "")
            for item, _, _, _, _, rotated in board.used))


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
