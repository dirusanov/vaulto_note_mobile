import os
from common import (base_css, logo, wordmark, ic, navbar, BG, BG2, INK, INK2, INK3,
                    MUTED, PRIMARY, PRIMARYD, GREEN, PURPLE, YELLOW, BORDER, SURFACE,
                    CANVAS, HEAD_INK, SCREEN_W, SCREEN_H)
from screens import SCREENS, SCREEN_CSS

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "html"); os.makedirs(OUT, exist_ok=True)

# ---------------- localized screen content ----------------
SL = {
 "en": dict(
   now="now", mon_apr="Apr", d_mon="Mon", d_2h="2h", hold="Hold to switch",
   search_ph="Search notes...",
   n1t="Team sync", n1s="Move standup to 10 and try the new voice flow for quick capture",
   n2t="Groceries", n2s="Oat milk, eggs, spinach, coffee beans, dark chocolate",
   n3t="Book notes", n3s="Deep work — protect the first two hours of the morning",
   n4t="Voice note", n4s="",
   n5t="Trip plan", n5s="Kyoto in spring, book the ryokan early, temple shortlist",
   n6t="Ideas", n6s="A calm, private place for every fleeting thought",
   n7t="Meeting recap", n7s="Ship the beta next week; assign design and eng tasks",
   n8t="Workout", n8s="Push day — chest, shoulders and triceps, 45 minutes",
   n9t="Reading list", n9s="Essays on focus, a novel, and two design books",
   n10t="Standup", n10s="Blockers, demo prep, and the release checklist",
   n11t="Recipes", n11s="Slow-roast tomatoes, then the lemon pasta from Sunday",
   n12t="Podcast idea", n12s="Short episodes about focus and quiet software",
   transcribe_on="Transcribe ON", agent_on="AI Agent ON",
   ed_ttl="Product notes", ed_meta="Apr 12 · 142 words", original="Original", ed_variant="Summary",
   ed_h="Launch checklist", ed_p1="Keep the voice-first flow front and center and the interface calm.",
   ed_c1="Draft the pitch", ed_c2="Record walkthrough", ed_c3="Share with the team",
   ed_p2a="Our one rule:", ed_hl="privacy first", ed_p2b="always.",
   ed_h2="Notes from the call",
   ed_p3="Recorded the whole thing and let the transcript do the note-taking.",
   ed_c4="Trim the onboarding copy", ed_c5="Re-check the sync banner",
   ed_p4="Everything above stays encrypted on the device before it syncs.",
   ai_behind="The team discussed timelines and agreed to ship the beta next week. Action items were assigned across design and engineering.",
   improve_ttl="Improve Text with AI", create="Create", custom_instr="Custom Instruction",
   ai_example="Make it shorter and add a to-do list", apply_instr="Apply Instruction",
   ai_o1="Fix Grammar", ai_o1p="Check grammar and spelling",
   ai_o2="Make Professional", ai_o2p="Rewrite in a business style",
   ai_o3="Simplify Text", ai_o3p="Use simple, clear words",
   ai_o4="Summarize", ai_o4p="Highlight the key points",
   pv_ttl="Unlock encrypted notes",
   pv_sub="Encrypted notes are on the server. Enter your passphrase to show them on this device.",
   pv_label="Passphrase", pv_show="Show passphrase",
   pv_hint="Your passphrase is checked on this device.",
   cancel="Cancel", unlock="Unlock", pv_recovery="Use Recovery Code", pv_forgot="Forgot passphrase? Reset",
   settings="Settings",
   st_lang="App Language", st_lang_sub="English",
   st_signout="Sign Out", st_privacy="Privacy Policy", st_terms="Terms of Service",
   st_sync="Cloud Sync", st_synced="Sync", st_on="On",
   st_recovery="Export Recovery Code", st_copy="Copy",
   st_disable="Disable Encryption", st_disable_btn="Disable",
   st_ai="AI Model",
   st_agent="Agent Mode", st_agent_sub="Intelligent assistance",
   st_trans="Auto-Transcribe Audio", st_trans_sub="Automatic voice transcription",
   st_adv="Advanced AI Settings", st_adv_sub="Custom AI configuration"),
 "ru": dict(
   now="сейчас", mon_apr="апр", d_mon="Пн", d_2h="2 ч", hold="Удерживайте для смены",
   search_ph="Поиск заметок...",
   n1t="Созвон", n1s="Перенести стендап на 10 и попробовать голосовой ввод для быстрых заметок",
   n2t="Покупки", n2s="Овсяное молоко, яйца, шпинат, кофе, тёмный шоколад",
   n3t="О книге", n3s="Глубокая работа — беречь первые два часа утра",
   n4t="Голосовая", n4s="",
   n5t="План поездки", n5s="Киото весной, забронировать рёкан заранее, список храмов",
   n6t="Идеи", n6s="Спокойное приватное место для каждой мысли",
   n7t="Итоги встречи", n7s="Выпустить бету; распределить задачи по дизайну и разработке",
   n8t="Тренировка", n8s="День жимов — грудь, плечи и трицепс, 45 минут",
   n9t="Список чтения", n9s="Эссе о фокусе, роман и две книги по дизайну",
   n10t="Стендап", n10s="Блокеры, подготовка демо и чек-лист релиза",
   n11t="Рецепты", n11s="Томаты медленного запекания и паста с лимоном",
   n12t="Идея подкаста", n12s="Короткие выпуски о фокусе и спокойном софте",
   transcribe_on="Транскрипция", agent_on="AI-агент",
   ed_ttl="Заметки по продукту", ed_meta="12 апр · 142 слова", original="Оригинал", ed_variant="Пересказ",
   ed_h="Чек-лист запуска", ed_p1="Держать голосовой сценарий в центре и сохранять спокойный интерфейс.",
   ed_c1="Набросать питч", ed_c2="Записать демо", ed_c3="Показать команде",
   ed_p2a="Одно правило:", ed_hl="сначала приватность", ed_p2b="всегда.",
   ed_h2="Заметки со встречи",
   ed_p3="Записали разговор голосом — расшифровка сделала конспект сама.",
   ed_c4="Сократить тексты онбординга", ed_c5="Перепроверить баннер синхронизации",
   ed_p4="Всё, что выше, шифруется на устройстве ещё до отправки в облако.",
   ai_behind="Команда обсудила сроки и договорилась выпустить бету на следующей неделе. Задачи распределены между дизайном и разработкой.",
   improve_ttl="Улучшить текст с AI", create="Создать", custom_instr="Своя инструкция",
   ai_example="Сделай короче и добавь список задач", apply_instr="Применить инструкцию",
   ai_o1="Исправить грамматику", ai_o1p="Проверить грамматику и орфографию",
   ai_o2="Сделать деловым", ai_o2p="Переписать в деловом стиле",
   ai_o3="Упростить текст", ai_o3p="Простые, понятные слова",
   ai_o4="Кратко изложить", ai_o4p="Выделить главные мысли",
   pv_ttl="Разблокировать заметки",
   pv_sub="Зашифрованные заметки на сервере. Введите секретную фразу, чтобы показать их на устройстве.",
   pv_label="Секретная фраза", pv_show="Показать",
   pv_hint="Секретная фраза проверяется на этом устройстве.",
   cancel="Отмена", unlock="Разблокировать", pv_recovery="Код восстановления", pv_forgot="Забыли пароль? Сброс",
   settings="Настройки",
   st_lang="Язык приложения", st_lang_sub="Русский",
   st_signout="Выйти", st_privacy="Политика конфиденциальности", st_terms="Условия",
   st_sync="Синхронизация", st_synced="Синхронизация", st_on="Вкл.",
   st_recovery="Ключ восстановления", st_copy="Копировать",
   st_disable="Отключить шифрование", st_disable_btn="Отключить",
   st_ai="Модель ИИ",
   st_agent="Режим агента", st_agent_sub="Умный помощник",
   st_trans="Автораспознавание аудио", st_trans_sub="Автоматическое распознавание голоса",
   st_adv="Расширенные настройки ИИ", st_adv_sub="Своя конфигурация ИИ"),
}

