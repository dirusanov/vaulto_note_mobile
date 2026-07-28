"""Faithful reproductions of real Vaulto Note screens (412x915, Android)."""
from common import (SURFACE, BG, BG2, INK, INK2, INK3, MUTED, PRIMARY, PRIMARYD,
                    GREEN, PURPLE, YELLOW, ORANGE, RED, BORDER, ic, logo, statusbar,
                    wordmark, NAV_H)

SCREEN_CSS = f"""
.scrn{{position:absolute;inset:0;display:flex;flex-direction:column;background:{BG}}}
.ca{{flex:1;position:relative;overflow:hidden}}
.sw{{width:51px;height:31px;border-radius:16px;position:relative;flex:none}}
.sw i{{position:absolute;top:2px;width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:0 2px 4px rgba(0,0,0,.25)}}
"""

def switch(on=True, color=PRIMARY):
    track = color if on else "#E4E7EC"
    pos = "right:2px" if on else "left:2px"
    return f'<div class="sw" style="background:{track}"><i style="{pos}"></i></div>'

# ---------------- shared: a real NoteCard ----------------
def note_card(title, preview, date, audio=False, locked=False, local=False, pinned=False, lines=4):
    icons = ""
    if audio:  icons += ic("mic", 16, INK3)
    if locked: icons += f'<span style="margin-left:4px">{ic("lock",14,PRIMARY)}</span>'
    if local:  icons += f'<span style="margin-left:4px">{ic("smartphone",14,INK2)}</span>'
    if pinned: icons += f'<span style="margin-left:4px">{ic("push_pin",14,PRIMARY)}</span>'
    prev = f'<div style="font-size:14px;line-height:20px;color:{INK2}">{preview}</div>' if preview else ""
    return f"""<div style="background:{SURFACE};border-radius:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,.05)">
      <div style="padding:16px 16px 8px">
        <div style="font-size:18px;font-weight:700;color:{INK};line-height:24px;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{title}</div>
        {prev}
      </div>
      <div style="padding:0 16px 14px;display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:12px;color:{INK3};font-weight:500">{date}</span>
        <span style="display:flex;align-items:center">{icons}</span>
      </div>
    </div>"""

def _notes_masonry(L, top=14):
    left = [
        note_card(L["n1t"], L["n1s"], L["now"], audio=True, pinned=True, locked=True),
        note_card(L["n3t"], L["n3s"], L["d_mon"], locked=True),
        note_card(L["n5t"], L["n5s"], "12 " + L["mon_apr"], local=True),
        note_card(L["n7t"], L["n7s"], "9 " + L["mon_apr"], locked=True),
        note_card(L["n9t"], L["n9s"], "7 " + L["mon_apr"], locked=True),
        note_card(L["n11t"], L["n11s"], "5 " + L["mon_apr"], locked=True),
    ]
    right = [
        note_card(L["n2t"], L["n2s"], L["d_2h"], locked=True),
        note_card(L["n4t"], "", L["now"], audio=True, locked=True),
        note_card(L["n6t"], L["n6s"], "9 " + L["mon_apr"], locked=True),
        note_card(L["n8t"], L["n8s"], "8 " + L["mon_apr"], audio=True, locked=True),
        note_card(L["n10t"], L["n10s"], "6 " + L["mon_apr"], local=True),
        note_card(L["n12t"], L["n12s"], "4 " + L["mon_apr"], audio=True, locked=True),
    ]
    col = lambda cards: f'<div style="flex:1 1 0;min-width:0;display:flex;flex-direction:column">{"".join(cards)}</div>'
    return (f'<div style="display:flex;gap:12px;padding:{top}px 16px 0;align-items:flex-start">'
            f'{col(left)}{col(right)}</div>')

# ---------------- search bar (NotesListScreen) ----------------
def _searchbar(L):
    return f"""<div style="padding:4px 16px 0">
      <div style="display:flex;align-items:center;gap:8px;height:56px;background:{SURFACE};border-radius:12px;padding:0 16px;box-shadow:0 2px 8px rgba(0,0,0,.05)">
        {ic("search",20,INK3)}
        <span style="flex:1;font-size:16px;color:{INK3}">{L["search_ph"]}</span>
      </div></div>"""

