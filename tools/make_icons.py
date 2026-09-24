"""Draws the app icon — a gold coin whose face carries a rising trend line, on
the app's blue — and writes the PNG sizes the site links to, plus a matching
icon.svg, into app/icons/.

    python tools/make_icons.py

Drawn at 4x and scaled down so the edges are smooth. The artwork is full-bleed
square on purpose: iOS/Android round the corners themselves. Colors come from
the app's own palette (css --accent, --income, --warning).
"""
import os

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'icons')

N = 1024  # design grid

BG = [(38, 62, 96), (61, 90, 128), (86, 124, 168)]      # background, bottom-left -> top-right
GOLD = [(250, 214, 132), (224, 159, 62), (176, 112, 30)]  # ring, top-left -> bottom-right
FACE = [(28, 46, 74), (42, 68, 104)]                      # coin face, top -> bottom
TEAL = [(95, 211, 192), (170, 246, 228)]                  # trend line, start -> end

CX, CY, R = 512, 500, 340   # coin
RING = 52                   # ring thickness
TREND = [(240, 712), (330, 650), (440, 566), (528, 618), (640, 480), (716, 398)]  # first point sits past the face's edge (clipped)
LINE_W = 46
AREA_BOTTOM = 800           # the area under the line fades out by here...
AREA_FEATHER = (600, 745)   # ...and fades out sideways between these x's, so it has no hard right edge


def lerp_stops(t, stops):
    """t: array in [0,1] -> array (...,3) blended through the color stops."""
    t = np.clip(t, 0, 1)
    seg = t * (len(stops) - 1)
    i = np.minimum(seg.astype(int), len(stops) - 2)
    f = (seg - i)[..., None]
    a = np.array(stops, dtype=float)
    return a[i] * (1 - f) + a[i + 1] * f


def gradient(size, stops, direction):
    """direction: (dx, dy) unit-ish vector; 0 at the start corner, 1 at the end."""
    ys, xs = np.mgrid[0:size, 0:size].astype(float) / (size - 1)
    dx, dy = direction
    t = (xs * dx + ys * dy) / (abs(dx) + abs(dy))
    if dx < 0:
        t += abs(dx) / (abs(dx) + abs(dy))
    if dy < 0:
        t += abs(dy) / (abs(dx) + abs(dy))
    return Image.fromarray(lerp_stops(t, stops).astype('uint8'), 'RGB').convert('RGBA')


def radial_glow(size, cx, cy, radius, alpha):
    ys, xs = np.mgrid[0:size, 0:size].astype(float)
    d = np.hypot(xs - cx, ys - cy) / radius
    a = np.clip(1 - d, 0, 1) ** 2 * alpha * 255
    img = np.zeros((size, size, 4), dtype='uint8')
    img[..., :3] = 255
    img[..., 3] = a.astype('uint8')
    return Image.fromarray(img, 'RGBA')


def circle_mask(size, cx, cy, r):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    return m