# ---------------- banner marketing copy ----------------
# (screen, accent, eyebrow, [title lines], sub)
BANNERS = {
 "en": [
  ("record",  PRIMARY,"VOICE TO TEXT",         ["Speak.","It's text."],
     "Speak a thought and get clean, editable text in seconds."),
  ("privacy", GREEN,  "PRIVATE BY DESIGN",     ["Your notes.","Yours alone."],
     "End-to-end encrypted — only you hold the key. Not us, not the cloud."),
  ("ai",      PURPLE, "AI WRITING TOOLS",      ["Clean it up","with AI."],
     "Fix grammar, summarize, or change the tone — in a single tap."),
  ("settings",GREEN,  "ENCRYPTED SYNC",        ["Everywhere.","Still encrypted."],
     "Your notes on every device — and always end-to-end encrypted."),
  ("search",  PRIMARY,"ALL YOUR NOTES",        ["Everything","in one place."],
     "Voice notes, checklists and text — organised, searchable, always in reach."),
  ("editor",  PRIMARY,"A CALM EDITOR",         ["Write","without noise."],
     "Rich text, checklists and Markdown in a clean, focused editor."),
 ],
 "ru": [
  ("record",  PRIMARY,"ГОЛОС В ТЕКСТ",         ["Говорите.","Текст готов."],
     "Запишите мысль голосом — и получите чистый, готовый к правке текст."),
  ("privacy", GREEN,  "ПРИВАТНОСТЬ В ОСНОВЕ",  ["Ваши заметки.","Только ваши."],
     "Сквозное шифрование — ключ только у вас. Ни у нас, ни в облаке."),
  ("ai",      PURPLE, "AI ДЛЯ ТЕКСТА",         ["Улучшите текст","одним тапом."],
     "Грамматика, краткий пересказ или смена стиля — с помощью AI."),
  ("settings",GREEN,  "СИНХРОНИЗАЦИЯ",         ["Везде.","Всё зашифровано."],
     "Заметки на всех устройствах — и всегда зашифрованы."),
  ("search",  PRIMARY,"ВСЕ ЗАМЕТКИ",           ["Всё нужное","в одном месте."],
     "Голосовые заметки, чек-листы и текст — упорядочены, ищутся за секунду."),
  ("editor",  PRIMARY,"СПОКОЙНЫЙ РЕДАКТОР",    ["Пишите","без лишнего."],
     "Форматирование, чек-листы и Markdown в чистом, спокойном редакторе."),
 ],
}

