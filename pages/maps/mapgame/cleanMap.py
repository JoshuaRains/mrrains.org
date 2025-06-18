#!/usr/bin/env python3
import xml.etree.ElementTree as ET
import os

def add_ids(input_file, output_file, prefix='path'):
    # Preserve SVG namespace
    ET.register_namespace('', "http://www.w3.org/2000/svg")
    tree = ET.parse(input_file)
    root = tree.getroot()

    # Namespace map for finding <path> elements
    ns = {'svg': "http://www.w3.org/2000/svg"}

    counter = 1
    for path in root.findall('.//svg:path', ns):
        if not path.get('id'):
            path.set('id', f"{prefix}{counter}")
            counter += 1

    tree.write(output_file, encoding='utf-8', xml_declaration=True)
    print(f"✅ Assigned {counter-1} IDs to <path> elements. Saved to '{output_file}'.")

if __name__ == '__main__':
    # Ensure we look in the script's directory, not the current working dir
    script_dir = os.path.dirname(os.path.abspath(__file__))
    input_file = os.path.join(script_dir, 'map.svg')
    output_file = os.path.join(script_dir, 'map_with_ids.svg')

    if not os.path.isfile(input_file):
        print(f"❌ Error: '{input_file}' not found.")
    else:
        add_ids(input_file, output_file)