# ---------------- floating dock ----------------
def _dock(L):
    return f"""<div style="position:absolute;left:0;right:0;bottom:{NAV_H+42}px;display:flex;justify-content:center;z-index:30">
      <div style="width:340px;height:70px;background:{SURFACE};border-radius:32px;box-shadow:0 10px 26px rgba(0,0,0,.15);border:1px solid rgba(0,0,0,.03);padding:8px 32px 4px;display:flex;flex-direction:column;align-items:center">
        <div style="display:flex;align-items:center;justify-content:space-between;width:100%">
          <div style="width:48px;height:48px;display:flex;align-items:center;justify-content:center">{ic("settings",26,INK2)}</div>
          <div style="width:88px;height:88px;margin-top:-35px;background:{BG};border-radius:44px;padding:6px;display:flex">
            <div style="flex:1;border-radius:38px;background:{PRIMARY};display:flex;align-items:center;justify-content:center;box-shadow:0 8px 16px rgba(0,102,255,.4)">{ic("mic",40,"#fff")}</div>
          </div>
          <div style="width:48px;height:48px;display:flex;align-items:center;justify-content:center">{ic("edit",26,INK2)}</div>
        </div>
        <div style="font-size:9px;color:{INK};opacity:.75;margin-top:-6px">{L["hold"]}</div>
      </div>
    </div>"""

# ================= 1. NOTES LIST =================
def scr_notes(L, dock=True, search=False):
    return f"""<div class="scrn">{statusbar(INK)}<div class="ca">
      {_searchbar(L) if search else ""}
      {_notes_masonry(L, top=12 if search else 14)}
      {_dock(L) if dock else ""}
    </div></div>"""

def scr_search(L):
    return scr_notes(L, dock=True, search=True)

# ================= 2. RECORDING (overlay bar) =================
def scr_record(L):
    # waveform bars (static, primary)
    hs = [10,16,26,40,30,20,44,54,34,22,12,30,50,56,42,26,16,32,48,36]
    bars = "".join(f'<div style="width:5px;height:{h}px;border-radius:2.5px;background:{PRIMARY};flex:none"></div>' for h in hs)
    badge = lambda icon, txt: f'<div style="display:flex;align-items:center;gap:8px;background:{PRIMARY};border-radius:24px;padding:10px 18px;box-shadow:0 2px 6px rgba(0,0,0,.12)">{icon}<span style="font-size:14px;font-weight:600;color:#fff">{txt}</span></div>'
    return f"""<div class="scrn">{statusbar(INK)}<div class="ca">
      {_notes_masonry(L)}
      <div style="position:absolute;left:0;right:0;bottom:0;height:380px;background:linear-gradient(to top,{BG} 60%,rgba(248,249,250,0))"></div>
      <div style="position:absolute;left:16px;right:16px;bottom:{NAV_H+26}px;display:flex;flex-direction:column;align-items:center">
        <div style="display:flex;gap:8px;margin-bottom:16px">
          {badge(ic("mic",18,"#fff"), L["transcribe_on"])}
          {badge(ic("smart_toy",18,"#fff"), L["agent_on"])}
        </div>
        <div style="width:100%;background:{SURFACE};border-radius:44px;padding:14px 22px;display:flex;align-items:center;box-shadow:0 6px 22px rgba(0,0,0,.16)">
          <div style="padding:6px">{ic("delete",34,INK3)}</div>
          <div style="flex:1;display:flex;align-items:center;gap:12px;padding:0 10px;overflow:hidden">
            <span style="font-size:26px;font-weight:700;color:{INK};font-variant-numeric:tabular-nums">0:14</span>
            <div style="flex:1;display:flex;align-items:center;gap:5px;height:56px;overflow:hidden">{bars}</div>
          </div>
          <div style="padding:6px">{ic("pause",34,INK2)}</div>
          <div style="width:60px;height:60px;border-radius:30px;background:{PRIMARY};display:flex;align-items:center;justify-content:center;margin-left:6px;box-shadow:0 6px 14px rgba(0,102,255,.4)">{ic("send",28,"#fff")}</div>
        </div>
      </div>
    </div></div>"""

