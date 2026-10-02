"""Builds the Google Play banner HTML: marketing copy + a REAL emulator screenshot
(raw/<lang>/<key>.png, 1080x2400) inside an Android handset frame.

    python3 build.py   # writes html/*.html, then run: bash render.sh
"""
import os
from common import (base_css, logo, wordmark, ic, INK2, PRIMARY, GREEN, PURPLE,
                    BORDER, SURFACE, HEAD_INK)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "html"); os.makedirs(OUT, exist_ok=True)
RAW = os.path.join(HERE, "raw")

# ---------------- banner marketing copy (funnel order) ----------------
# (raw screenshot key, accent, (icon set, icon), eyebrow, [title lines], sub)
BANNERS = {
 "en": [
  ("01_record",    PRIMARY, ("mi", "mic"),               "VOICE TO TEXT",     ["Speak.", "It's text."],
     "Talk, and your words become clean, editable text in seconds."),
  ("02_offline",   GREEN,   ("mc", "cloud_off_outline"), "WORKS OFFLINE",     ["Works in", "airplane mode."],
     "Download the models once: speech recognition and AI then run right on your phone."),
  ("03_ask",       PURPLE,  ("mi", "auto_awesome"),      "ASK YOUR NOTES",    ["Ask your", "notes."],
     "Get answers from your own notes, with numbered sources you can open."),
  ("04_tasks",     PRIMARY, ("mi", "check_box"),         "TASKS & REMINDERS", ["Tasks from", "your voice."],
     "AI finds the to-dos and dates in a note. One tap sets a reminder."),
  ("05_meeting",   PURPLE,  ("mi", "auto_awesome"),      "MEETING NOTES",     ["Meetings,", "summed up."],
     "A summary, key points and action items from a meeting transcript."),
  ("06_private",   GREEN,   ("mi", "lock"),              "PRIVATE BY DESIGN", ["Your notes.", "Yours alone."],
     "Notes are stored encrypted. Protected notes never leave your phone unencrypted."),
  ("07_organized", PRIMARY, ("mi", "search"),            "ALL YOUR NOTES",    ["Everything", "in one place."],
     "Voice notes, checklists and #tags, in a light or dark theme."),
  ("08_widget",    PRIMARY, ("mi", "smartphone"),        "CAPTURE ANYWHERE",  ["Capture", "from anywhere."],
     "Record straight from the home-screen widget or the Quick Settings tile."),
 ],
 "ru": [
  ("01_record",    PRIMARY, ("mi", "mic"),               "ГОЛОС В ТЕКСТ",          ["Говорите.", "Текст готов."],
     "Скажите мысль вслух и получите чистый текст, готовый к правке."),
  ("02_offline",   GREEN,   ("mc", "cloud_off_outline"), "БЕЗ ИНТЕРНЕТА",          ["Работает", "в авиарежиме."],
     "Скачайте модели один раз: распознавание речи и ИИ работают прямо на телефоне."),
  ("03_ask",       PURPLE,  ("mi", "auto_awesome"),      "ВОПРОСЫ ПО ЗАМЕТКАМ",    ["Спросите", "свои заметки."],
     "Ответы из ваших же заметок, с пронумерованными источниками."),
  ("04_tasks",     PRIMARY, ("mi", "check_box"),         "ЗАДАЧИ И НАПОМИНАНИЯ",   ["Задачи", "из голоса."],
     "ИИ находит дела и сроки в заметке. Напоминание ставится одним касанием."),
  ("05_meeting",   PURPLE,  ("mi", "auto_awesome"),      "ИТОГИ ВСТРЕЧ",           ["Встречи —", "в итогах."],
     "Краткое содержание, ключевые пункты и задачи из расшифровки встречи."),
  ("06_private",   GREEN,   ("mi", "lock"),              "ПРИВАТНОСТЬ В ОСНОВЕ",   ["Ваши заметки.", "Только ваши."],
     "Заметки хранятся зашифрованными. Защищённые не покидают телефон в открытом виде."),
  ("07_organized", PRIMARY, ("mi", "search"),            "ВСЕ ЗАМЕТКИ",            ["Всё нужное", "в одном месте."],
     "Голосовые заметки, чек-листы и #теги, в светлой или тёмной теме."),
  ("08_widget",    PRIMARY, ("mi", "smartphone"),        "ЗАПИСЬ ОТОВСЮДУ",        ["Записывайте", "откуда угодно."],
     "Запись прямо с виджета на главном экране или из быстрых настроек."),
 ],
}

# Feature graphic: (title lines, sub, chips [(icon set, icon, label)], raw screenshot key)
FG = {
 "en": (["Private AI", "voice notes."],
        "Speak, get clean text, ask your notes. Works offline, stored encrypted.",
        [("mi", "mic", "Voice → text"), ("mc", "cloud_off_outline", "Works offline"), ("mi", "lock", "Encrypted")],
        "01_record"),
 "ru": (["Голос в текст.", "Приватный ИИ."],
        "Говорите, получайте текст, спрашивайте заметки. Без интернета, с шифрованием.",
        [("mi", "mic", "Голос в текст"), ("mc", "cloud_off_outline", "Без интернета"), ("mi", "lock", "Шифрование")],
        "01_record"),
}

def rgba(hexc, a):
    h = hexc.lstrip("#"); r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return f"rgba({r},{g},{b},{a})"

