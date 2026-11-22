# Texture assets — licences

All textures in this folder are derived from **ambientCG** materials, licensed **CC0 1.0 Universal** ("All ambientCG
assets are provided under the Creative Commons CC0 1.0 Universal License", https://docs.ambientcg.com/license/, read
2026-11-22). No attribution is required; it is given here for traceability. No Poly Haven assets are used yet.

`urbanos-detail-atlas.jpg` (2048 × 2048, greyscale JPEG, ~1.0 MB) is built by `build_atlas.py` from the 1K-JPG
`*_Color.jpg` map of each asset: converted to luminance, auto-contrast, normalised to mean 0.5 with 0.55 contrast,
resized to 496 px and tiled into a 512 px slot with an 8 px wrapped gutter. Downloaded 2026-11-22 from
`https://ambientcg.com/get?file=<AssetId>_1K-JPG.zip`.

| Slot | Asset id | Page | Used for (material ids) | Repeat |
|---|---|---|---|---|
| 0 | Asphalt031 | https://ambientcg.com/view?id=Asphalt031 | asphalt, asphalt_deck, cycle_track | 4 m |
| 1 | Concrete034 | https://ambientcg.com/view?id=Concrete034 | concrete_deck, concrete_barrier | 3 m |
| 2 | Concrete046 | https://ambientcg.com/view?id=Concrete046 | concrete_pier, retaining_wall, tunnel_lining | 3 m |
| 3 | PavingStones130 | https://ambientcg.com/view?id=PavingStones130 | paver_footpath | 1.6 m |
| 4 | Grass004 | https://ambientcg.com/view?id=Grass004 | grass_verge | 3 m |
| 5 | Ground037 | https://ambientcg.com/view?id=Ground037 | soil | 4 m |
| 6 | Metal032 | https://ambientcg.com/view?id=Metal032 | steel_rail | 1 m |
| 7 | Plaster001 | https://ambientcg.com/view?id=Plaster001 | building_plaster | 3 m |
| 8 | Concrete047A | https://ambientcg.com/view?id=Concrete047A | kerb_stone, building_roof, drain, track_plinth | 3 m |

Colours are not taken from the textures: the shader multiplies the detail (× 2) with each object's material colour
(`engine/rendering/materials/materialPalette.ts`, tones assumed), so traffic tint and selection colours stay exact.
Repeats are rendering choices (assumed). KTX2 compression is not used yet (JPEG only).
