import html
import json
import sys
from pathlib import Path

import build_detailed_country_posters as base


PAGE_W, PAGE_H = 8.5 * 72, 11 * 72
MARGIN = 18
BIN_W, BIN_H = PAGE_W - 2 * MARGIN, PAGE_H - 2 * MARGIN


def main(source, output_svg):
    topology = json.loads(source.read_text(encoding="utf-8"))
    arcs = base.decode_arcs(topology)
    geometries = {
        geometry["properties"]["name"]: geometry
        for geometry in topology["objects"]["countries"]["geometries"]
    }
    chile_polygons = base.outer_polygons(geometries["Chile"], arcs)
    argentina_polygons = base.outer_polygons(geometries["Argentina"], arcs)
    chile = base.chile_with_original_borders(chile_polygons, argentina_polygons)
    french_guiana = base.select_mainland(
        "France", base.outer_polygons(geometries["France"], arcs)
    )

    bx1, by1, bx2, by2 = base.bbox(
        base.customize_southern_geometry(
            "Brazil", base.outer_polygons(geometries["Brazil"], arcs)
        )
    )
    scale = min(
        (2 * base.BIN_W - 2 * base.GAP) / (bx2 - bx1),
        (2 * base.BIN_H - 2 * base.GAP) / (by2 - by1),
    ) * 0.966
    tolerance = base.DETAIL_TOLERANCE_PT / scale
    chile = base.simplify_closed(chile, tolerance)
    french_guiana = base.simplify_closed(french_guiana, tolerance)
    pieces = base.split_country("Chile", chile, scale)
    pieces.append(("French Guiana", 1, 1, french_guiana))

    items = []
    for name, part, total, points in pieces:
        x1, y1, x2, y2 = base.bbox(points)
        items.append(base.Item(
            name, part, total, points,
            (x2 - x1) * scale + base.GAP,
            (y2 - y1) * scale + base.GAP,
        ))

    old_values = base.PAGE_W, base.PAGE_H, base.BIN_W, base.BIN_H
    base.PAGE_W, base.PAGE_H, base.BIN_W, base.BIN_H = PAGE_W, PAGE_H, BIN_W, BIN_H
    try:
        board = min((base.pack(items, seed) for seed in range(5000)), key=len)
        if len(board) != 1:
            raise RuntimeError("Replacement pieces do not fit on one Letter page")
        lines = [
            f'<svg width="8.5in" height="11in" viewBox="0 0 {PAGE_W} {PAGE_H}" xmlns="http://www.w3.org/2000/svg">',
            '<title>Chile and French Guiana replacement cutouts</title>',
            '<rect width="100%" height="100%" fill="white"/>',
            f'<rect x="{MARGIN}" y="{MARGIN}" width="{BIN_W}" height="{BIN_H}" fill="none" stroke="#B8B8B8" stroke-width="0.5" stroke-dasharray="3 3"/>',
        ]
        for item, x, y, _, _, rotated in board[0].used:
            part = f" part {item.part} of {item.total}" if item.total > 1 else ""
            path = base.svg_path(item.points, scale, x, y, rotated)
            lines.append(
                f'<path data-country="{html.escape(item.country)}" data-part="{item.part}/{item.total}" d="{path}" '
                f'fill="white" stroke="black" stroke-width="1.2" stroke-linejoin="round">'
                f'<title>{html.escape(item.country + part)}</title></path>'
            )
        lines.append('</svg>')
        output_svg.write_text("\n".join(lines) + "\n", encoding="utf-8")
    finally:
        base.PAGE_W, base.PAGE_H, base.BIN_W, base.BIN_H = old_values


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