# ================= 3. EDITOR =================
def _editor_head(L):
    return f"""<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px 6px">
        <div style="padding:4px;min-width:40px">{ic("arrow_back",28,INK)}</div>
        <div style="display:flex;align-items:center;gap:16px">
          {ic("text_fields",24,INK)}{ic("auto_awesome",24,PRIMARY)}{ic("mic",24,INK)}{ic("check",24,INK)}
        </div>
      </div>"""

def _editor_body(L):
    check_item = lambda txt, done: f'''<div style="display:flex;align-items:center;gap:10px;margin:7px 0">
        {ic("check_box",22,PRIMARY) if done else '<div style="width:20px;height:20px;border:2px solid '+MUTED+';border-radius:4px;flex:none"></div>'}
        <span style="font-size:16px;color:{INK2 if done else INK};{'text-decoration:line-through' if done else ''}">{txt}</span></div>'''
    return f"""<div style="flex:1;padding:4px 20px 0;overflow:hidden">
        <div style="font-size:24px;font-weight:400;color:{INK};margin-bottom:4px">{L["ed_ttl"]}</div>
        <div style="font-size:12px;color:{INK3};margin-bottom:14px">{L["ed_meta"]}</div>
        <div style="display:flex;gap:8px;margin-bottom:16px">
          <div style="display:flex;align-items:center;gap:6px;border-radius:18px;padding:6px 14px;background:{PRIMARY}">{ic("lock",14,BG)}<span style="font-size:13px;font-weight:500;color:{BG}">{L["original"]}</span></div>
          <div style="display:flex;align-items:center;gap:6px;border-radius:18px;padding:6px 14px;background:{SURFACE};border:1px solid {BORDER}">{ic("auto_awesome",14,INK2)}<span style="font-size:13px;font-weight:500;color:{INK2}">{L["ed_variant"]}</span></div>
        </div>
        <div style="font-size:20px;font-weight:700;color:{INK};margin-bottom:8px">{L["ed_h"]}</div>
        <div style="font-size:16px;line-height:26px;color:{INK};margin-bottom:10px">{L["ed_p1"]}</div>
        {check_item(L["ed_c1"], True)}{check_item(L["ed_c2"], False)}{check_item(L["ed_c3"], False)}
        <div style="font-size:16px;line-height:26px;color:{INK};margin-top:10px">{L["ed_p2a"]} <span style="background:#BAE1FF;padding:1px 3px;border-radius:3px">{L["ed_hl"]}</span> {L["ed_p2b"]}</div>
        <div style="font-size:20px;font-weight:700;color:{INK};margin:22px 0 8px">{L["ed_h2"]}</div>
        <div style="font-size:16px;line-height:26px;color:{INK};margin-bottom:10px">{L["ed_p3"]}</div>
        {check_item(L["ed_c4"], False)}{check_item(L["ed_c5"], False)}
        <div style="font-size:16px;line-height:26px;color:{INK};margin-top:10px">{L["ed_p4"]}</div>
      </div>"""

def scr_editor(L):
    tb = lambda icon, active=False: f'<div style="width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;{"background:"+BG2 if active else ""}">{icon}</div>'
    return f"""<div class="scrn">{statusbar(INK)}<div class="ca" style="display:flex;flex-direction:column">
      {_editor_head(L)}
      {_editor_body(L)}
      <div style="background:{SURFACE};border-top:1px solid rgba(0,0,0,.05);box-shadow:0 -3px 5px rgba(0,0,0,.05);height:{52+NAV_H}px;padding-bottom:{NAV_H}px;display:flex;align-items:center;justify-content:center;gap:4px">
        {tb(ic("check_box",22,PRIMARY),True)}{tb(ic("format_list_bulleted",22,INK2))}
        <div style="width:4px"></div>{tb(f'<span style="font-size:15px;font-weight:700;color:{INK2}">H2</span>')}<div style="width:4px"></div>
        {tb(ic("format_bold",22,INK2))}{tb(ic("format_italic",22,INK2))}{tb(ic("format_underlined",22,INK2))}{tb(ic("format_strikethrough",22,INK2))}
        <div style="width:4px"></div>
        <div style="width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;position:relative">{ic("border_color",20,INK2)}<div style="position:absolute;bottom:4px;right:4px;width:8px;height:8px;border-radius:4px;background:#BAE1FF;border:1px solid rgba(0,0,0,.05)"></div></div>
      </div>
    </div></div>"""

