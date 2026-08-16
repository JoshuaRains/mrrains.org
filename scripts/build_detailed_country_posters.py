import html
import json
import math
import random
import sys
from dataclasses import dataclass
from pathlib import Path

from shapely.geometry import Polygon, box
from shapely.ops import unary_union


PAGE_W, PAGE_H = 11 * 72, 12 * 72
MARGIN = 18
GAP = 6
BIN_W, BIN_H = PAGE_W - 2 * MARGIN, PAGE_H - 2 * MARGIN
LATITUDE_CENTER = -15
DETAIL_TOLERANCE_PT = 1.5
SOUTHERN_CUTOFF = 51.0

COUNTRIES = [
    "Mexico", "Guatemala", "Belize", "El Salvador", "Honduras", "Nicaragua",
    "Costa Rica", "Panama", "Cuba", "Jamaica", "Haiti", "Dominican Rep.",
    "Puerto Rico", "Colombia", "Venezuela", "Guyana", "Suriname", "France",
    "Brazil", "Ecuador", "Peru", "Bolivia", "Paraguay", "Chile", "Argentina",
    "Uruguay",
]
DISPLAY_NAMES = {"France": "French Guiana"}


def project(lon, lat):
    return lon * math.cos(math.radians(LATITUDE_CENTER)), -lat


def decode_arcs(topology):
    sx, sy = topology["transform"]["scale"]
    tx, ty = topology["transform"]["translate"]
    decoded = []
    for arc in topology["arcs"]:
        x = y = 0
        points = []
        for dx, dy in arc:
            x += dx
            y += dy
            points.append(project(x * sx + tx, y * sy + ty))
        decoded.append(points)
    return decoded


def ring_from_arcs(indices, arcs):
    ring = []
    for encoded in indices:
        points = arcs[encoded] if encoded >= 0 else list(reversed(arcs[-encoded - 1]))
        ring.extend(points if not ring else points[1:])
    if ring and ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring


def polygon_area(points):
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(points, points[1:]))) / 2


def centroid(points):
    return (sum(p[0] for p in points[:-1]) / max(1, len(points) - 1),
            sum(p[1] for p in points[:-1]) / max(1, len(points) - 1))


def outer_polygons(geometry, arcs):
    polygons = geometry["arcs"] if geometry["type"] == "MultiPolygon" else [geometry["arcs"]]
    return [ring_from_arcs(polygon[0], arcs) for polygon in polygons if polygon and polygon[0]]


def select_mainland(name, polygons):
    if name == "France":
        # Select French Guiana rather than metropolitan France.
        candidates = [p for p in polygons if -59 < centroid(p)[0] < -45 and -8 < centroid(p)[1] < 2]
        if not candidates:
            raise RuntimeError("French Guiana geometry was not found")
        return max(candidates, key=polygon_area)
    return max(polygons, key=polygon_area)


def customize_southern_geometry(name, polygons):
    """Make the far-southern cutouts cohesive and classroom-cuttable."""
    if name == "Chile":
        cutoff = box(-80, -90, -58, SOUTHERN_CUTOFF)
        coastal_parts = []
        for ring in polygons:
            rx1, ry1, rx2, ry2 = bbox(ring)
            # Retain the mainland and nearby southern archipelago, but omit
            # remote Pacific islands and everything below the common cutoff.
            if rx2 >= -75 and rx1 <= -64 and ry1 <= SOUTHERN_CUTOFF:
                clipped = Polygon(ring).buffer(0).intersection(cutoff)
                if not clipped.is_empty:
                    coastal_parts.append(clipped)

        # Close the narrow channels between nearby islands while allowing the
        # exterior to follow their real shorelines.  The unequal buffers leave
        # a modest amount of extra material at Chile's fragile narrow points.
        combined = unary_union(coastal_parts).buffer(
            0.34, join_style="mitre"
        ).buffer(-0.18, join_style="mitre").intersection(cutoff).buffer(0)
        if combined.geom_type == "MultiPolygon":
            combined = max(combined.geoms, key=lambda g: g.area)
        return list(combined.exterior.coords)

    if name == "Argentina":
        main = Polygon(max(polygons, key=polygon_area)).buffer(0)
        combined = main.intersection(box(-80, -90, -50, SOUTHERN_CUTOFF)).buffer(0)
        if combined.geom_type == "MultiPolygon":
            combined = max(combined.geoms, key=lambda g: g.area)
        return list(combined.exterior.coords)

    return select_mainland(name, polygons)


