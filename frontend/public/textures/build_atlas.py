"""Builds frontend/public/textures/urbanos-detail-atlas.jpg: 2048² atlas, 4×4 slots of 512 px (496 px tile + 8 px
wrapped gutter so mipmaps do not bleed between slots). Each slot is a luminance detail map normalised to mean 0.5;
the shader multiplies it (×2) with the material / tint colour, so traffic tint and selection stay exact on average."""
from PIL import Image, ImageOps, ImageStat
import os
SLOTS = [  # slot: (assetId, file)
    ('Asphalt031', 'Asphalt031/Asphalt031_1K-JPG_Color.jpg'),
    ('Concrete034', 'Concrete034/Concrete034_1K-JPG_Color.jpg'),
    ('Concrete046', 'Concrete046/Concrete046_1K-JPG_Color.jpg'),
    ('PavingStones130', 'PavingStones130/PavingStones130_1K-JPG_Color.jpg'),
    ('Grass004', 'Grass004/Grass004_1K-JPG_Color.jpg'),
    ('Ground037', 'Ground037/Ground037_1K-JPG_Color.jpg'),
    ('Metal032', 'Metal032/Metal032_1K-JPG_Color.jpg'),
    ('Plaster001', 'Plaster001/Plaster001_1K-JPG_Color.jpg'),
    ('Concrete047A', 'Concrete047A/Concrete047A_1K-JPG_Color.jpg'),
]
S, G = 512, 8
T = S - 2 * G
atlas = Image.new('L', (2048, 2048), 128)
for i, (aid, f) in enumerate(SLOTS):
    im = Image.open(f).convert('L')
    w, h = im.size
    if w != h:  # tileable horizontally and vertically: take a square repeat by tiling the short side
        side = max(w, h)
        sq = Image.new('L', (side, side))
        for y in range(0, side, h):
            for x in range(0, side, w):
                sq.paste(im, (x, y))
        im = sq
    im = im.resize((T, T), Image.LANCZOS)
    im = ImageOps.autocontrast(im, cutoff=1)
    mean = ImageStat.Stat(im).mean[0]
    # normalise to mean 128 with a moderate contrast (detail, not a colour)
    k = 0.55
    im = im.point(lambda v: max(0, min(255, int(128 + (v - mean) * k))))
    slot = Image.new('L', (S, S))
    for dy in (-T, 0, T):
        for dx in (-T, 0, T):
            slot.paste(im, (G + dx, G + dy))
    atlas.paste(slot, ((i % 4) * S, (i // 4) * S))
out = '/workspace/work/wt-p7-visuals/frontend/public/textures/urbanos-detail-atlas.jpg'
atlas.save(out, quality=86, optimize=True)
print(out, os.path.getsize(out))