# ================= 4. AI IMPROVE MODAL =================
def scr_ai(L):
    opt = lambda icon, label, prompt: f"""<div style="display:flex;align-items:center;padding:14px 0;border-bottom:1px solid {BORDER}">
        <div style="width:40px;height:40px;border-radius:20px;background:{BG};display:flex;align-items:center;justify-content:center;margin-right:16px;flex:none">{ic(icon,24,PRIMARY)}</div>
        <div style="flex:1;min-width:0"><div style="font-size:16px;font-weight:500;color:{INK}">{label}</div><div style="font-size:12px;color:{INK2};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{prompt}</div></div>
        {ic("drag_handle",22,MUTED)}</div>"""
    # the real backdrop is the note editor itself, not a stub — otherwise the dim
    # layer reads as one flat grey block instead of a screen behind a sheet
    behind = (f'<div style="position:absolute;inset:0;display:flex;flex-direction:column">'
              f'{_editor_head(L)}{_editor_body(L)}</div>')
    return f"""<div class="scrn">{statusbar(INK)}<div class="ca">{behind}
      <div style="position:absolute;inset:0;background:rgba(11,13,16,.34)"></div>
      <div style="position:absolute;left:0;right:0;bottom:0;background:{SURFACE};border-radius:24px 24px 0 0;padding:22px 24px {26+NAV_H}px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <span style="font-size:20px;font-weight:600;color:{INK}">{L["improve_ttl"]}</span>
          <div style="display:flex;align-items:center;gap:4px;padding:8px 14px;border-radius:12px;background:{BG};border:1px solid {BORDER}">{ic("add",18,PRIMARY)}<span style="font-size:15px;font-weight:600;color:{PRIMARY}">{L["create"]}</span></div>
        </div>
        <div style="border:1px solid {BORDER};border-radius:16px;padding:8px 8px 12px;background:{BG};margin:0 8px 18px">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div style="display:flex;align-items:center">{ic("expand_more",24,INK)}<span style="font-size:16px;font-weight:500;color:{INK}">{L["custom_instr"]}</span></div>
            {ic("mic",24,PRIMARY)}
          </div>
          <div style="display:flex;align-items:center;padding:4px 8px 0">
            <div style="flex:1;font-size:15px;color:{INK};padding:10px 8px">{L["ai_example"]}<span style="display:inline-block;width:2px;height:18px;background:{PRIMARY};vertical-align:-3px;margin-left:1px"></span></div>
          </div>
          <div style="display:flex;align-items:center;justify-content:center;gap:8px;background:{PRIMARY};border-radius:12px;padding:12px;margin-top:6px">
            <span style="font-size:16px;font-weight:600;color:#fff">{L["apply_instr"]}</span>{ic("arrow_forward",16,"#fff")}</div>
        </div>
        <div style="height:1px;background:{BORDER};margin:0 -24px"></div>
        {opt("spellcheck", L["ai_o1"], L["ai_o1p"])}
        {opt("business_center", L["ai_o2"], L["ai_o2p"])}
        {opt("child_care", L["ai_o3"], L["ai_o3p"])}
        {opt("short_text", L["ai_o4"], L["ai_o4p"])}
      </div>
    </div></div>"""