def chile_with_original_borders(chile_polygons, argentina_polygons):
    """Reinforce Chile's Pacific coast without altering its land borders."""
    cutoff = box(-80, -90, -58, SOUTHERN_CUTOFF)
    southern_zone = box(-80, 40, -58, SOUTHERN_CUTOFF)
    main = Polygon(max(chile_polygons, key=polygon_area)).buffer(0).intersection(cutoff)
    coastal_parts = []
    for ring in chile_polygons:
        rx1, ry1, rx2, ry2 = bbox(ring)
        if rx2 >= -75 and rx1 <= -64 and ry2 >= 40 and ry1 <= SOUTHERN_CUTOFF:
            clipped = Polygon(ring).buffer(0).intersection(southern_zone)
            if not clipped.is_empty:
                coastal_parts.append(clipped)

    reinforced_coast = unary_union(coastal_parts).buffer(
        0.34, join_style="mitre"
    ).buffer(-0.18, join_style="mitre").intersection(southern_zone).buffer(0)
    combined = unary_union([main, reinforced_coast]).intersection(cutoff).buffer(0)

    # Remove any coastal reinforcement that crossed into Argentina. Because
    # Natural Earth uses the same shared border arcs, the resulting interface
    # exactly restores Chile's original eastern land border.
    argentina = Polygon(max(argentina_polygons, key=polygon_area)).buffer(0)
    combined = combined.difference(argentina).buffer(0)
    if combined.geom_type == "MultiPolygon":
        combined = max(combined.geoms, key=lambda g: g.area)
    return list(combined.exterior.coords)


def point_line_distance(point, start, end):
    px, py = point
    x1, y1 = start
    x2, y2 = end
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(px - x1, py - y1)
    t = max(0, min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))


def rdp(points, epsilon):
    if len(points) <= 2:
        return points
    max_distance, split = 0, 0
    for i in range(1, len(points) - 1):
        distance = point_line_distance(points[i], points[0], points[-1])
        if distance > max_distance:
            max_distance, split = distance, i
    if max_distance <= epsilon:
        return [points[0], points[-1]]
    return rdp(points[:split + 1], epsilon)[:-1] + rdp(points[split:], epsilon)


def simplify_closed(points, epsilon):
    if len(points) < 5:
        return points
    ring = points[:-1]
    pivot = min(range(len(ring)), key=lambda i: (ring[i][0], ring[i][1]))
    rotated = ring[pivot:] + ring[:pivot] + [ring[pivot]]
    simplified = rdp(rotated, epsilon)
    return simplified if simplified[-1] == simplified[0] else simplified + [simplified[0]]


def bbox(points):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def clip_edge(points, axis, value, keep_less):
    if not points:
        return []
    source = points[:-1] if points[0] == points[-1] else points
    result = []

    def inside(p):
        return p[axis] <= value + 1e-9 if keep_less else p[axis] >= value - 1e-9

    def intersection(a, b):
        denominator = b[axis] - a[axis]
        t = 0 if abs(denominator) < 1e-12 else (value - a[axis]) / denominator
        other = 1 - axis
        out = [0.0, 0.0]
        out[axis] = value
        out[other] = a[other] + t * (b[other] - a[other])
        return tuple(out)

    previous = source[-1]
    for current in source:
        if inside(current):
            if not inside(previous):
                result.append(intersection(previous, current))
            result.append(current)
        elif inside(previous):
            result.append(intersection(previous, current))
        previous = current
    if result and result[0] != result[-1]:
        result.append(result[0])
    return result


