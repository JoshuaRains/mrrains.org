# Detailed Latin America map source

The country geometry is derived from Natural Earth Admin 0 country boundaries at 1:10m scale via `world-atlas` 2.0.2.

- Natural Earth: public-domain map data — https://www.naturalearthdata.com/
- world-atlas: pre-built topology derived from Natural Earth — https://github.com/topojson/world-atlas
- Downloaded source: `assets/countries-10m.json`

For physically cohesive classroom cutouts, each country uses its largest principal landmass. Tiny offshore islands are intentionally omitted. The France geometry is filtered to French Guiana for this Latin America set. Chile and Argentina share a straight southern cutoff at 51 degrees south, before Tierra del Fuego. Chile's nearby southern islands are joined into one reinforced shape while retaining their outer shoreline detail.

Brazil is divided into four pieces by two intersecting diagonal lines. This X-cut keeps every tape seam well inside the country instead of running alongside its coastline.

The generated sheets declare their physical size as 11 by 12 inches. Print at 100% or Actual Size.