# ================= 5. PRIVACY (UnlockSyncModal) =================
def scr_privacy(L):
    behind = f'<div style="position:absolute;inset:0;background:{BG}">{_notes_masonry(L)}</div>'
    dots = "•" * 11
    return f"""<div class="scrn">{statusbar(INK)}<div class="ca">{behind}
      <div style="position:absolute;inset:0;background:rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center;padding:24px">
        <div style="width:100%;background:{SURFACE};border-radius:28px;border:1px solid {BORDER};padding:24px;box-shadow:0 14px 40px rgba(0,0,0,.22)">
          <div style="width:58px;height:58px;border-radius:20px;background:rgba(0,102,255,.06);border:1px solid rgba(0,102,255,.09);display:flex;align-items:center;justify-content:center;margin:0 auto 16px">{ic("lock_open_variant_outline",26,PRIMARY,cls="mc")}</div>
          <div style="font-size:20px;font-weight:600;color:{INK};text-align:center;margin-bottom:4px">{L["pv_ttl"]}</div>
          <div style="font-size:14px;line-height:20px;color:{INK2};text-align:center;margin-bottom:20px">{L["pv_sub"]}</div>
          <div style="font-size:13px;font-weight:600;color:{INK};margin-bottom:4px">{L["pv_label"]}</div>
          <div style="height:50px;border:1px solid {BORDER};border-radius:12px;background:{SURFACE};display:flex;align-items:center;padding:0 16px;font-size:22px;letter-spacing:2px;color:{INK}">{dots}</div>
          <div style="text-align:right;padding:6px 0 12px"><span style="font-size:13px;font-weight:700;color:{PRIMARY}">{L["pv_show"]}</span></div>
          <div style="display:flex;align-items:center;gap:8px;background:rgba(16,185,129,.06);border-radius:12px;padding:9px 16px;margin-bottom:16px">{ic("shield_check_outline",16,GREEN,cls="mc")}<span style="font-size:12px;line-height:16px;color:{INK2}">{L["pv_hint"]}</span></div>
          <div style="display:flex;gap:8px">
            <div style="flex:1;height:50px;border:1px solid {PRIMARY};border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600;color:{PRIMARY}">{L["cancel"]}</div>
            <div style="flex:1;height:50px;background:{PRIMARY};border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600;color:#fff">{L["unlock"]}</div>
          </div>
          <div style="border-top:1px solid {BORDER};margin-top:16px;padding-top:16px;display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;align-items:center;justify-content:center;gap:4px;background:rgba(0,102,255,.03);border:1px solid rgba(0,102,255,.08);border-radius:12px;padding:9px">{ic("key_chain",16,PRIMARY,cls="mc")}<span style="font-size:13px;font-weight:600;color:{PRIMARY}">{L["pv_recovery"]}</span></div>
            <div style="display:flex;align-items:center;justify-content:center;gap:4px;border:1px solid rgba(220,53,69,.09);border-radius:12px;padding:9px">{ic("alert_circle_outline",16,RED,cls="mc")}<span style="font-size:13px;font-weight:600;color:{RED}">{L["pv_forgot"]}</span></div>
          </div>
        </div>
      </div>
    </div></div>"""

