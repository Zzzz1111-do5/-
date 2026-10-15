#!/usr/bin/env python3
"""Generate the launcher icons for the Android shell (needs Pillow).

    python3 android/make_icons.py

Writes into android/res/:
  mipmap-<dpi>/ic_launcher.png         legacy square-ish icon (rounded tile)
  mipmap-<dpi>/ic_launcher_round.png   legacy round icon
  mipmap-<dpi>/ic_launcher_fg.png      adaptive-icon foreground (108dp canvas)
  mipmap-<dpi>/ic_launcher_mono.png    themed-icon (Android 13+) silhouette
The adaptive icon XML (mipmap-anydpi-v26) and the background colour
(values/colors.xml) are hand-written and not touched here.

Art: a blue planet with a thin tilted ring on a dark-navy background.
Everything is drawn at 4x and downsampled for clean anti-aliasing.
"""
import math
import os

from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "res")

DENSITIES = {"mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0}
SS = 4  # supersampling factor
TILT = -22  # ring tilt in degrees (counter-clockwise in PIL terms is positive)

NAVY_TOP = (16, 30, 64)
NAVY_BOT = (6, 10, 20)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(len(a)))


def navy_background(size):
    """Dark navy radial-ish gradient with a few faint stars."""
    img = Image.new("RGBA", (size, size), NAVY_BOT + (255,))
    px = img.load()
    cx, cy = size * 0.38, size * 0.30
    rmax = size * 1.05
    for y in range(size):
        for x in range(size):
            d = math.hypot(x - cx, y - cy) / rmax
            t = min(1.0, d)
            px[x, y] = lerp(NAVY_TOP, NAVY_BOT, t) + (255,)
    d = ImageDraw.Draw(img)
    stars = [(0.16, 0.20, 0.010), (0.82, 0.16, 0.008), (0.88, 0.42, 0.008),
             (0.12, 0.78, 0.007), (0.70, 0.88, 0.006), (0.30, 0.10, 0.006)]
    for sx, sy, sr in stars:
        r = max(1.0, sr * size)
        d.ellipse([sx * size - r, sy * size - r, sx * size + r, sy * size + r],
                  fill=(200, 220, 255, 170))
    return img


