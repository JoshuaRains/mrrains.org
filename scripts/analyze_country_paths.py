import math
import re
import sys
import xml.etree.ElementTree as ET


def cubic_at(p0, p1, p2, p3, t):
    u = 1 - t
    return u**3 * p0 + 3 * u**2 * t * p1 + 3 * u * t**2 * p2 + t**3 * p3


def cubic_extrema(p0, p1, p2, p3):
    a = -p0 + 3 * p1 - 3 * p2 + p3
    b = 2 * (p0 - 2 * p1 + p2)
    c = p1 - p0
    roots = []
    if abs(a) < 1e-12:
        if abs(b) > 1e-12:
            roots.append(-c / b)
    else:
        disc = b * b - 4 * a * c
        if disc >= 0:
            root = math.sqrt(disc)
            roots.extend(((-b + root) / (2 * a), (-b - root) / (2 * a)))
    return [t for t in roots if 0 < t < 1]


def path_bbox(data):
    tokens = re.findall(r"[MLCHVZ]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?", data)
    i = 0
    cmd = None
    x = y = start_x = start_y = 0.0
    xs, ys = [], []

    def point(px, py):
        xs.append(px)
        ys.append(py)

    while i < len(tokens):
        if tokens[i].isalpha():
            cmd = tokens[i]
            i += 1
            if cmd == "Z":
                x, y = start_x, start_y
                point(x, y)
                continue
        if cmd == "M":
            x, y = float(tokens[i]), float(tokens[i + 1])
            start_x, start_y = x, y
            point(x, y)
            i += 2
            cmd = "L"
        elif cmd == "L":
            x, y = float(tokens[i]), float(tokens[i + 1])
            point(x, y)
            i += 2
        elif cmd == "H":
            x = float(tokens[i])
            point(x, y)
            i += 1
        elif cmd == "V":
            y = float(tokens[i])
            point(x, y)
            i += 1
        elif cmd == "C":
            x1, y1, x2, y2, x3, y3 = map(float, tokens[i:i + 6])
            txs = cubic_extrema(x, x1, x2, x3)
            tys = cubic_extrema(y, y1, y2, y3)
            point(x3, y3)
            for t in txs:
                point(cubic_at(x, x1, x2, x3, t), cubic_at(y, y1, y2, y3, t))
            for t in tys:
                point(cubic_at(x, x1, x2, x3, t), cubic_at(y, y1, y2, y3, t))
            x, y = x3, y3
            i += 6
        else:
            raise ValueError(f"Unsupported command {cmd}")
    return min(xs), min(ys), max(xs), max(ys)


if __name__ == "__main__":
    tree = ET.parse(sys.argv[1])
    root = tree.getroot()
    paths = root.findall("{http://www.w3.org/2000/svg}path")
    for index, path in enumerate(paths, 1):
        x1, y1, x2, y2 = path_bbox(path.attrib["d"])
        print(f"{index:02d} x={x1:7.2f} y={y1:7.2f} w={x2-x1:7.2f} h={y2-y1:7.2f} area={(x2-x1)*(y2-y1):9.1f}")