# ================= 6. SETTINGS =================
# Mirrors SettingsScreen.tsx: styles.card (surface, r16, 1px border, 16px padding),
# styles.cardHeader (icon + h2/20 title + help), styles.securityRowMinimal
# (36px round iconContainer at 20% tint + caption label + value/control),
# styles.separator (1px border @ 50%), styles.preferenceRow (24px icon + title/desc).
def scr_settings(L):
    def card(inner, mb=16):
        return (f'<div style="background:{SURFACE};border-radius:16px;padding:16px;'
                f'border:1px solid {BORDER};margin-bottom:{mb}px">{inner}</div>')

    def card_header(icon, title, mc=False, right=""):
        return (f'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
                f'<div style="display:flex;align-items:center;gap:8px">{ic(icon,18,PRIMARY,cls="mc" if mc else "mi")}'
                f'<span style="font-size:20px;font-weight:600;letter-spacing:-.3px;color:{INK}">{title}</span></div>'
                f'{right}</div>')

    def icon_box(icon, color, mc=False):
        return (f'<div style="width:36px;height:36px;border-radius:18px;background:{color}33;'
                f'display:flex;align-items:center;justify-content:center;flex:none">'
                f'{ic(icon,16,color,cls="mc" if mc else "mi")}</div>')

    def sec_row(box, label, right):
        return (f'<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0">'
                f'<div style="display:flex;align-items:center;gap:16px;flex:1;min-width:0">{box}'
                f'<span style="font-size:13px;line-height:18px;font-weight:500;color:{INK2};flex:1">{label}</span></div>'
                f'<div style="display:flex;align-items:center;gap:8px;flex:none">{right}</div></div>')

    def pref_row(icon, title, desc, right, color=PRIMARY):
        return (f'<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 0">'
                f'<div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">{ic(icon,24,color)}'
                f'<div style="flex:1;min-width:0"><div style="font-size:16px;line-height:24px;font-weight:600;color:{INK};margin-bottom:2px">{title}</div>'
                f'<div style="font-size:13px;line-height:18px;color:{INK2}">{desc}</div></div></div>{right}</div>')

    sep     = f'<div style="height:1px;background:{BORDER};opacity:.5"></div>'
    value   = lambda t, c: f'<span style="font-size:14px;line-height:20px;font-weight:600;color:{c}">{t}</span>'
    outlined = lambda t, c=INK, bc=BORDER: (
        f'<span style="display:inline-flex;padding:6px 12px;border-radius:8px;border:1px solid {bc};'
        f'font-size:13px;line-height:18px;font-weight:600;color:{c}">{t}</span>')

    return f"""<div class="scrn">{statusbar(INK)}<div class="ca" style="display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;gap:16px;padding:8px 16px 8px">
        <div style="width:42px;height:42px;border-radius:12px;border:1px solid {BORDER};background:{SURFACE};display:flex;align-items:center;justify-content:center">{ic("arrow_back",22,INK)}</div>
        <span style="font-size:24px;font-weight:700;letter-spacing:-.5px;color:{INK}">{L["settings"]}</span>
      </div>
      <div style="flex:1;overflow:hidden;padding:8px 16px 0">

        {card(pref_row("language", L["st_lang"], L["st_lang_sub"],
                       ic("chevron_right",20,INK2), color=INK2))}

        {card(card_header("cloud_sync", L["st_sync"], right=ic("help_outline",18,INK2))
              + sec_row(icon_box("cloud_done", GREEN), L["st_synced"],
                        value(L["st_on"], GREEN) + switch(True))
              + sep
              + sec_row(icon_box("shield_key", PRIMARY, mc=True), L["st_recovery"],
                        outlined(L["st_copy"]))
              + sep
              + sec_row(icon_box("security", ORANGE, mc=True), L["st_disable"],
                        outlined(L["st_disable_btn"], ORANGE, ORANGE)))}

        {card(card_header("psychology", L["st_ai"])
              + pref_row("smart_toy", L["st_agent"], L["st_agent_sub"], switch(True))
              + sep
              + pref_row("mic", L["st_trans"], L["st_trans_sub"], switch(True))
              + sep
              + pref_row("tune", L["st_adv"], L["st_adv_sub"], ic("expand_more",24,INK2), color=INK2))}

        <div style="display:flex;align-items:center;justify-content:center;gap:8px;height:52px;
                    border:1px solid {BORDER};border-radius:16px;background:{SURFACE};margin-bottom:16px">
          {ic("logout",20,RED)}<span style="font-size:16px;font-weight:600;color:{RED}">{L["st_signout"]}</span></div>

        <div style="display:flex;align-items:center;justify-content:center;gap:10px;font-size:13px;color:{PRIMARY};font-weight:500">
          <span>{L["st_privacy"]}</span><span style="color:{MUTED}">·</span><span>{L["st_terms"]}</span></div>
        <div style="text-align:center;font-size:12px;color:{INK3};margin-top:10px">Vaulto v1.1.0</div>

      </div>
    </div></div>"""

SCREENS = {
    "notes": scr_notes, "search": scr_search, "record": scr_record,
    "editor": scr_editor, "ai": scr_ai, "privacy": scr_privacy,
    "settings": scr_settings,
}