def planet_layer(size, pr, ring_a, ring_b, ring_w, mono=False):
    """Planet + ring on a transparent layer, centred, ring un-tilted (tilt applied after)."""
    c = size / 2.0
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    # Ring mask (full ellipse outline), faded slightly towards the far (upper) side.
    ring = Image.new("L", (size, size), 0)
    rd = ImageDraw.Draw(ring)
    rd.ellipse([c - ring_a, c - ring_b, c + ring_a, c + ring_b], outline=255, width=max(1, int(ring_w)))
    lo, hi_ = c - ring_b, c + ring_b
    fade = Image.new("L", (size, size), 0)
    fd = ImageDraw.Draw(fade)
    for y in range(size):
        t = min(1.0, max(0.0, (y - lo) / max(1.0, hi_ - lo)))
        fd.line([(0, y), (size, y)], fill=int(255 * (0.62 + 0.38 * t)))
    ring_faded = ImageChops.multiply(ring, fade)

    ring_col = (255, 255, 255, 255) if mono else (186, 222, 255, 255)
    clear = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    def paste_ring(mask):
        solid = Image.new("RGBA", (size, size), ring_col)
        layer.alpha_composite(Image.composite(solid, clear, mask))

    # The whole ring goes behind the planet; afterwards only the near half that
    # crosses the planet disc is drawn again on top, so there is no seam outside it.
    paste_ring(ring_faded)
    near = ring_faded.copy()
    ImageDraw.Draw(near).rectangle([0, 0, size, int(c)], fill=0)
    over = Image.new("L", (size, size), 0)
    ImageDraw.Draw(over).ellipse([c - pr * 1.08, c - pr * 1.08, c + pr * 1.08, c + pr * 1.08], fill=255)
    over = over.filter(ImageFilter.GaussianBlur(pr * 0.03))
    front = ImageChops.multiply(near, over)

    # Planet disc.
    disc = Image.new("L", (size, size), 0)
    ImageDraw.Draw(disc).ellipse([c - pr, c - pr, c + pr, c + pr], fill=255)

    if mono:
        body = Image.new("RGBA", (size, size), (255, 255, 255, 255))
        # Cut a gap around the front ring so the silhouette still reads as "ringed".
        g = ring_w * 0.9
        gap = Image.new("L", (size, size), 0)
        ImageDraw.Draw(gap).ellipse([c - ring_a - g, c - ring_b - g, c + ring_a + g, c + ring_b + g],
                                    outline=255, width=max(1, int(ring_w + 2 * g)))
        ImageDraw.Draw(gap).rectangle([0, 0, size, int(c)], fill=0)
        disc = ImageChops.subtract(disc, gap)
        layer.alpha_composite(Image.composite(body, Image.new("RGBA", (size, size), (0, 0, 0, 0)), disc))
        paste_ring(front)
        return layer

    # Shaded ocean sphere: light from the upper-left (in the final, tilted frame).
    sphere = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sp = sphere.load()
    ang = math.radians(-TILT)  # pre-rotate the light so it lands upper-left after tilting
    lx, ly = -0.55, -0.62
    lx, ly = lx * math.cos(ang) - ly * math.sin(ang), lx * math.sin(ang) + ly * math.cos(ang)
    lz = math.sqrt(max(0.0, 1 - lx * lx - ly * ly))
    deep, mid, hi = (14, 58, 140), (40, 132, 222), (150, 214, 255)
    x0, x1 = int(c - pr) - 1, int(c + pr) + 2
    for y in range(x0, x1):
        for x in range(x0, x1):
            nx, ny = (x + 0.5 - c) / pr, (y + 0.5 - c) / pr
            rr = nx * nx + ny * ny
            if rr > 1.0:
                continue
            nz = math.sqrt(1 - rr)
            lam = max(0.0, nx * lx + ny * ly + nz * lz)
            col = lerp(deep, mid, min(1.0, lam * 1.25)) if lam < 0.8 else lerp(mid, hi, (lam - 0.8) / 0.2)
            sp[x, y] = col + (255,)

    # A few soft "continents".
    land = Image.new("L", (size, size), 0)
    ld = ImageDraw.Draw(land)
    blobs = [(-0.35, -0.20, 0.34, 0.24), (0.05, -0.42, 0.22, 0.14), (0.30, 0.18, 0.30, 0.22),
             (-0.10, 0.45, 0.20, 0.12), (-0.55, 0.30, 0.14, 0.12)]
    for bx, by, bw, bh in blobs:
        ld.ellipse([c + (bx - bw) * pr, c + (by - bh) * pr, c + (bx + bw) * pr, c + (by + bh) * pr], fill=255)
    land = land.filter(ImageFilter.GaussianBlur(pr * 0.04))
    land = land.point(lambda v: 255 if v > 120 else 0).filter(ImageFilter.GaussianBlur(pr * 0.015))
    land = ImageChops.multiply(land, disc)
    green = Image.new("RGBA", (size, size), (104, 196, 128, 255))
    # Shade land with the sphere luminance so it sits on the globe.
    lum = sphere.convert("L").point(lambda v: min(255, int(v * 1.35)))
    green = ImageChops.multiply(green, Image.merge("RGBA", (lum, lum, lum, Image.new("L", (size, size), 255))))
    sphere = Image.composite(green, sphere, land)

    # Atmosphere rim.
    rim = Image.new("L", (size, size), 0)
    ImageDraw.Draw(rim).ellipse([c - pr, c - pr, c + pr, c + pr], outline=255, width=max(1, int(pr * 0.06)))
    rim = rim.filter(ImageFilter.GaussianBlur(pr * 0.03))
    rim = ImageChops.multiply(rim, disc)
    glow = Image.new("RGBA", (size, size), (170, 225, 255, 255))
    sphere = Image.composite(glow, sphere, rim.point(lambda v: int(v * 0.55)))

    sphere.putalpha(disc)
    layer.alpha_composite(sphere)
    paste_ring(front)
    return layer


def render_art(size, scale, mono=False):
    """Planet art (transparent) where the planet radius etc. are fractions of `scale`."""
    pr = 0.26 * scale
    ring_a, ring_b = 0.47 * scale, 0.115 * scale
    ring_w = 0.028 * scale
    art = planet_layer(size, pr, ring_a, ring_b, ring_w, mono=mono)
    return art.rotate(TILT, resample=Image.BICUBIC, center=(size / 2.0, size / 2.0))


def rounded_mask(size, radius_frac):
    m = Image.new("L", (size, size), 0)
    r = int(size * radius_frac)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=255)
    return m


def circle_mask(size):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).ellipse([0, 0, size - 1, size - 1], fill=255)
    return m


def save(img, size, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.resize((size, size), Image.LANCZOS).save(path, optimize=True)


def main():
    for dpi, f in DENSITIES.items():
        out = os.path.join(RES, "mipmap-" + dpi)

        # Legacy icons: 48dp, art fills most of the tile (small inset margin).
        n = int(round(48 * f))
        big = n * SS
        margin = int(big * 0.04)
        inner = big - 2 * margin
        tile = navy_background(inner)
        tile.alpha_composite(render_art(inner, inner * 0.98))
        sq = Image.new("RGBA", (big, big), (0, 0, 0, 0))
        sq.paste(tile, (margin, margin), rounded_mask(inner, 0.2))
        save(sq, n, os.path.join(out, "ic_launcher.png"))
        rd = Image.new("RGBA", (big, big), (0, 0, 0, 0))
        rd.paste(tile, (margin, margin), circle_mask(inner))
        save(rd, n, os.path.join(out, "ic_launcher_round.png"))

        # Adaptive foreground: 108dp canvas, keep art inside the 66dp safe circle.
        n = int(round(108 * f))
        big = n * SS
        save(render_art(big, big * (66 / 108.0)), n, os.path.join(out, "ic_launcher_fg.png"))
        save(render_art(big, big * (60 / 108.0), mono=True), n, os.path.join(out, "ic_launcher_mono.png"))
        print("icons:", dpi)


if __name__ == "__main__":
    main()