FG = {
 "en": (["Speak it.","Keep it private."],
        "Voice notes, transcribed to clean text and kept end-to-end encrypted.",
        [("mic","Voice → text"),("cloud_done","Synced"),("lock","Encrypted")]),
 "ru": (["Просто скажите.","Всё приватно."],
        "Голос превращается в чистый текст и хранится со сквозным шифрованием.",
        [("mic","Голос в текст"),("cloud_done","Синхронно"),("lock","Шифрование")]),
}

def rgba(hexc, a):
    h = hexc.lstrip("#"); r,g,b = int(h[0:2],16),int(h[2:4],16),int(h[4:6],16)
    return f"rgba({r},{g},{b},{a})"

def page(w, h, body, extra=""):
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
{base_css()}
{SCREEN_CSS}
body{{width:{w}px;height:{h}px}}
{extra}
</style></head><body>{body}</body></html>"""

def phone(screen_html):
    return (f'<div class="phone"><div class="punch"></div>'
            f'<div class="screen">{screen_html}{navbar()}</div></div>')

# ---------------- 1080x1920 banner ----------------
def build_banner(lang, idx, spec):
    key, accent, eyebrow, title, sub = spec
    L = SL[lang]
    scr = SCREENS[key](L)
    body = f"""
<div class="stage" style="width:1080px;height:1920px">
  <div class="glow" style="width:880px;height:880px;top:-300px;right:-240px;background:radial-gradient(circle,{rgba(accent,.15)},transparent 66%)"></div>
  <div class="glow" style="width:820px;height:820px;bottom:-360px;left:-300px;background:radial-gradient(circle,{rgba(accent,.09)},transparent 68%)"></div>

  <div style="position:absolute;top:70px;left:84px;display:flex;align-items:center;gap:13px">
    {logo(40)}{wordmark(29)}
  </div>

  <div style="position:absolute;top:172px;left:84px;right:84px">
    <span style="display:inline-flex;align-items:center;gap:9px;background:{rgba(accent,.12)};color:{accent};padding:11px 18px;border-radius:100px;font-size:22px;font-weight:800;letter-spacing:.13em">{ic('lock',20,accent) if key in ('privacy','settings') else ic('bolt',20,accent) if False else ic('auto_awesome',20,accent)}{eyebrow}</span>
    <div style="font-weight:800;font-size:100px;line-height:1.0;letter-spacing:-.045em;color:{HEAD_INK};margin-top:26px">
      {title[0]}<br><span style="color:{accent}">{title[1]}</span></div>
    <div style="font-weight:500;font-size:33px;line-height:1.42;color:{INK2};margin-top:26px;max-width:720px">{sub}</div>
  </div>

  <div style="position:absolute;top:596px;left:50%;transform:translateX(-50%) scale(1.36);transform-origin:top center">
    {phone(scr)}
  </div>