def clip_rect(points, left=None, right=None, top=None, bottom=None):
    result = points
    if left is not None:
        result = clip_edge(result, 0, left, False)
    if right is not None:
        result = clip_edge(result, 0, right, True)
    if top is not None:
        result = clip_edge(result, 1, top, False)
    if bottom is not None:
        result = clip_edge(result, 1, bottom, True)
    return result


def clip_angled_horizontal(points, midpoint_x, midpoint_y, slope, keep_below):
    """Clip against y = midpoint_y + slope * (x - midpoint_x)."""
    flattened = [(x, y - slope * (x - midpoint_x)) for x, y in points]
    clipped = clip_edge(flattened, 1, midpoint_y, keep_below)
    return [(x, y + slope * (x - midpoint_x)) for x, y in clipped]


def fits(points, scale):
    x1, y1, x2, y2 = bbox(points)
    w, h = (x2 - x1) * scale + GAP, (y2 - y1) * scale + GAP
    return (w <= BIN_W and h <= BIN_H) or (h <= BIN_W and w <= BIN_H)


def split_country(name, points, scale):
    if fits(points, scale):
        return [(name, 1, 1, points)]
    x1, y1, x2, y2 = bbox(points)
    xm, ym = (x1 + x2) / 2, (y1 + y2) / 2
    if name == "Brazil":
        # Divide Brazil with two full diagonal lines forming an X. Each line
        # crosses substantial interior land, avoiding coastal slivers entirely.
        xm = x1 + (x2 - x1) * 0.50
        ym = y1 + (y2 - y1) * 0.45
        above_a = clip_angled_horizontal(points, xm, ym, 1.30, False)
        below_a = clip_angled_horizontal(points, xm, ym, 1.30, True)
        quadrants = [
            clip_angled_horizontal(above_a, xm, ym, -1.00, False),
            clip_angled_horizontal(above_a, xm, ym, -1.00, True),
            clip_angled_horizontal(below_a, xm, ym, -1.00, False),
            clip_angled_horizontal(below_a, xm, ym, -1.00, True),
        ]
        if all(len(part) >= 4 and fits(part, scale) for part in quadrants):
            return [(name, i + 1, 4, part) for i, part in enumerate(quadrants)]
        raise RuntimeError("Brazil X-cut cannot fit within four sheets at this scale")
    options = [
        [clip_rect(points, right=xm), clip_rect(points, left=xm)],
        [clip_rect(points, bottom=ym), clip_rect(points, top=ym)],
    ]
    valid = [parts for parts in options if all(len(part) >= 4 and fits(part, scale) for part in parts)]
    if valid:
        parts = min(valid, key=lambda group: max(polygon_area(part) for part in group) - min(polygon_area(part) for part in group))
        return [(name, i + 1, 2, part) for i, part in enumerate(parts)]
    quadrants = [
        clip_rect(points, right=xm, bottom=ym), clip_rect(points, left=xm, bottom=ym),
        clip_rect(points, right=xm, top=ym), clip_rect(points, left=xm, top=ym),
    ]
    if all(len(part) >= 4 and fits(part, scale) for part in quadrants):
        return [(name, i + 1, 4, part) for i, part in enumerate(quadrants)]
    raise RuntimeError(f"{name} cannot fit within four sheets at this scale")