def draw(size):
    S = size * 4
    k = S / N

    def s(v):
        return v * k

    img = gradient(S, BG, (1, -1))                         # bottom-left dark -> top-right light
    img = Image.alpha_composite(img, radial_glow(S, s(300), s(220), s(620), 0.18))

    # soft shadow under the coin
    shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse([s(CX - R), s(CY - R + 34), s(CX + R), s(CY + R + 34)], fill=(10, 20, 40, 120))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(s(28))))

    # gold ring
    ring = gradient(S, GOLD, (1, 1))
    ring.putalpha(circle_mask(S, s(CX), s(CY), s(R)))
    img = Image.alpha_composite(img, ring)

    # coin face
    face = gradient(S, FACE, (0.15, 1))
    face.putalpha(circle_mask(S, s(CX), s(CY), s(R - RING)))
    img = Image.alpha_composite(img, face)

    # thin bevel: a light edge just inside the ring and just inside the face
    bevel = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bevel)
    bd.ellipse([s(CX - R + 12), s(CY - R + 12), s(CX + R - 12), s(CY + R - 12)], outline=(255, 244, 214, 90), width=round(s(6)))
    bd.ellipse([s(CX - R + RING), s(CY - R + RING), s(CX + R - RING), s(CY + R - RING)], outline=(0, 0, 0, 70), width=round(s(6)))
    img = Image.alpha_composite(img, bevel)

    # everything on the face is clipped to it
    clip = circle_mask(S, s(CX), s(CY), s(R - RING - 3))
    art = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ad = ImageDraw.Draw(art)

    # faint horizontal guides, like a chart
    for y in (470, 560, 650):
        ad.line([s(CX - R), s(y), s(CX + R), s(y)], fill=(255, 255, 255, 22), width=round(s(4)))

    # area under the trend line
    poly = [(s(x), s(y)) for x, y in TREND] + [(s(TREND[-1][0]), s(AREA_BOTTOM)), (s(TREND[0][0]), s(AREA_BOTTOM))]
    area_mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(area_mask).polygon(poly, fill=255)
    top_y = min(y for _, y in TREND)
    fade = np.clip(1 - (np.arange(S, dtype=float)[:, None] - s(top_y)) / (s(AREA_BOTTOM) - s(top_y)), 0, 1)
    fx0, fx1 = s(AREA_FEATHER[0]), s(AREA_FEATHER[1])
    fade_x = np.clip((fx1 - np.arange(S, dtype=float)[None, :]) / (fx1 - fx0), 0, 1)
    fade_img = Image.fromarray((fade * fade_x * 0.34 * 255).astype('uint8'), 'L')
    area = Image.new('RGBA', (S, S), (95, 211, 192, 0))
    area.putalpha(ImageChops.multiply(area_mask, fade_img))
    art = Image.alpha_composite(art, area)

    # the trend line, gradient-colored along its length
    line_mask = Image.new('L', (S, S), 0)
    ld = ImageDraw.Draw(line_mask)
    pts = [(s(x), s(y)) for x, y in TREND]
    ld.line(pts, fill=255, width=round(s(LINE_W)), joint='curve')
    for x, y in pts:
        r = s(LINE_W) / 2
        ld.ellipse([x - r, y - r, x + r, y + r], fill=255)
    line = gradient(S, TEAL, (1, -1))
    line.putalpha(line_mask)
    art = Image.alpha_composite(art, line)

    # end point: glow + white dot with a teal core
    ex, ey = TREND[-1]
    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([s(ex - 70), s(ey - 70), s(ex + 70), s(ey + 70)], fill=(120, 240, 220, 120))
    art = Image.alpha_composite(art, glow.filter(ImageFilter.GaussianBlur(s(22))))
    dd = ImageDraw.Draw(art)
    dd.ellipse([s(ex - 44), s(ey - 44), s(ex + 44), s(ey + 44)], fill=(255, 255, 255, 255))
    dd.ellipse([s(ex - 22), s(ey - 22), s(ex + 22), s(ey + 22)], fill=(72, 196, 174, 255))

    art.putalpha(ImageChops.multiply(art.getchannel('A'), clip))
    img = Image.alpha_composite(img, art)

    return img.resize((size, size), Image.LANCZOS).convert('RGB')


def rgb(c):
    return 'rgb(%d,%d,%d)' % c


