"""
UIDrop icon generator — smooth teardrop, fully padded, purple→blue gradient.
"""
from PIL import Image, ImageDraw, ImageFilter
import os

def lerp_color(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))

def gradient_color(stops, t):
    t = max(0.0, min(1.0, t))
    for i in range(len(stops) - 1):
        p0, c0 = stops[i]
        p1, c1 = stops[i + 1]
        if p0 <= t <= p1:
            local_t = (t - p0) / (p1 - p0)
            return lerp_color(c0, c1, local_t)
    return stops[-1][1]

def cubic_bezier(p0, p1, p2, p3, steps=80):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        x = u**3*p0[0] + 3*u**2*t*p1[0] + 3*u*t**2*p2[0] + t**3*p3[0]
        y = u**3*p0[1] + 3*u**2*t*p1[1] + 3*u*t**2*p2[1] + t**3*p3[1]
        pts.append((x, y))
    return pts

def point_in_polygon(x, y, polygon):
    """Ray-casting polygon test."""
    n = len(polygon)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside

def draw_drop_icon(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))

    # Dark background
    bg_layer = Image.new('RGBA', (size, size), (13, 13, 20, 255))
    img = Image.alpha_composite(img, bg_layer)

    # Drop geometry — generous padding so bottom is always fully inside
    pad    = size * 0.12
    cx     = size / 2
    top_y  = pad * 1.1          # sharp top point
    bot_y  = size - pad * 1.3   # rounded bottom — clear of edge
    half_w = (size - pad * 2.2) * 0.44
    wide_y = top_y + (bot_y - top_y) * 0.64

    # Teardrop path: tight near the top for a sharp point,
    # sweeps into a full semicircle at the bottom.
    seg1 = cubic_bezier(   # top-point → right widest
        (cx,           top_y),
        (cx + half_w * 0.45, top_y + (wide_y - top_y) * 0.22),  # tight control near tip
        (cx + half_w,  wide_y - half_w * 0.08),
        (cx + half_w,  wide_y)
    )
    # For a smooth elliptical bottom, control points use the 0.5523 bezier
    # circle approximation constant — tangent at wide_y is vertical,
    # tangent at bot_y is horizontal, so the join is perfectly C1 continuous.
    k = 0.5523
    h = bot_y - wide_y  # vertical drop from widest point to bottom

    seg2 = cubic_bezier(   # right widest → bottom centre
        (cx + half_w,  wide_y),
        (cx + half_w,  wide_y + h * k),        # tangent points straight down
        (cx + half_w * k, bot_y),              # tangent points straight left
        (cx,           bot_y)
    )
    seg3 = cubic_bezier(   # bottom centre → left widest
        (cx,           bot_y),
        (cx - half_w * k, bot_y),              # tangent points straight left
        (cx - half_w,  wide_y + h * k),        # tangent points straight up
        (cx - half_w,  wide_y)
    )
    seg4 = cubic_bezier(   # left widest → top-point
        (cx - half_w,  wide_y),
        (cx - half_w,  wide_y - half_w * 0.08),
        (cx - half_w * 0.45, top_y + (wide_y - top_y) * 0.22),
        (cx,           top_y)
    )

    polygon = seg1 + seg2 + seg3 + seg4
    int_poly = [(int(x), int(y)) for x, y in polygon]

    # Bounding box
    xs = [p[0] for p in polygon]
    ys = [p[1] for p in polygon]
    bx0, bx1 = int(min(xs)), int(max(xs))
    by0, by1 = int(min(ys)), int(max(ys))

    # Gradient stops — top-left lilac/pink → bottom-right sky blue
    stops = [
        (0.00, (220, 150, 255)),  # lilac-pink
        (0.28, (180, 120, 252)),  # light purple
        (0.58, (130, 110, 248)),  # indigo
        (1.00, ( 90, 160, 250)),  # sky blue
    ]

    # Render gradient layer (only inside polygon bbox)
    grad_layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    pix = grad_layer.load()
    for y in range(by0, by1 + 1):
        for x in range(bx0, bx1 + 1):
            if point_in_polygon(x + 0.5, y + 0.5, polygon):
                t = ((x - bx0) / max(bx1 - bx0, 1) * 0.4 +
                     (y - by0) / max(by1 - by0, 1) * 0.6)
                r, g, b = gradient_color(stops, t)
                pix[x, y] = (r, g, b, 255)

    img = Image.alpha_composite(img, grad_layer)

    # Shine: soft white highlight clipped to drop polygon, upper-left area
    shine_layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    shine_pix   = shine_layer.load()
    # Shine centre: upper-left quadrant of the drop
    sc_x = cx - half_w * 0.22
    sc_y = top_y + (wide_y - top_y) * 0.25
    sr   = half_w * 0.65  # radius of shine falloff

    for y in range(by0, by1 + 1):
        for x in range(bx0, bx1 + 1):
            if point_in_polygon(x + 0.5, y + 0.5, polygon):
                d = ((x - sc_x)**2 + (y - sc_y)**2) ** 0.5
                t = max(0.0, 1.0 - d / sr)
                alpha = int(t * t * 42)   # max ~42/255 ≈ 16% white
                if alpha > 0:
                    shine_pix[x, y] = (255, 255, 255, alpha)

    img = Image.alpha_composite(img, shine_layer)
    return img

sizes = [512, 128, 48, 16]
out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icons')
os.makedirs(out_dir, exist_ok=True)

for s in sizes:
    icon = draw_drop_icon(s)
    # Flatten to RGB on dark bg
    bg = Image.new('RGB', (s, s), (13, 13, 20))
    bg.paste(icon.convert('RGB'), (0, 0))
    path = os.path.join(out_dir, f'icon{s}.png')
    bg.save(path, 'PNG')
    print(f'Saved {path}')

print('Done!')