@dataclass
class Item:
    country: str
    part: int
    total: int
    points: list
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
                    yield (min(fw-w, fh-h), max(fw-w, fh-h), fw*fh-w*h, x, y, w, h, rotated)

    def place(self, item, candidate):
        _, _, _, ux, uy, uw, uh, rotated = candidate
        new_free = []
        for fx, fy, fw, fh in self.free:
            if ux >= fx+fw or ux+uw <= fx or uy >= fy+fh or uy+uh <= fy:
                new_free.append((fx, fy, fw, fh)); continue
            if ux > fx: new_free.append((fx, fy, ux-fx, fh))
            if ux+uw < fx+fw: new_free.append((ux+uw, fy, fx+fw-ux-uw, fh))
            if uy > fy: new_free.append((fx, fy, fw, uy-fy))
            if uy+uh < fy+fh: new_free.append((fx, uy+uh, fw, fy+fh-uy-uh))
        self.free = [r for i, r in enumerate(new_free) if r[2] > .01 and r[3] > .01 and not any(
            i != j and r[0] >= q[0] and r[1] >= q[1] and r[0]+r[2] <= q[0]+q[2] and r[1]+r[3] <= q[1]+q[3]
            for j, q in enumerate(new_free))]
        self.used.append((item, ux, uy, uw, uh, rotated))


def pack(items, seed):
    rng = random.Random(seed)
    ordered = sorted(items, key=lambda i: (max(i.w, i.h)*rng.uniform(.9, 1.1), i.w*i.h), reverse=True)
    bins = []
    for item in ordered:
        choices = []
        for bi, board in enumerate(bins):
            choices.extend(((bi,) + c[:3], bi, c) for c in board.candidates(item))
        if not choices:
            bins.append(MaxRectsBin())
            bi = len(bins)-1
            choices = [((bi,) + c[:3], bi, c) for c in bins[bi].candidates(item)]
        _, bi, candidate = min(choices)
        bins[bi].place(item, candidate)
    return bins


def svg_path(points, scale, x, y, rotated):
    x1, y1, _, _ = bbox(points)
    px, py = MARGIN + x + GAP/2, MARGIN + y + GAP/2
    transformed = []
    for vx, vy in points:
        sx, sy = (vx-x1)*scale, (vy-y1)*scale
        transformed.append((px + (sy if rotated else sx), py + (sx if rotated else sy)))
    return "M" + "L".join(f"{vx:.2f},{vy:.2f}" for vx, vy in transformed) + "Z"


def write_sheet(path, board, number, scale):
    lines = [f'<svg width="11in" height="12in" viewBox="0 0 {PAGE_W} {PAGE_H}" xmlns="http://www.w3.org/2000/svg">',
             f'<title>Detailed Latin America cutouts — sheet {number}</title>', '<rect width="100%" height="100%" fill="white"/>',
             f'<rect x="{MARGIN}" y="{MARGIN}" width="{BIN_W}" height="{BIN_H}" fill="none" stroke="#B8B8B8" stroke-width="0.5" stroke-dasharray="3 3"/>']
    for item, x, y, _, _, rotated in board.used:
        part = f" part {item.part} of {item.total}" if item.total > 1 else ""
        lines.append(f'<path data-country="{html.escape(item.country)}" data-part="{item.part}/{item.total}" d="{svg_path(item.points, scale, x, y, rotated)}" fill="white" stroke="black" stroke-width="1.2" stroke-linejoin="round"><title>{html.escape(item.country + part)}</title></path>')
    lines.append('</svg>')
    path.write_text("\n".join(lines)+"\n", encoding="utf-8")


def write_guide(path, countries):
    all_points = [p for points in countries.values() for p in points]
    x1, y1, x2, y2 = bbox(all_points)
    scale = min((PAGE_W-72)/(x2-x1), (PAGE_H-72)/(y2-y1))
    ox, oy = (PAGE_W-(x2-x1)*scale)/2, (PAGE_H-(y2-y1)*scale)/2
    lines = [f'<svg width="11in" height="12in" viewBox="0 0 {PAGE_W} {PAGE_H}" xmlns="http://www.w3.org/2000/svg">',
             '<title>Latin America map assembly guide</title>', '<rect width="100%" height="100%" fill="white"/>']
    for name, points in countries.items():
        data = "M" + "L".join(f"{ox+(x-x1)*scale:.2f},{oy+(y-y1)*scale:.2f}" for x, y in points) + "Z"
        lines.append(f'<path data-country="{html.escape(name)}" d="{data}" fill="white" stroke="black" stroke-width="0.8" stroke-linejoin="round"/>')
    lines.append('</svg>')
    path.write_text("\n".join(lines)+"\n", encoding="utf-8")