def svg():
    trend = ' '.join(f'{x},{y}' for x, y in TREND)
    area = f'{trend} {TREND[-1][0]},{AREA_BOTTOM} {TREND[0][0]},{AREA_BOTTOM}'
    ex, ey = TREND[-1]
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {N} {N}">
  <defs>
    <linearGradient id="bg" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="{rgb(BG[0])}"/><stop offset=".5" stop-color="{rgb(BG[1])}"/><stop offset="1" stop-color="{rgb(BG[2])}"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{rgb(GOLD[0])}"/><stop offset=".5" stop-color="{rgb(GOLD[1])}"/><stop offset="1" stop-color="{rgb(GOLD[2])}"/>
    </linearGradient>
    <linearGradient id="face" x1=".1" y1="0" x2=".2" y2="1">
      <stop offset="0" stop-color="{rgb(FACE[0])}"/><stop offset="1" stop-color="{rgb(FACE[1])}"/>
    </linearGradient>
    <linearGradient id="line" gradientUnits="userSpaceOnUse" x1="{TREND[0][0]}" y1="{TREND[0][1]}" x2="{ex}" y2="{ey}">
      <stop offset="0" stop-color="{rgb(TEAL[0])}"/><stop offset="1" stop-color="{rgb(TEAL[1])}"/>
    </linearGradient>
    <radialGradient id="glow" cx="300" cy="220" r="620" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <filter id="blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="28"/></filter>
    <filter id="blur2" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="22"/></filter>
    <linearGradient id="area" gradientUnits="userSpaceOnUse" x1="0" y1="{min(y for _, y in TREND)}" x2="0" y2="{AREA_BOTTOM}">
      <stop offset="0" stop-color="{rgb(TEAL[0])}" stop-opacity=".34"/><stop offset="1" stop-color="{rgb(TEAL[0])}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="feather" gradientUnits="userSpaceOnUse" x1="{AREA_FEATHER[0]}" y1="0" x2="{AREA_FEATHER[1]}" y2="0">
      <stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/>
    </linearGradient>
    <mask id="areaMask" maskUnits="userSpaceOnUse" x="0" y="0" width="{N}" height="{N}"><rect width="{N}" height="{N}" fill="url(#feather)"/></mask>
    <clipPath id="clip"><circle cx="{CX}" cy="{CY}" r="{R - RING - 3}"/></clipPath>
  </defs>
  <rect width="{N}" height="{N}" fill="url(#bg)"/>
  <rect width="{N}" height="{N}" fill="url(#glow)"/>
  <circle cx="{CX}" cy="{CY + 34}" r="{R}" fill="#0a1428" fill-opacity=".47" filter="url(#blur)"/>
  <circle cx="{CX}" cy="{CY}" r="{R}" fill="url(#gold)"/>
  <circle cx="{CX}" cy="{CY}" r="{R - RING}" fill="url(#face)"/>
  <circle cx="{CX}" cy="{CY}" r="{R - 12}" fill="none" stroke="#fff4d6" stroke-opacity=".35" stroke-width="6"/>
  <circle cx="{CX}" cy="{CY}" r="{R - RING}" fill="none" stroke="#000" stroke-opacity=".27" stroke-width="6"/>
  <g clip-path="url(#clip)">
    <g stroke="#fff" stroke-opacity=".09" stroke-width="4"><path d="M{CX - R} 470H{CX + R}M{CX - R} 560H{CX + R}M{CX - R} 650H{CX + R}"/></g>
    <polygon points="{area}" fill="url(#area)" mask="url(#areaMask)"/>
    <polyline points="{trend}" fill="none" stroke="url(#line)" stroke-width="{LINE_W}" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="{ex}" cy="{ey}" r="70" fill="#78f0dc" fill-opacity=".47" filter="url(#blur2)"/>
    <circle cx="{ex}" cy="{ey}" r="44" fill="#fff"/>
    <circle cx="{ex}" cy="{ey}" r="22" fill="rgb(72,196,174)"/>
  </g>
</svg>
"""


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, size in [('apple-touch-icon.png', 180), ('icon-192.png', 192), ('icon-512.png', 512), ('favicon-32.png', 32)]:
        draw(size).save(os.path.join(OUT, name))
        print('wrote', name)
    with open(os.path.join(OUT, 'icon.svg'), 'w', encoding='utf-8') as f:
        f.write(svg())
    print('wrote icon.svg')