</div>"""
    fn = os.path.join(OUT, f"{lang}_{idx:02d}_{key}.html")
    open(fn, "w").write(page(1080, 1920, body))
    return fn

# ---------------- 1024x500 feature graphic ----------------
def build_feature(lang):
    L = SL[lang]
    title, sub, chips = FG[lang]
    chip_html = ""
    for nm, tx in chips:
        col = GREEN if nm in ("lock", "cloud_done") else PRIMARY
        chip_html += (f'<span style="display:inline-flex;align-items:center;gap:8px;background:{SURFACE};'
                      f'border:1px solid {BORDER};color:{INK};padding:9px 15px;border-radius:100px;'
                      f'font-size:18px;font-weight:700;margin-right:11px;vertical-align:middle;'
                      f'box-shadow:0 8px 20px -14px rgba(14,32,74,.3)">{ic(nm,18,col)}{tx}</span>')
    body = f"""
<div class="stage" style="width:1024px;height:500px">
  <div class="glow" style="width:620px;height:620px;top:-250px;right:10px;background:radial-gradient(circle,{rgba(PRIMARY,.14)},transparent 66%)"></div>
  <div class="glow" style="width:520px;height:520px;bottom:-300px;left:-160px;background:radial-gradient(circle,{rgba(GREEN,.10)},transparent 68%)"></div>

  <!-- Play re-crops the feature graphic (16:9 .. 4:3) in collections, charts and
       search, so all type stays inside the intersection of both documented safe
       zones: x 82..942, y 50..450. Only the phone is allowed to bleed off-edge. -->
  <div style="position:absolute;top:56px;left:92px;width:540px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:26px">{logo(40)}{wordmark(30)}</div>
    <div style="font-weight:800;font-size:56px;line-height:1.0;letter-spacing:-.045em;color:{HEAD_INK}">
      {title[0]}<br><span style="color:{PRIMARY}">{title[1]}</span></div>
    <div style="font-weight:500;font-size:23px;line-height:1.38;color:{INK2};margin-top:20px;max-width:510px">{sub}</div>
    <div style="margin-top:34px;line-height:0">{chip_html}</div>
  </div>

  <div style="position:absolute;right:-30px;top:56px;transform:rotate(-6deg) scale(.70);transform-origin:top right">
    <div style="filter:drop-shadow(0 40px 70px rgba(14,32,74,.34))">{phone(SCREENS['notes'](L))}</div>
  </div>
</div>"""
    fn = os.path.join(OUT, f"{lang}_feature.html")
    open(fn, "w").write(page(1024, 500, body))
    return fn

if __name__ == "__main__":
    files = []
    for lang in ("en", "ru"):
        files.append(build_feature(lang))
        for i, spec in enumerate(BANNERS[lang], 1):
            files.append(build_banner(lang, i, spec))
    print("\n".join(os.path.basename(f) for f in files))
    print(f"{len(files)} files")