def write_overview(path, sheet_count):
    thumb_w, thumb_h, label_h = 198, 216, 18
    columns = 4
    rows = math.ceil(sheet_count / columns)
    width, height = columns * thumb_w, rows * (thumb_h + label_h)
    lines = [f'<svg width="{width}" height="{height}" viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg">',
             '<rect width="100%" height="100%" fill="#E8E8E8"/>']
    for i in range(sheet_count):
        x, y = (i % columns) * thumb_w, (i // columns) * (thumb_h + label_h)
        filename = f"detailed-latin-america-cutouts-{i+1:02d}.svg"
        lines.append(f'<image href="{filename}" x="{x}" y="{y}" width="{thumb_w}" height="{thumb_h}"/>')
        lines.append(f'<text x="{x+6}" y="{y+thumb_h+14}" font-family="Arial, sans-serif" font-size="12" fill="black">Sheet {i+1}</text>')
    lines.append('</svg>')
    path.write_text("\n".join(lines)+"\n", encoding="utf-8")


def main(source, output_dir):
    topology = json.loads(source.read_text(encoding="utf-8"))
    arcs = decode_arcs(topology)
    geometries = {g["properties"]["name"]: g for g in topology["objects"]["countries"]["geometries"]}
    raw = {DISPLAY_NAMES.get(name, name): customize_southern_geometry(name, outer_polygons(geometries[name], arcs)) for name in COUNTRIES}
    bx1, by1, bx2, by2 = bbox(raw["Brazil"])
    # Leave enough room for Brazil's four diagonal X-cut sections to fit within
    # one printable sheet apiece.
    scale = min((2*BIN_W-2*GAP)/(bx2-bx1), (2*BIN_H-2*GAP)/(by2-by1)) * 0.966
    tolerance = DETAIL_TOLERANCE_PT / scale
    countries = {name: simplify_closed(points, tolerance) for name, points in raw.items()}
    pieces = [piece for name, points in countries.items() for piece in split_country(name, points, scale)]
    items = []
    for name, part, total, points in pieces:
        x1, y1, x2, y2 = bbox(points)
        items.append(Item(name, part, total, points, (x2-x1)*scale+GAP, (y2-y1)*scale+GAP))
    best = min((pack(items, seed) for seed in range(6000)), key=len)
    output_dir.mkdir(parents=True, exist_ok=True)
    for old in output_dir.glob("detailed-latin-america-cutouts-*.svg"):
        old.unlink()
    for number, board in enumerate(best, 1):
        write_sheet(output_dir/f"detailed-latin-america-cutouts-{number:02d}.svg", board, number, scale)
    write_guide(output_dir/"detailed-latin-america-assembly-guide.svg", countries)
    write_overview(output_dir/"detailed-latin-america-print-layout-overview.svg", len(best))
    print(f"scale={scale:.5f} points/projected-degree; sheets={len(best)}; countries={len(countries)}; pieces={len(items)}")
    for source_name in COUNTRIES:
        name = DISPLAY_NAMES.get(source_name, source_name)
        country_pieces = [item for item in items if item.country == name]
        x1, y1, x2, y2 = bbox(countries[name])
        print(f"{name}: {(x2-x1)*scale/72:.2f}in x {(y2-y1)*scale/72:.2f}in; {len(country_pieces)} piece(s); {len(countries[name])-1} vertices")
    for number, board in enumerate(best, 1):
        print(f"sheet {number}: " + ", ".join(f"{i.country} {i.part}/{i.total}" for i, *_ in board.used))


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