def page(w, h, body):
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
{base_css()}
body{{width:{w}px;height:{h}px}}
</style></head><body>{body}</body></html>"""

def raw_src(lang, key):
    path = os.path.join(RAW, lang, f"{key}.png")
    if not os.path.exists(path):
        raise FileNotFoundError(f"missing raw capture: {path}")
    return os.path.relpath(path, OUT)

def phone(lang, key):
    """Android handset with the real 1080x2400 capture as its screen. The capture
    already has the real status bar and gesture handle, so nothing is drawn on top
    except the camera punch-hole."""
    return (f'<div class="phone"><div class="punch"></div><div class="screen">'
            f'<img src="{raw_src(lang, key)}" style="width:100%;height:100%;object-fit:cover;display:block">'
            f'</div></div>')

# ---------------- 1080x1920 banner ----------------
def build_banner(lang, spec):
    key, accent, (icls, iname), eyebrow, title, sub = spec
    body = f"""
<div class="stage" style="width:1080px;height:1920px">
  <div class="glow" style="width:880px;height:880px;top:-300px;right:-240px;background:radial-gradient(circle,{rgba(accent,.15)},transparent 66%)"></div>
  <div class="glow" style="width:820px;height:820px;bottom:-360px;left:-300px;background:radial-gradient(circle,{rgba(accent,.09)},transparent 68%)"></div>

  <div style="position:absolute;top:70px;left:84px;display:flex;align-items:center;gap:13px">
    {logo(40)}{wordmark(29)}
  </div>

  <div style="position:absolute;top:166px;left:84px;right:84px">
    <span style="display:inline-flex;align-items:center;gap:9px;background:{rgba(accent,.12)};color:{accent};padding:11px 18px;border-radius:100px;font-size:22px;font-weight:800;letter-spacing:.13em">{ic(iname,20,accent,icls)}{eyebrow}</span>
    <div style="font-weight:800;font-size:96px;line-height:1.0;letter-spacing:-.045em;color:{HEAD_INK};margin-top:24px">
      {title[0]}<br><span style="color:{accent}">{title[1]}</span></div>
    <div style="font-weight:500;font-size:31px;line-height:1.4;color:{INK2};margin-top:22px;max-width:900px">{sub}</div>
  </div>

  <div style="position:absolute;top:618px;left:50%;transform:translateX(-50%) scale(1.3);transform-origin:top center">
    {phone(lang, key)}
  </div>
</div>"""
    fn = os.path.join(OUT, f"{lang}_{key}.html")
    open(fn, "w").write(page(1080, 1920, body))
    return fn

# ---------------- 1024x500 feature graphic ----------------
def build_feature(lang):
    title, sub, chips, key = FG[lang]
    chip_html = ""
    for icls, nm, tx in chips:
        col = GREEN if nm in ("lock", "cloud_off_outline") else PRIMARY
        chip_html += (f'<span style="display:inline-flex;align-items:center;gap:8px;background:{SURFACE};'
                      f'border:1px solid {BORDER};color:{HEAD_INK};padding:9px 15px;border-radius:100px;'
                      f'font-size:18px;font-weight:700;margin-right:11px;vertical-align:middle;'
                      f'box-shadow:0 8px 20px -14px rgba(14,32,74,.3)">{ic(nm,18,col,icls)}{tx}</span>')
    body = f"""
<div class="stage" style="width:1024px;height:500px">
  <div class="glow" style="width:620px;height:620px;top:-250px;right:10px;background:radial-gradient(circle,{rgba(PRIMARY,.14)},transparent 66%)"></div>
  <div class="glow" style="width:520px;height:520px;bottom:-300px;left:-160px;background:radial-gradient(circle,{rgba(GREEN,.10)},transparent 68%)"></div>

  <!-- Play re-crops the feature graphic (16:9 .. 4:3) in collections, charts and
       search, so all type stays inside the intersection of both documented safe
       zones: x 82..942, y 50..450. Only the phone is allowed to bleed off-edge. -->
  <div style="position:absolute;top:56px;left:92px;width:560px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">{logo(40)}{wordmark(30)}</div>
    <div style="font-weight:800;font-size:56px;line-height:1.0;letter-spacing:-.045em;color:{HEAD_INK}">
      {title[0]}<br><span style="color:{PRIMARY}">{title[1]}</span></div>
    <div style="font-weight:500;font-size:22px;line-height:1.38;color:{INK2};margin-top:20px;max-width:520px">{sub}</div>
    <div style="margin-top:30px;line-height:0;white-space:nowrap">{chip_html}</div>
  </div>

  <div style="position:absolute;right:-30px;top:56px;transform:rotate(-6deg) scale(.70);transform-origin:top right">
    <div style="filter:drop-shadow(0 40px 70px rgba(14,32,74,.34))">{phone(lang, key)}</div>
  </div>
</div>"""
    fn = os.path.join(OUT, f"{lang}_feature.html")
    open(fn, "w").write(page(1024, 500, body))
    return fn

if __name__ == "__main__":
    for old in os.listdir(OUT):
        if old.endswith(".html"):
            os.remove(os.path.join(OUT, old))
    files = []
    for lang in ("en", "ru"):
        files.append(build_feature(lang))
        for spec in BANNERS[lang]:
            files.append(build_banner(lang, spec))
    print("\n".join(os.path.basename(f) for f in files))
    print(f"{len(files)} files")
