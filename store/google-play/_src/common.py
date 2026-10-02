"""Shared design pieces for the Google Play banners: Inter, the real app logo, real
Material icons (chips / eyebrows), theme tokens and the Android handset frame that
the real emulator screenshots are placed into."""
import base64, os, json

HERE = os.path.dirname(os.path.abspath(__file__))
FONTDIR = os.path.join(HERE, "fonts")

# ---------------- Fonts (Inter, latin + cyrillic) ----------------
def _font_face():
    faces = []
    for sub in ("latin", "cyrillic"):
        rng = ("U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,"
               "U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,"
               "U+2212,U+2215,U+FEFF,U+FFFD") if sub == "latin" else \
              ("U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116")
        for w in (400, 500, 600, 700, 800, 900):
            p = os.path.join(FONTDIR, f"{sub}-{w}-normal.woff2")
            b = base64.b64encode(open(p, "rb").read()).decode()
            faces.append(f"@font-face{{font-family:'Inter';font-style:normal;font-weight:{w};"
                         f"font-display:block;src:url(data:font/woff2;base64,{b}) format('woff2');"
                         f"unicode-range:{rng};}}")
    return "\n".join(faces)

FONT_FACE = _font_face()

# ---------------- Real theme tokens (src/theme/colors.ts) ----------------
BG        = "#F8F9FA"   # background
BG2       = "#E9ECEF"   # backgroundSecondary
SURFACE   = "#FFFFFF"
INK       = "#1A1A1A"   # text
INK2      = "#6C757D"   # textSecondary
INK3      = "#ADB5BD"   # textTertiary
MUTED     = "#CED4DA"   # textMuted
PRIMARY   = "#0066FF"
PRIMARYD  = "#0052CC"
GREEN     = "#10B981"   # accentGreen
PURPLE    = "#8B5CF6"   # accentPurple
YELLOW    = "#FFC107"
ORANGE    = "#F59E0B"   # warning
RED       = "#DC3545"   # error
BORDER    = "#DEE2E6"

# page-level marketing tokens
CANVAS    = "#F5F7FA"
HEAD_INK  = "#0E1116"

# ---------------- Real logo (extracted from assets/icon.png, pure black) ----------------
_LOGO_B64 = base64.b64encode(open(os.path.join(HERE, "logo_black.png"), "rb").read()).decode()
# intrinsic size 1499 x 2208 -> ratio w/h
_LOGO_RATIO = 1499 / 2208
def logo(h, color=None):
    """Real app logo at pixel height h. color!=None tints it (via filter) else natural black."""
    w = round(h * _LOGO_RATIO, 1)
    filt = ""
    if color == "white":
        filt = "filter:brightness(0) invert(1);"
    return (f'<img src="data:image/png;base64,{_LOGO_B64}" alt="Vaulto Note" '
            f'style="height:{h}px;width:{w}px;display:block;{filt}">')

def wordmark(size=30, color=INK, sub=PRIMARY):
    return (f'<span style="font-weight:800;font-size:{size}px;letter-spacing:-.03em;color:{color}">'
            f'Vaulto<span style="color:{sub}"> Note</span></span>')

# ---------------- Real Material icons (exact SVG paths from the app's icon sets) ----------------
_ICONS = json.load(open(os.path.join(HERE, "icons.json")))
def ic(name, size=24, color=INK, cls="mi"):
    key = f"{cls}_{name}"
    inner = _ICONS.get(key)
    if inner is None:
        raise KeyError(f"icon not found: {key}")
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="{color}" '
            f'style="display:block;flex:none">{inner}</svg>')

# ---------------- Phone geometry (Android / Pixel-class, not iPhone) ----------------
# 412x915 dp viewport; a 1080x2400 capture scales into it exactly (20:9).
SCREEN_W = 412
SCREEN_H = 915

def base_css():
    return FONT_FACE + f"""
*{{margin:0;padding:0;box-sizing:border-box}}
html,body{{font-family:'Inter',sans-serif;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;background:{CANVAS}}}
img{{-webkit-user-drag:none}}
.stage{{position:relative;overflow:hidden;background:{CANVAS}}}
.glow{{position:absolute;border-radius:50%;pointer-events:none}}

/* device — Android hardware: flat-ish corners, centre punch-hole */
.phone{{position:relative;width:{SCREEN_W+24}px;height:{SCREEN_H+24}px;background:#0B0D10;border-radius:50px;padding:12px;
  box-shadow:0 2px 5px rgba(11,13,16,.10),0 50px 90px -28px rgba(14,32,74,.34),0 16px 34px -14px rgba(11,13,16,.22);}}
.screen{{position:relative;width:{SCREEN_W}px;height:{SCREEN_H}px;background:{BG};border-radius:39px;overflow:hidden}}
.punch{{position:absolute;top:13px;left:50%;transform:translateX(-50%);width:12px;height:12px;background:#0B0D10;border-radius:50%;z-index:50}}
.row{{display:flex;align-items:center}}
"""
