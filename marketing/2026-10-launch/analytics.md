# Vaulto Note: журнал продвижения

Кампания: `note_offline_2026_10`. Продукт: Android `com.vaultonotemobile`.
Отдельная кампания от Vaulto Cards. Новые измерения добавлять ниже, старые сохранять.

## Исходный публичный срез — 2026-10-05

Наблюдение: около 16:47–16:52 UTC / 19:47–19:52 Europe/Moscow; время с точностью до нескольких минут.
Источник: живая страница Google Play в Chrome, затем отдельно без входа в инкогнито, локаль en-US / gl=US. Магазин доступен публично.

| Поле | Значение |
| --- | --- |
| Ссылка | https://play.google.com/store/apps/details?id=com.vaultonotemobile&hl=en&gl=US |
| Публичное название | Vaulto: Private AI Voice Notes |
| Версия | 1.0.89 |
| Дата обновления | 2026-10-05 |
| Категория | Productivity |
| Видимый диапазон скачиваний | 10+ |
| Точное число установок | null |
| Число активных пользователей | null |
| Рейтинг / число оценок | null / null; блок рейтинга не показан |
| Телефонные скриншоты | 8 элементов в публичном интерфейсе |
| Видимые IAP | $4.99–$38.99; продукты/периоды в этом поле не расшифрованы |
| Посетители магазина / конверсия | null / null |
| Активация / D7 / WAU | null / null / null |
| Платящие / выручка | null / null |
| Публикации мобильной кампании | Не выполнены в рамках этой задачи; более ранние неизвестны |

Не трактовать 10+ как десять активных пользователей. Не трактовать отсутствие блока оценок как подтверждённый ноль. Загрузка страницы могла создать посещение; корректировка не придумана.

Поисковая копия Play устарела (июль, старое название/описание/Data safety), поэтому её значения не использованы вместо живого среза.

## Срез сайта — та же дата

Живая https://vaultonote.com/ без входа: общее позиционирование ecosystem Note + Cards; общий блок цены обещает 150 минут/месяц, actual карточки показывают 500 минут/месяц; $4.99 monthly, округлённые $39 yearly и одноразовый trial 30 минут. Общий блок рекламирует Custom API Key & Server, тогда как локальный код релиза скрывает custom AI. Это зафиксированные расхождения, не подтверждение успешной оплаты или всех серверных лимитов.

## Следующий срез

После запуска записать: UTC/МСК, площадку, permalink, вариант видео/текста, обычную или размеченную ссылку, публичную доступность без входа, владельческие views, votes, comments и отдельно Play/RevenueCat. Все неизвестные значения — null. Отмечать задержку отчётов, собственные просмотры и ограничения атрибуции.

Первый контроль через 24 часа после фактической публикации, затем 48 часов и 7 дней. Публикации ещё нет, поэтому отсчёт не начался. Автоматический мониторинг не создан.

## Подготовка первого поста — 2026-10-05, после исходного среза

Пользователь уточнил приоритет: первые пользователи сейчас, недостатки записать и исправлять позже. Подготовлен showcase с двумя существующими скриншотами магазина. На отправку конкретного поста запрошено отдельное поручение; ответа пока нет. При открытии r/droidappshowcase в обычном Chrome Reddit показал “Prove your humanity” / reCAPTCHA. С проверкой не взаимодействовали. Публикация не выполнена; просмотры/клики/установки кампании неизвестны. Вопрос пользователя о преимуществе приложения не трактовался как подтверждение публикации.


## Open-source launch and first Reddit posts - 2026-10-05 evening

User explicitly authorized public mobile GitHub, license selection and Reddit
publication. HN is preparation only; the user will write/review and publish manually.

GitHub commit e5cfaa6 pushed to master. Repository now PUBLIC, GPL-3.0-only;
GitHub recognizes GPLv3. README has hero, 19-second GIF/MP4, screenshots, data
diagram, build/privacy/security/contribution docs and issue forms. Description,
Play homepage and 8 topics configured. Unauthenticated GitHub API and raw README
requests independently confirmed public availability. Social cover file prepared;
upload to repository settings not yet performed. App behavior/store binary unchanged.

After fetch: all 430 reachable historic commits checked, 2508 text blobs up to
2 MB scanned, 172 binary/large blobs skipped. No selected secret signatures found.
This is a bounded preflight, not proof that all secrets/private data are absent.

| Community | ID and link | Author-view status | Owner views | Votes | Comments |
| --- | --- | --- | --- | --- | --- |
| r/droidappshowcase | [1wyemer](https://www.reddit.com/r/droidappshowcase/comments/1wyemer/vaulto_opensource_offline_voice_notes/) | Removed by Reddit filters, checked about 20:29-20:32 Moscow | null | 1, own vote active | 2, both bots |
| r/SideProject | [1wyerii](https://www.reddit.com/r/SideProject/comments/1wyerii/i_opened_the_source_of_my_android_voicenotes_app/) | Full body/video, no removal notice in author view around 20:36-20:37 Moscow | 8 | 1, own vote active | 0 |

Droidappshowcase title: "Vaulto - open-source offline voice notes", Showcase flair.
SideProject title: "I opened the source of my Android voice-notes app, including
its local AI and encryption"; flair unavailable. Distinct copy, same 19-second
real-screenshot video; screenshot version 1.0.87 and current Play 1.0.89 disclosed.
Submission time estimates: droidappshowcase about 20:27 Moscow / 17:27 UTC;
SideProject about 20:35 Moscow / 17:35 UTC. Exact created_utc unavailable (null);
these estimates come from action timing/relative UI age, not server timestamps.

Separate public checks: first permalink in Incognito hit reCAPTCHA; no challenge
interaction. Unauthenticated www/old Reddit JSON returned HTTP 403; web reader
returned cache miss. SideProject public checks also failed (HTTP 403/cache miss).
Do not equate author's full body/feed visibility with independent public availability.
Public availability remains unverified; the droid post is explicitly filtered.

Droid bot comments: [Play match](https://www.reddit.com/r/droidappshowcase/comments/1wyemer/comment/pe1ypmc/)
and [media/flair reminder](https://www.reddit.com/r/droidappshowcase/comments/1wyemer/comment/pe1yk2w/).
Neither is an organic response or a specific reason for the filter. Reputation,
posting frequency and new source links are hypotheses, not established causes.

Modmail copy prepared in modmail-droidappshowcase.md; sending permission pending.
No post deleted/reposted, no votes solicited, no spend. User asked for other relevant
communities; those attempts are recorded in subsequent entries.

Ratio/shares/awards unavailable (null). Reddit views are not unique users or installs;
our checks may add views. Store clicks, installs, active users and revenue remain null.
No attribution parameters/analytics SDK added. Follow-up: 24 h, 48 h, 7 d after
submission, retaining removed/filtered states and bot/human comment distinctions.


## Third placement - 2026-10-05 about 20:39-20:43 Moscow

r/AndroidApp live form requires Request to Post and shows only 8 weekly visitors;
no request or post sent there. User asked to try other relevant communities.

r/IMadeThis accepted post [1wyexi9](https://www.reddit.com/r/IMadeThis/comments/1wyexi9/i_made_an_android_voicenotes_app_that_can/)
by u/Random1k17: "I made an Android voice-notes app that can transcribe and organize
notes offline". Short distinct text, Play and public GPLv3 GitHub links. This post
has no uploaded media; repository link provides real screenshots and animation.
The image upload dialog did not enable Open for the selected PNG, so the upload
was cancelled before submission; no broken/missing attachment was claimed.

Author permalink checked around 20:43 Moscow / 17:43 UTC: full intended body,
no removal notice, 3 views, 1 own upvote selected, 0 comments. Ratio/shares/awards
and downstream conversion remain null. Exact server publication timestamp null;
action timing places submission about 20:39-20:40 Moscow.

Unauthenticated public web check returned cache miss, consistent with the other
fresh posts; public visibility remains unverified rather than inferred from the
owner UI. Public unauthenticated GitHub GIF and LICENSE fetched successfully;
SHA-256 matches the committed artifacts.

## Early follow-up - 2026-10-05 ~17:47 UTC / ~20:47 Moscow

Signed-in permalinks were rechecked for delayed filtering. Both SideProject and
IMadeThis still display their full bodies without a removal notice. Read-only
Post Insights provided the following new snapshot; earlier values remain above.

| Community | Views | Delta from preceding journal snapshot | Upvotes shown | Ratio | Comments | Shares | Awards |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| r/SideProject (1wyerii) | 73 | +65 | 2 | 100% | 0 | 1 | 0 |
| r/IMadeThis (1wyexi9) | 8 | +5 | 1 | 100% | 0 | 0 | 0 |

Permalink headline totals immediately before Insights were 72 and 7 respectively.
Use Insights totals for this snapshot. Our read-only visits may contribute views.
Own upvotes were still selected on both permalinks; displayed votes are not all
outside endorsements. Reddit's share metric does not identify a person/action.
Hourly graph totals lag headline counts (69 and 6); not substituted for totals.

SideProject country breakdown: United States 35.6%, Belarus 8.2%, Italy 6.8%,
other 49.3% (rounded by Reddit). IMadeThis country breakdown not shown (null).
Neither post has comments to answer. Installs, store clicks and revenue remain
unknown. Independent signed-out availability remains unverified because the
separate public checks were blocked; owner Insights are not a replacement.

Native Chrome also rendered the public GitHub README with hero, animated tour,
gallery, data-flow diagram, source links and GPL-3.0 license while signed out.
GitHub browser session is signed out; social-preview.png is prepared in the public
repository but is not configured as the repository social preview. No login,
modmail, edits, reposts or additional submissions were made in this follow-up.

## Three additional communities - 2026-10-05 ~18:01-18:11 UTC / ~21:01-21:11 Moscow

User explicitly requested three more Reddit communities and a GitHub link check.
Three additional text-only posts were submitted, each with distinct reviewed copy,
developer disclosure, direct Play/source links and accurate local/cloud conditions.
Full actual copy and candidate exclusions: [additional-reddit.md](additional-reddit.md).

| Community | ID / permalink | Author-view result | Views | Upvotes shown | Comments |
| --- | --- | --- | ---: | ---: | ---: |
| r/alphaandbetausers | [1wyfizr](https://www.reddit.com/r/alphaandbetausers/comments/1wyfizr/android_vaulto_looking_for_feedback_on_offline/) | Full body, no removal notice at ~18:02 UTC | 1 | 1, own | 0 |
| r/indiehackers | [1wyflgv](https://www.reddit.com/r/indiehackers/comments/1wyflgv/vaulto_opensource_android_voice_notes_with_free/) | Removed by moderators immediately after submission | null | 1, own | 0 |
| r/apps | [1wyfpeu](https://www.reddit.com/r/apps/comments/1wyfpeu/android_vaulto_voice_notes_with_offline/) | Removed by Reddit filters on permalink | null | 1, own | 0 |

Approximate action-time submission estimates: 18:01 UTC (alphaandbetausers),
18:04 UTC (indiehackers), 18:08 UTC (apps). Exact server created_utc null.
Flair: unavailable / Self Promotion / App respectively. All have no uploaded media.
No repeated post to the same community, private message, vote solicitation or spend.

Follow-up ~18:11 UTC / ~21:11 Moscow: alphaandbetausers shows 12 views (+11),
full body, no removal notice, own vote still active, 0 comments. Ratio/shares/awards
not read in this snapshot (null). Permalink headline counts used; our checks may
contribute. Store clicks, installs, usage and revenue remain unknown.

Read-only Reddit notification for indiehackers from AutoModerator explains the
removal: account has fewer than 10 comment karma **within r/indiehackers**.
Source: https://www.reddit.com/notifications/a/ann_ejr839, checked ~18:10 UTC.
This is evidence for that post only, not the Reddit filter causes for apps/droid.
Do not manufacture participation/karma or repost to evade the threshold.

Separate unauthenticated web reader checks of all three actual permalinks returned
cache miss. Independent public availability remains unverified. Removed owner
states are explicit; submitting a post is not proof it received distribution.

GitHub verified with gh repo view: public, GPLv3 recognized, homepage points to
Google Play. README already has Play, website, privacy policy, Issues, build and
privacy docs. README-only commit b450c93 surfaces Feedback/Website in top nav and
removes stale current-source version from screenshot note; pushed and independently
fetched through unauthenticated raw GitHub. Concurrent source release is 1.0.90;
public Play was not rechecked in this follow-up and is not claimed to be 1.0.90.
Marketing journal remains local, preserving all preceding measurements.

## Status recheck — 2026-10-05 ~18:40–18:43 UTC / ~21:40–21:43 Moscow

User requested a current check of whether campaign posts remain active. All six
mobile permalinks were freshly loaded in the signed-in author's Chrome session;
the previously open alphaandbetausers page was explicitly reloaded first to avoid
using its stale 12-view page. No posts, comments, edits or private messages sent.

| Community / post | Fresh author-view status | Views | Delta vs latest preceding snapshot | Upvotes shown | Ratio | Comments | Shares | Awards |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| [SideProject / 1wyerii](https://www.reddit.com/r/SideProject/comments/1wyerii/i_opened_the_source_of_my_android_voicenotes_app/) | Full original body/video, no removal notice | 133 | +60 vs 73 | 2 | 100% | 0 | 1 | 0 |
| [IMadeThis / 1wyexi9](https://www.reddit.com/r/IMadeThis/comments/1wyexi9/i_made_an_android_voicenotes_app_that_can/) | Full original body, no removal notice | 26 | +18 vs 8 | 1 | 100% | 0 | 0 | 0 |
| [alphaandbetausers / 1wyfizr](https://www.reddit.com/r/alphaandbetausers/comments/1wyfizr/android_vaulto_looking_for_feedback_on_offline/) | Full original body, no removal notice | 26 | +14 vs 12 | 1 | 100% | 0 | 0 | 0 |
| [droidappshowcase / 1wyemer](https://www.reddit.com/r/droidappshowcase/comments/1wyemer/vaulto_opensource_offline_voice_notes/) | Still removed by Reddit filters | null | null | 1 | null | 2, existing bots | null | null |
| [indiehackers / 1wyflgv](https://www.reddit.com/r/indiehackers/comments/1wyflgv/vaulto_opensource_android_voice_notes_with_free/) | Still removed by moderators | null | null | 1 | null | 0 | null | null |
| [apps / 1wyfpeu](https://www.reddit.com/r/apps/comments/1wyfpeu/android_vaulto_voice_notes_with_offline/) | Still removed by Reddit filters | null | null | 1 | null | 0 | null | null |

Views/ratio/shares/awards for the three non-removed posts are from freshly loaded
author Post Insights. Immediately preceding permalink headlines showed 132/25/25;
Insights showed 133/26/26. Our read-only checks may add views. Totals for these three:
185 views, +92 over their preceding journal snapshots, not 185 unique people or
installs. Own upvotes still selected on all six; do not count all displayed votes
as outside support. No human comments to answer. Droid's two comments remain
the Play-match bot and sticky checklist reminder; neither is organic engagement.

Hourly graphs lag headline totals: SideProject 92+29 vs 133; IMadeThis 12+9 vs 26;
alphaandbetausers 16 vs 26. Headline totals retained, graph's displayed +values are
not the historical delta calculated above.

Available country breakdowns (rounded by Reddit):
- SideProject: United States 32.3%, India 9%, United Kingdom 8.3%, other 50.4%.
- IMadeThis: United States 46.2%, Czechia 11.5%, Egypt 7.7%, other 34.6%.
- alphaandbetausers: United States 38.5%, South Korea 23.1%, France 19.2%, other 19.2%.

Independent public verification was attempted separately for every ID using fresh
unauthenticated web JSON requests and direct curl JSON requests. Web reader returned
cache miss for all six; direct requests returned HTTP 403 for all six. A separate
Incognito browser opened the SideProject permalink and displayed "Prove your
humanity" / reCAPTCHA before any post content. Challenge not interacted with;
temporary Incognito window closed. Public availability remains unverified rather
than inferred from the author's view or the view-count growth.

Indiehackers' previously verified AutoModerator reason remains the only specific
cause known: fewer than 10 comment karma within that subreddit. It is not evidence
of the causes for apps/droid filtering. No filtered post was restored in this check.
Store clicks, installs, activation, retained users and revenue remain unknown.
Keep the 24 h / 48 h checkpoints; no background monitoring scheduled.

## Follow-up attempt — 2026-10-06 ~06:22–06:28 UTC / ~09:22–09:28 Moscow

User requested fresh results and another acquisition-channel assessment; resumed
the interrupted work the following morning. No new posts, comments, messages,
account creation, subscriptions, ad spend or scheduling actions made.

### Availability and measurement limits

Native browser control is currently unavailable: Google Chrome attachment failed
with `Sky Computer Use native pipe startup failed`; a separate inventory call
returned apps=[], browsers=[] and the same native error. Therefore no signed-in
owner permalink or Post Insights was freshly read on 6 October.

Separate fresh unauthenticated curl requests to all six mobile JSON permalinks
returned HTTP 403. Web reader requests to the three previously non-removed posts
returned Internal Error. A search result exposed a title/body fragment for
alphaandbetausers 1wyfizr (labelled published today), but opening the result also
failed. That indexed fragment is evidence of indexing, not fresh live availability;
the relative publication label is not the actual submission timestamp. Search
absence for another post is not evidence of removal.

| Community / ID | Fresh public status | Fresh owner status | Views | Votes | Comments | Shares | Awards |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| SideProject / 1wyerii | Unverified, HTTP 403 / web error | Unavailable | null | null | null | null | null |
| IMadeThis / 1wyexi9 | Unverified, HTTP 403 / web error | Unavailable | null | null | null | null | null |
| alphaandbetausers / 1wyfizr | Unverified; indexed fragment only, HTTP 403 / web error | Unavailable | null | null | null | null | null |
| droidappshowcase / 1wyemer | Unverified, HTTP 403 | Unavailable | null | null | null | null | null |
| indiehackers / 1wyflgv | Unverified, HTTP 403 | Unavailable | null | null | null | null | null |
| apps / 1wyfpeu | Unverified, HTTP 403 | Unavailable | null | null | null | null | null |

Last confirmed owner snapshot remains 5 October ~18:40–18:43 UTC: three posts
without removal notices, views 133/26/26 (total 185), no human comments; three
removed/filtered. These values are historical, not today's measurement. No delta
can be computed for 6 October. Current restoration/removal/comment state unknown.

### Independently verified GitHub and Google Play

Fresh `gh repo view dirusanov/vaulto_note_mobile --json
url,isPrivate,stargazerCount,forkCount`: isPrivate=false, stars=0, forks=0.
This does not measure repository visitors or installs.

Fresh unauthenticated direct HTTP fetch (~06:24 UTC) of
https://play.google.com/store/apps/details?id=com.vaultonotemobile&hl=en&gl=US
returned live HTML, saved temporarily as /tmp/vaulto-play-20261006.html.
Extracted h1: `Vaulto: Private AI Voice Notes`; Play structured field 141 version
`1.0.90`, field 146 update date `Oct 5, 2026`; visible Downloads bucket `10+`.
This supersedes the old 1.0.89 availability observation for this US/en listing,
without replacing that publication-time fact. Web reader still returned a stale
three-week-old listing under the former title, and was not used as live evidence.
Exact installs, acquisitions by source, first use, retained users and revenue
remain unknown. Unchanged bucket cannot prove zero new installs.

### Next-channel preparation

Created local [next-channel assessment](next-channels.md) and
[Product Hunt field/assets kit](product-hunt.md). Recommendation: one separate
Product Hunt experiment, then user-written/manual Show HN if eligible; AlternativeTo
as slower catalogue placement. No guarantee of audience or installation counts.

Verified official PH guide, account wait and **Commenting Guidelines prohibition
on AI-generated comments**. Kit contains factual product fields and an outline,
not an AI-authored maker comment to submit. User must write that part themselves.
PH account eligibility and duplicate listing not checked: browser unavailable,
public search endpoint errored. No PH draft was created externally. Existing
real-screen assets identified; new 1270x760 gallery not rendered, preview pending.

AlternativeTo's current official FAQ reports several thousand pending applications
and no guaranteed free review time; optional $5 priority is review only, not approval
or ranking. No payment made. Draft uses clean dedicated URL fields, freemium and
GPL mobile-client qualification. F-Droid deferred: actual Android dependencies
include Google play-services-auth and play-services-auth-blockstore; no validated
FOSS variant exists from this research. HN's current Show HN restriction for newer
participants documented in its manual kit. Marketing files remain local/untracked.

### Brave retry — 2026-10-06 ~06:31–06:32 UTC / ~09:31–09:32 Moscow

User explicitly asked to try Brave Browser. Direct native attachment to
`Brave Browser` returned `Sky Computer Use native pipe startup failed`.
Reset the CUA session and retried the same app: identical error. Separate inventory
after the reset returned apps=[], browsers=[] with the native pipe error. No
browser content or account state was read; this is a computer-control connection
failure before Reddit navigation, not evidence of Brave being signed out or posts
being removed. No fresh owner metrics obtained; preceding unknown values remain
unknown. No new public-availability claim, posting, messaging or browser settings
change. Historical snapshots preserved.

## Recovered browser follow-up — 2026-10-06 ~06:39–06:50 UTC / ~09:39–09:50 Moscow

User restored the connection and requested another attempt. Native Brave attachment
now worked; SideProject freshly loaded in the author session with full text, no
removal notice, 248 headline views, score 2 (own vote active), 0 comments. Brave
tabs changed during the check, so continued the campaign in Chrome, whose native
connection now also worked. No claim about which repair step caused recovery.

### Fresh owner snapshot before replying (~06:41–06:43 UTC)

| Community / ID | Status | Insights views | Delta vs 5 Oct evening | Votes shown | Ratio | Comments | Shares | Awards |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SideProject / 1wyerii | Full body/video, no removal notice | 250 | +117 vs 133 | 2 | 100% | 0 | 1 | 0 |
| IMadeThis / 1wyexi9 | Full body, no removal notice | 47 | +21 vs 26 | 1 | 100% | 2 | 0 | 0 |
| alphaandbetausers / 1wyfizr | Full body, no removal notice | 51 | +25 vs 26 | 1 | 100% | 0 | 0 | 0 |
| droidappshowcase / 1wyemer | Still Reddit-filtered | null | null | null | null | 2, existing bots | null | null |
| indiehackers / 1wyflgv | Still moderator-removed | null | null | 1 | null | 0 | null | null |
| apps / 1wyfpeu | Still Reddit-filtered | null | null | 1 | null | 0 | null | null |

Total for the three non-removed posts: **348 views, +163** versus 185 on 5 October
evening. Not unique users, clicks or installs. Permalink headlines just before
Insights were 248/46/50; subsequent Insights 250/47/51. Our visits may contribute.
During later IMadeThis interaction its permalink showed 48 views; do not interpret
that extra visit as an acquired user. Own post votes remain active on these three.
Removed-post view counts unavailable, not zero. Indiehackers' specific known cause
remains the previously verified <10 subreddit comment karma threshold.

Country breakdowns, rounded by Reddit:
- SideProject: US 33.2%, India 7.2%, UK 6.8%, other 52.8%.
- IMadeThis: US 38.3%, Italy 8.5%, India 8.5%, other 44.7%.
- alphaandbetausers: US 54.9%, South Korea 11.8%, France 9.8%, other 23.5%.

### Separate public check

Opened a temporary Chrome Incognito window, with Log In/Sign Up visible and no
author session. **SideProject, IMadeThis and alphaandbetausers all rendered their
full original body and had no removal notice**. IMadeThis also rendered both
incoming comments. This establishes public availability for those three at this
check, superseding earlier failed attempts without rewriting their history.
SideProject's resulting address included `?captcha=1`, but full post/video content
loaded; no CAPTCHA was clicked or solved. Indiehackers separately rendered its
moderator-removal notice. Attempts at droid/apps did not yield a usable independent
observation; their removal is confirmed from the author view only in this snapshot.
Temporary Incognito windows created for this task were closed.

SideProject's copy still says current Play 1.0.89, which was true at publication;
the separately verified public store is now 1.0.90. Post was not edited this turn.
Store installs, activation, retention and revenue were not measured.

### Incoming comments and authorized engagement

Two substantive incoming IMadeThis comments, no bot/moderator label observed:

1. [AskliResearch / pe2vsn4](https://www.reddit.com/r/IMadeThis/comments/1wyexi9/comment/pe2vsn4/):
   suggests a narrower voice-to-action promise; walking → checklist, questions
   across old notes and useful exports; make local/cloud boundary explicit.
2. [investigatormaker / pe3x0ju](https://www.reddit.com/r/IMadeThis/comments/1wyexi9/comment/pe3x0ju/):
   asks for network-feature list, model download sizes, one-minute transcription
   timing on a mid-range phone, and the developer's most-used test phone.

Neither comment establishes that the author installed/tried Vaulto. Human identity
and comment-generation method not independently verified. These are useful discussion
signals, not evidence of two acquired users.

User explicitly asked to like and answer comments. Upvoted **both incoming comments**:
each changed from score 1 / own toggle 0 to score 2 / own toggle 1. Do not call the
score increase external engagement; it is the developer account's action.

Published two distinct replies as Random1k17 and verified their full text nested
under the correct parent comments in the author session. Owner comment total now
4 = 2 incoming + 2 own replies, not 4 organic comments.

Reply to AskliResearch — [pe67pcb](https://www.reddit.com/r/IMadeThis/comments/1wyexi9/comment/pe67pcb/):

> Thanks, the feature list does bury the basic flow. The one I'd like people to try first is a short voice note, then a checklist and a reminder. Markdown export is already there for taking the result elsewhere. Of those three workflows, which would you personally use most?

Reply to investigatormaker — [pe67tw2](https://www.reddit.com/r/IMadeThis/comments/1wyexi9/comment/pe67tw2/):

> Thanks. The network paths are model downloads, guest/account sessions, purchases, and sync if enabled. Cloud transcription/AI also sends the selected audio or text to the server; local inference runs on the phone. The breakdown is here: https://github.com/dirusanov/vaulto_note_mobile/blob/master/docs/PRIVACY.md
>
> For storage, the app lists Whisper downloads from about 75 MB to 2.9 GB and Qwen from about 530 MB to 2.7 GB, depending on the model. Those are model files, not total storage or RAM requirements.
>
> The published screens are from an Android emulator, so they don't establish real-phone timings. I'm checking the exact phone/model setup before quoting a device or a one-minute result.

Model-size labels checked directly in LocalWhisperService.ts and LocalLLMService.ts;
these are approximate catalogue labels, not fresh download/RAM measurements.
Network explanation and emulator provenance checked in public documentation.
Asked the user asynchronously for the actual test-phone model; answer pending.
No handset or benchmark invented. When that answer arrives, provide the missing
device detail in a follow-up, without claiming an unmeasured processing time.

Independent verification of **new replies** is still incomplete: Incognito deep
reply permalink showed Prove your humanity; no challenge interaction. A subsequent
base-page attempt did not produce a usable observation. Do not extend the earlier
public confirmation of the post/incoming comments to the newly published replies.
No private messages, additional campaign posts, spend or account changes made.

## Afternoon snapshot — 2026-10-06 ~11:10–11:28 UTC / ~14:10–14:28 Moscow

[Detailed review and dated measurements](2026-10-06-afternoon-review.md).
Fresh author Insights for original non-removed posts: SideProject 264 (+14 vs 250),
IMadeThis 68 (+21 vs 47), alphaandbetausers 58 (+7 vs 51): **390 (+42)**.
Scores 2/1/1 with own votes active, ratios 100%, comments 0/4/0, shares 1/0/0,
awards 0. IMadeThis's 4 comments remain 2 incoming + 2 own replies; no new incoming
discussion. Our visits may add views. Droid/apps still filtered, indiehackers removed;
droid's 2 comments remain bots. No removed posts restored. Separate public web
requests for original three returned cache miss; morning Incognito verification
remains their latest successful independent public check.

Play Console accessed for **com.vaultonotemobile**, separately from Cards. Public
Play US/en now 1.0.91, updated 6 October, 10+ bucket. Production 100% rollout,
new-release statistics not available. Selected Statistics range 8 Sep–5 Oct, but
Installed Audience latest filled row is **2 Oct, 3**; New User Acquisitions shows
**1 Oct, 2**. Grow overview last 28 days: 191 device impressions / 2 installs /
2 monthly active devices; first opens and D7 retention missing. Store-listings
last-28-day visitors=8, conversion missing. Dashboard revenue ~242 TRY over 28 days,
not campaign attribution; test/self purchases and financial-data freshness unknown.
User explicitly notes delayed updates: record missing dates as null, not zero;
do not infer campaign failure from 10+ bucket or pre-campaign data. Metric meanings
and PT dates verified in official Google help. Do not combine 90-day 26.92% summary
conversion with 28-day counts.

Fresh GitHub public, 0 stars/forks, pushed 2026-10-06T08:24:19Z. Read-only Traffic
API (sandbox network failed, approved GET retry succeeded): 22 Sep–5 Oct UTC window,
4 views / 2 uniques; 60 clones / 35 uniques. 5 Oct: 1 view / 1 unique, 59 clones /
34 uniques. Series contains no 6 Oct data. Unique cloners are not established human
app users; automation, CI and owner checks not separated. Whole-day counts are not
attributed to Reddit. Public website still shows 150 minutes/month, Custom API and
older Passphrase workflow; left untouched and documented. Existing screenshots
remain 1.0.87 with provenance, source/public store now 1.0.91.

### Seventh Reddit submission: r/AiNoteTaker / 1wz020s

Submitted ~11:23 UTC / ~14:23 Moscow (exact created_utc unavailable), distinct
text, **Product Listing**. Live rules and form allow maker/app links and demand
quality; author search found no earlier posts in the community. No fake review,
crosspost, fabricated phone/speed claim or voting request. Full actual text and
sources retained in [publication record](reddit-ainotetaker.md).

https://www.reddit.com/r/AiNoteTaker/comments/1wz020s/vaulto_for_android_turn_a_voice_note_into_tasks/

Fresh owner permalink full, no removal notice. Initial Insights: **2 views**,
1 own vote, 100%, 0 comments/shares/awards; owner checks may account for both views.
Separate Chrome Incognito checked ~11:25–11:26 UTC: Log In visible, full original
body/Product Listing, no removal. Automatic ?captcha=1 redirect but no CAPTCHA
interaction. **New post independently publicly confirmed.** Do not treat these
initial views as established outside users. No other new posts, replies, private
messages, account changes, ad spend, deployments or analytics SDK changes this turn.

Candidate rules: noteapps forbids self-promoted apps; ProductivityApps needs 10
community karma/one promo monthly and bans vibe-coded apps, eligibility not verified.
Continue with one channel experiment at a time; PH fields prepared, maker comment
human-written; HN manual only, as authorized. Next 24/48h snapshots conditional on
reports' actual date coverage; no automated monitoring created.

## Eighth Reddit submission — 2026-10-06 ~11:47–11:49 UTC / ~14:47–14:49 Moscow

User asked for another suitable community. Selected **r/localaiapps**, live 2.5K
weekly visitors/77 weekly contributions, local-device AI focus. Empty cached rules
JSON was insufficient on its own: read the live moderator sticky 1svjzx8 inviting
local tools, project/workflow sharing. Existing Android maker posts present;
author search found no prior Random1k17 posts in this community. r/localfirst
allows app sharing but is much smaller (137 weekly visitors/8 contributions),
so not used this turn. No fresh LocalAI/WhisperAI eligibility established.

Published ~11:47 UTC (exact created_utc unavailable), separate technical copy:
**Vaulto: Android voice notes with on-device Whisper and Qwen**.

https://www.reddit.com/r/localaiapps/comments/1wz0hpe/vaulto_android_voice_notes_with_ondevice_whisper/

Text only, no required flair. Owner permalink full, no removal notice. Initial
permalink 1 view; fresh Insights **2 views**, 1 own vote, 100% ratio, 0 comments,
shares and awards. Checks may account for both views; do not count as outside users
or aggregate them into the older 390-view comparison as established human reach.

Separate Chrome Incognito at ~11:48 UTC: Log In visible, full original body and
links, no removal notice. Automatic ?captcha=1 address, no CAPTCHA interaction.
**Independent public availability confirmed.** Temporary window closed after
verifying its target post/window. [Exact text and source checks](reddit-localaiapps.md).

Copy describes approximate Turbo/Qwen file sizes, model memory checks/context
release, Android Download Manager, free local processing and optional Pro cloud,
mobile GPL client vs separate backend. Source inspected; no physical phone/speed
benchmark claimed. No other new posts, messages, replies, votes, spend or code
changes this turn. Original campaign metrics not remeasured: the initial Brave/
Chrome Post Insights page was stale and was not recorded as a new snapshot.

## Results check — 2026-10-07 ~12:15–12:35 UTC / ~15:15–15:35 Moscow

[Detailed results, report date coverage and assessment](2026-10-07-results.md).
All eight owner permalinks freshly loaded; stale open Insights page excluded.

| Community / post | Author status | Views | Delta vs latest previous snapshot | Score | Ratio | Comments before this turn's reply | Shares | Awards |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SideProject / 1wyerii | Full, no removal notice | 281 | +17 vs264 | 2 | 100% | 0 | 1 | 0 |
| IMadeThis / 1wyexi9 | Full, no removal notice | 75 | +7 vs68 | 1 | 100% | 4 = 2 incoming + 2 own | 0 | 0 |
| alphaandbetausers / 1wyfizr | Full, no removal notice | 62 | +4 vs58 | 1 | 100% | 1 incoming | 0 | 0 |
| AiNoteTaker / 1wz020s | Full, no removal notice | 94 | +92 vs2 | 2 | 100% | 0 | 0 | 0 |
| localaiapps / 1wz0hpe | Full, no removal notice | 60 | +58 vs2 | 1 | 100% | 0 | 0 | 0 |
| droidappshowcase / 1wyemer | Still Reddit-filtered | null | null | null | null | 2 existing bots | null | null |
| indiehackers / 1wyflgv | Still moderator-removed | null | null | null | null | 0 | null | null |
| apps / 1wyfpeu | Still Reddit-filtered | null | null | null | null | 0 | null | null |

Views **572**, +178 vs sum of last five measurements (394), collected at different
times on 6 October, not one synchronized 24h baseline. Original three 418 (+28 vs390),
new two 154 (+150 vs4). Owner visits may add views; own post vote active. Headline
counts just before Insights 280/74/61/93/59 vs selected Insights 281/75/62/94/60.
No new IMadeThis replies, no comments in either newer community.

New alpha comment [peeuvvm](https://www.reddit.com/r/alphaandbetausers/comments/1wyfizr/comment/peeuvvm/)
by Ill_Grapefruit4644 reports trying a fake grocery list on Pixel7: transcription
good, task extraction expands buy milk → buy milk, milk, dairy. This is one
self-reported use, not independently confirmed install/retention. Mode/model/version
unknown. Liked under prior authorization (own vote0→1, visible score1→2) and replied
[peezu8b](https://www.reddit.com/r/alphaandbetausers/comments/1wyfizr/comment/peezu8b/)
~12:20 UTC; own reply full under correct parent. Asked local/cloud and chosen Qwen.
3 substantive incoming /3 own replies across campaign; bots separate. Full copy and
static triage in [feedback record](feedback-2026-10-07-task-extraction.md). No code
change, model generation, new physical-phone test or claimed fix. Concurrent billing
worktree edits untouched.

Separate public web reads of all five active IDs returned cache miss. Native
Incognito alpha permalink reached **blocked by network security**, before content,
after website's automatic JS challenge. No CAPTCHA/challenge/File-a-ticket action;
challenge tokens not retained in journal. Temporary window closed. Today's independent
public availability, including new reply, **unverified**; prior 6 October successful
public checks remain historical, not evidence of today's state.

Fresh public Play US/en1.0.91, updated6Oct, bucket10+. Console Statistics range9Sep–6Oct,
Installed Audience latest row **3Oct=3** (prior2Oct3); New User Acquisitions visible
**1Oct=2**, missing days not zero. Grow Last28:184 device impressions/2 installs/2
monthly active devices; first opens/D7 unavailable. Store Listings actual URL range
**7Sep–4Oct**,8 visitors, conversion missing; Last updated2Oct is listing metadata.
Store/installation report coverage still predates campaign5–6Oct, so no install
conversion/retention/revenue attribution established. Rolling-window impressions
184 vs191 not treated as lost campaign traffic. No finance report re-read today.

GitHub fresh public0stars/forks. Traffic window23Sep–6OctUTC: views4/uniques2,
clones85/uniques47; 6Oct0views,25clones/14uniques. No7Oct row. Automation/CI/human
identity unknown; not Android users/installs. All preceding GitHub snapshots preserved.

Assessment: modest reach, useful initial feedback and one reported use. Strong
acquisition/retention and scalable promotion not demonstrated; data lag prevents
quantifying installs. Next experiment should add a real phone workflow/benchmark
and investigate the reported task expansion. No new announcements, private messages,
spend/account/deployment changes or background monitoring this turn.


## Feedback consolidated for future work — 7 October 2026

At the user's request created [docs/USER_FEEDBACK.md](../../docs/USER_FEEDBACK.md)
and added a read-before-improvement instruction to mobile AGENTS.md. Captures
three incoming sources: pe2vsn4, pe3x0ju and peeuvvm. The first two are suggestions/
questions; peeuvvm explicitly reports a Pixel 7 trial with accurate transcription
but an expanded checklist result. Not independent install/retention verification.
Fresh unauthenticated source pages display all three incoming comments. The
Pixel 7 source page also displays our existing peezu8b reply; AskliResearch's page
displays our existing pe67pcb reply. No public confirmation for pe67tw2 is inferred.
The earlier detailed task-extraction report is preserved and linked, not replaced.

Document records original links, excerpts, proposed improvements, priorities,
reproduction needs and open details. No new responses/votes, public issues, source
changes, model tests, release or attribution assertions were made in this task.


## Reply check after engagement request — 7 October 2026, ~15:41 Moscow

User authorized useful replies to support the Reddit account. Fresh signed-out
reads of the three known source threads showed the existing Pixel 7 reply peezu8b
and AskliResearch reply pe67pcb in public. Both already thank the author and ask a
specific follow-up question; no new response from either author in the loaded
threads. No duplicate gratitude/update message was sent. investigatormaker's
existing pe67tw2 is recorded as sent in the author journal but still not publicly
confirmed by these reads; no blind repost attempted. No new likes or metric claims.

Next useful response depends on a new answer (mode/model, preferred workflow) or
a verified reproduction/fix. The documented backlog alone is not an implemented
fix and no release timing or real-phone benchmark was promised.


## Combined campaign review attempt — 2026-10-07 20:03 UTC / 23:03 Moscow

User requested a combined promotion and usage review. Read historical journals and
7 October reports. Current session exposes no browser-control tools or owner Console
access. Web reader could not fetch Cards SideProject, mobile alphaandbetausers or
Store/Play listings. Direct unauthenticated requests for seven active Reddit posts,
Play, Chrome Store, GitHub and Cards health failed DNS in the network sandbox.
This is an access limitation, not evidence of removal or product downtime.
No fresh views, installs, retention, revenue or backend activity measured: all
current values unavailable, not zero. Earlier afternoon measurements remain dated.
No posts, messages, votes, app changes or diagnostic generation performed.


## Fresh browser review — 2026-10-07 23:13 Moscow

Observed through newly navigated Chrome pages after Apple Events JavaScript became available.
Owner Reddit Insights are fresh; read-only visits can contribute views.

| Product/community | Views | Delta vs prior confirmed | Upvotes shown | Comments | Shares | Awards |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Mobile SideProject | 281 | 0 | 2 | 0 | 1 | 0 |
| Mobile IMadeThis | 79 | +4 | 1 | 4 | 0 | 0 |
| Mobile alphaandbetausers | 63 | +1 | 1 | 2 | 0 | 0 |
| Mobile AiNoteTaker | 104 | +10 | 2 | 0 | 0 | 0 |
| Mobile localaiapps | 74 | +14 | 1 | 0 | 0 | 0 |
| Cards SideProject | 146 | +38 vs 5 Oct108 | 1 | 0 | 0 | 0 |
| Cards chrome_extensions | 98 | +63 vs 5 Oct35 | 1 | 0 | 0 | 0 |

Mobile total601 (+29 vs572, 7 Oct afternoon). Cards244 (+101 vs143, 5 Oct).
All measured ratios100%. Own votes were recorded as active previously; shown
votes are not established outside-only votes. No organic new user count inferred.

Fresh owner permalinks show original body without removal notice for five main
mobile posts and both Cards posts. droidappshowcase/apps still Reddit-filtered;
indiehackers still moderator-removed. Their Insights say Unauthorized access,
metrics remain null. Incoming comments unchanged: IMadeThis2 incoming+2 own,
alpha1 incoming+1 own. No new response to our follow-up questions. Pixel7 trial
is still one self-reported use, not independently measured retention.

Separate newly opened Chrome Incognito pages hit CAPTCHA/network security for
four mobile posts and both Cards posts; localaiapps produced no readable body.
No challenges interacted with. Today's independent public availability remains
unverified. Temporary Incognito window closed.

## Play Console: com.vaultonotemobile

Correct package verified on live dashboard. App list installed audience3, no
date displayed there. Last28 dashboard/grow:2 installs,2 monthly active devices,
184 device impressions; first opens and D7 retention unavailable.
Statistics selected9Sep–6Oct, Installed Audience metric. Table uses an empty
rendered canvas in DOM; exact daily filled rows could not be read. Previous
3Oct=3 remains a historical result, not a freshly verified daily row.

Store-listings actual URL range7Sep–4Oct: overall reach13 visitors,3 unique
users who clicked Install,CTR23%; default-listing table8 visitors and conversion
unavailable. These are distinct UI metrics, not contradictory counts. Do not
compare install clicks with completed installations or mix with90-day24% summary.
This selected store range predates campaign5–6Oct; post-campaign installations,
activation and retention remain unquantified. No current exact new-install
count attributed to Reddit. No finance report remeasured.

GitHub unauthenticated API: mobile public0stars/0forks; Cards release archive1
download, matching known agent verification. No fresh production trial-count
query performed; 0 non-diagnostic requests from afternoon remains historical.
Health request to /health returned404 (wrong/unverified endpoint); do not call
that product downtime or replace previous successful health check.

No publications, replies, votes, purchases, app code changes or model generations.
Snapshots and evidence appended; Cards SQLite synchronized.


## Channel research — 2026-10-07T20:17:08.796945+00:00

Rechecked official PH/AlternativeTo/HN guidance and live localfirst community
page. Updated next-channels.md with fresh601view baseline and channel priorities.
No new publication, metric snapshot, account, message or spending.


## Product Hunt launch preparation — 2026-10-07T20:23:36.865757+00:00

User authorized trying Product Hunt. Chrome home initially looked signed out
before hydration, then existing profile@random1k11 and Submit appeared. No
registration/sign-in flow performed. Live submission form accepted Play URL;
name/tagline/369-character description filled, open-source checkbox selected,
GitHub URL added. Search Vaulto yielded other products, no exact match on first
page; external indexed search found no match, not exhaustive duplicate proof.
Launch tags picker rendered no options after Android/Productivity search;
Next step disabled. User asked asynchronously for manual tags selection and
a personally written first comment. Official commenting rule rechecked:
https://help.producthunt.com/en/articles/10030102-commenting-guidelines
AI-generated comments prohibited; no generated comment filled.
Three1270x760 real-screenshot gallery images prepared in product-hunt-assets,
with original1.0.87 disclosure; not uploaded yet. No completed saved external
draft or published listing verified, no launch date chosen. Existing measurements
unchanged. Continue from browser submission; don't recreate or claim publication.


## Product Hunt draft saved — 2026-10-07T20:31:40.969460+00:00

User requested completing everything else, leaving own comment to fill personally.
Tags picker recovered using ordinary DOM mousedown; Android/Open Source selected,
GitHub tag added by site's source-link handling. Productivity not selected.
Uploaded icon plus three real-screenshot1270x760 gallery images; displayed image
URLs confirmed on saved product page. isMaker=true for existing@random1k11;
pricing=free_options. Shoutouts/investor form/funding/promo left blank.
Clicked Create draft, then independently navigated Edit Launch and read persisted
fields. Saved product URL:https://www.producthunt.com/products/vaulto-3?launch=vaulto-3
Edit URL:https://www.producthunt.com/posts/vaulto-3/edit
Owner page explicitly says draft and not scheduled. commentBody empty as intended.
Not a published/scheduled campaign placement;0followers on owner page is not reach.
No public availability assertion, first comment, review, votes or launch date.
Saved draft evidence:product-hunt-assets/saved-draft-check.json.


## Three-community publication preparation — 2026-10-07 ~20:34 UTC / 23:34 Moscow

User explicitly authorized publication to sideprojects, AIToolBench and
AppsWebappsFullstack with existing media, and requested parallel agent review.
Three agents reviewed copy/claims, media provenance and official rules.
Prepared kit: publication-kit-3-communities.md; media: publication-assets/.
These are prepared entries, not actual published placements. No permalink,
views, public availability or new installs exist for these entries; unavailable
metrics remain unknown, not zero. Existing snapshots preserved.

Execution blocked: no callable browser/computer tool exposed in this session.
Chrome Apple Events attempts failed (connection invalid; explicit application
path returned execution error -10827). No post submitted, no account creation,
no private messages or spending, no browser security challenge interacted with.
Uneed free submission also not made; save and Join the line are distinct steps.
Latest official Uneed help says maximum five-month queue; earlier 30-day minimum
is not confirmed by that current source. Reddit rules reviewed via web-reader
with cache 1–4 weeks; live composer/sidebar/account eligibility unverified.

Resume from the prepared kit when browser control is available. Before each
submission check duplicates, actual media/body support and required flair.
After submission record actual text, permalink, time and owner status, then
check signed-out public availability separately. Do not count this queue as
three published posts or transfer these mobile records into Cards SQLite.


## Product Hunt reviewed and scheduled — 2026-10-07T20:36:08.079609+00:00

User explicitly authorized careful review and publication if ready. Reviewed
persisted name/tagline/description/source boundary, paid-with-free-plan pricing,
maker@random1k11 and thumbnail/3gallery assets. Existing real-screen images were
visually inspected during preparation;1.0.87 provenance printed, no speed claim.
Changed GitHub launch tag to Productivity; final Android/Open Source/Productivity
saved and reloaded. Public GitHub API/rawREADME200, GPL3client/license verified.
Fresh Play Chrome page correct package/title, install CTA, updated6Oct and10+;
no install action. Direct Play HTML parser lacked title; not treated as downtime.

Site offers future scheduling, earliest8October. Clicked8Oct then Update. UI
confirmed Scheduled, persisted after fresh navigation to edit page:
**8October2026 00:01PDT =07:01UTC =10:01Europe/Moscow**.
Earlier commentary rounded midnight to10:00; explicit UI time10:01is authoritative.
No immediate daily-feed launch claimed and no guarantee of homepage featuring.

Product page:https://www.producthunt.com/products/vaulto-3
Edit:https://www.producthunt.com/posts/vaulto-3/edit
Separate fresh Chrome Incognito shows Sign in, exact Vaulto tagline/description
and Play/GitHub links: basic product page independently publicly accessible now.
This does not establish feed launch before scheduled time; generic Launched in2026
label not treated as actual launch confirmation.0followers are baseline, views/
installs/revenue unavailable. Public incognito gallery not confirmed from DOM.

Author first comment remains absent, per user opting to write personally and
Product Hunt AI-generated-comment rule. It is recommended but did not block
scheduling. No invented testimonials, shoutout reviews, investor contacts,
votes, ad spend or new app release. Temporary Incognito closed after check.
Evidence:product-hunt-assets/scheduled-launch-check.json.


## Browser diagnosis handoff — 2026-10-07 20:44 UTC / 23:44 Moscow

User asked to preserve all work for the next agent. Complete handoff saved as
AGENT_HANDOFF_BROWSER_AND_PUBLICATIONS.md and linked from PROMOTION_MEMORY.md.
Three prepared Reddit posts remain unpublished; no new metrics or placements.
User confirms ordinary Terminal open -a "Google Chrome" works, unlike agent
execution. Executables for Chrome, Brave, Safari and System Settings exist;
agent launch fails -10827, direct Chrome launch has permission denials, log tool
says Cannot run while sandboxed. GUI launchctl domain exists. Likely sandbox/
execution-context issue; exact cause of changed availability unknown. No browser
reinstall, system reset, process termination or sandbox bypass performed.


## New mobile Reddit placement — 2026-10-07T21:04:36.015000+00:00 / 2026-10-08T00:04:36.015000+03:00

Published r/AIToolBench post1x08awu: https://www.reddit.com/r/AIToolBench/comments/1x08awu/voice_notes_with_local_whisper_and_qwen_on/
Three real screenshot cards with source-version disclosure, tailored body,
developer+AI-assistance disclosure. Claims/copy/media reviewed by3agents,
with final community-specific recheck. Fresh owner page full/no removal notice;
independent unauthenticated web reader full/Log In/no removal. Incognito CAPTCHA
untouched. Initial owner Insights1view/1vote/100%/0comments/0shares/0awards;
own vote/check visits included, no outside-user attribution.
Actual UTC7Oct21:04:36.015, Moscow8Oct00:04:36.015.
Detailed record:2026-10-07-aitoolbench/publication.md; exact copy/assets/snapshots
in that directory. Sideprojects attempts remain uncompleted (required flair
not applied), video upload stuck85%; no sideprojects permalink/publication.
AppsWebappsFullstack only rules inspected; unsent. ProductHunt remains scheduled
8Oct10:01Moscow. No new private messages, votes, spend or product changes.


## Mobile published r/AppsWebappsFullstack — 2026-10-08T09:22:58.654000+03:00

https://www.reddit.com/r/AppsWebappsFullstack/comments/1x0jld6/vaulto_an_android_app_for_turning_voice/
Actual UTC:2026-10-08T06:22:58.654000+00:00. Three real screenshot cards plus full reviewed
body. Owner intact, fresh independent public web reader intact/Log In/no removal.
Initial owner Insights1view/1own-included vote/100%/0comments/shares/awards.
Checks may account for views; campaign installs/retention/revenue unknown.
Exact text/assets/verification:vaulto_note_mobile/marketing/2026-10-launch/2026-10-08-appswebappsfullstack/publication.md.


## Mobile published r/sideprojects — 2026-10-08T09:25:36.687000+03:00

https://www.reddit.com/r/sideprojects/comments/1x0jmtl/i_built_an_android_app_that_turns_voice_notes/
Actual UTC:2026-10-08T06:25:36.687000+00:00. Three real screenshot cards plus full reviewed
body. Owner intact, fresh independent public web reader intact/Log In/no removal.
Initial owner Insights1view/1own-included vote/100%/0comments/shares/awards.
Checks may account for views; campaign installs/retention/revenue unknown.
Exact text/assets/verification:vaulto_note_mobile/marketing/2026-10-launch/2026-10-08-sideprojects/publication.md.


## Remaining placement queue completed — 2026-10-08T06:31:55.073602+00:00

All3authorized prepared Reddit communities now have actual placements:
AIToolBench1x08awu(previous turn),sideprojects1x0jmtl,AppsWebappsFullstack1x0jld6.
Flair blocker resolved by focus+click ordinary Add operation with validation.
Prior attempts preserved. ProductHunt fresh editor still Scheduled8Oct00:01PDT
=10:01Moscow. No immediate-feed publication claim before then.

Uneed anonymous preview prepared from correct PlayURL but account required to
save/schedule. Scraped broad privacy tagline must be replaced with kit copy
after sign-in. Preview is not a saved draft, queue entry or public card.
AlternativeTo signed out; login modal offeredGoogle/GitHub/Apple/email.
Neither catalogue submitted, no account created or subscription/payment made.
Account/login information requested asynchronously; no answer yet.
Concrete fields saved directory-submission-kit.json. No HN automated posting
or generated maker comment. No SDK/product/deployment changes.


## New-post follow-up — 2026-10-08 09:57 Moscow / 2026-10-08T06:57:40.536718+00:00 UTC

Fresh navigation to3owner permalinks and their Insights. All bodies intact,
no removal notice.

| Post | Views | Delta vs initial1 | Comments | Independent public check now |
| --- | ---: | ---: | ---: | --- |
| sideprojects / 1x0jmtl | 19 | +18 | 0 | unverified_captcha |
| appsweb / 1x0jld6 | 14 | +13 | 0 | available_no_removal_notice |
| aitoolbench / 1x08awu | 48 | +47 | 0 | unverified_captcha |

Total81views,+78versus combined initial3. Not unique viewers/installs; own
checks may add views. Each shows1upvote including own,100%ratio,0shares/awards.
No incoming discussion in these3posts yet.

AppsWebappsFullstack freshly signed out with Log In/full body/no removal.
Sideprojects and AIToolBench fresh Incognito show CAPTCHA; untouched. Web reader
returned readable copies, but old relative ages2m/4m versus live30m/33m demonstrate
caching for two newest posts; not treated as fresh availability confirmation.
Previous successful public verifications remain historical. No removal inference
from CAPTCHA. ProductHunt newly navigated owner product page still Scheduled
8Oct00:01PDT=10:01Moscow,upvoting disabled,0followers/0comments; no view count
exposed. Generic Launched in2026label doesn't override scheduled state.

No posts/replies/votes/edits/spend or catalogue submissions in this check.
Snapshots appended, old values retained. Evidence:vaulto_note_mobile/marketing/2026-10-launch/followups/20261008T065740Z/.


## Results follow-up — 2026-10-09 14:03 Moscow

## Reddit

| Community/post | Fresh views | Delta vs previous recorded | Comments total | Shares |
| --- | ---: | ---: | ---: | ---: |
| sideprojects / 1x0jmtl | 104 | +85 | 0 | 0 |
| appsweb / 1x0jld6 | 86 | +72 | 0 | 0 |
| aitoolbench / 1x08awu | 114 | +66 | 1 | 0 |
| mobile_sideproject / 1wyerii | 291 | +10 | 0 | 1 |
| imadethis / 1wyexi9 | 104 | +25 | 5 | 1 |
| alpha / 1wyfizr | 90 | +27 | 2 | 0 |
| ainotetaker / 1wz020s | 128 | +24 | 0 | 0 |
| localaiapps / 1wz0hpe | 104 | +30 | 0 | 0 |

New3posts304views versus81on8Oct09:57Moscow(+223):sideprojects104(+85),
AppsWebappsFullstack86(+72),AIToolBench114(+66). Original5posts717views
versus601on7Oct23:10Moscow(+116). All8total1021; previous682baseline combines
different dates, not synchronized24h. Views not unique people or installations;
read-only checks can add views. Shown votes2/1/1/2/1for original5,1eachnew3,
all100%ratio; own votes included. No awards.

All8owner permalinks freshly loaded with full bodies/no removal notice.
Droid/apps remain Reddit-filtered,indiehackers moderator-removed. Fresh signed-out
Incognito3newposts+alpha all CAPTCHA; untouched. Web reader results explicitly
crawled yesterday/relative2m–4m, so not reused as current public confirmation.
Today's independent Reddit public status remains unverified; no removal inferred.

Two newly recorded incoming comments:
- [NeuralNomad87](https://www.reddit.com/r/AIToolBench/comments/1x08awu/comment/pepe2p0/): Qwen model download size and whether task extraction is suitable for a mid-range phone or flagship only.
- [befittingswimmer66](https://www.reddit.com/r/IMadeThis/comments/1wyexi9/comment/pekzb1c/): Free local processing trust, first-run local/cloud clarity, find an old half-formed idea using a vague question weeks later. Suggested sync-only privacy phrase is incomplete because cloud AI can also transmit selected input.

IMadeThis5comments=3incoming+2own,alpha2=1incoming+1own,AIT1incoming.
Campaign5substantive incoming comments/3own replies; bots separate. Pixel7
is still the only explicit reported trial. These new comments do not establish
installs/use/retention. No new answer from Pixel7 author to mode/model question.

## Product Hunt

Public nativeIncognito confirmsLaunched this week,1point,1follower,0comments,
correctPlay/GitHub links; no scheduled warning or voting-disabled text. Owner
launch-day dashboard showsposition344,1point,0comments,Notable votersRobertG
(NextGenTools). Owner product page saysUpvoted, so own-vote active; point count
not an outside-user/installation counter. Voter identity/trial not established.
No views exposed in inspected UI. Actual timestamp not independently recovered;
previous scheduled8Oct10:01Moscow remains schedule history. Makercomment absent.

## Google Play

Correctcom.vaultonotemobile. Fresh dashboard/growLast28shows2installs/2monthly
active devices,189device impressions; firstopens/D7missing. Summary not attributed
to campaign. Statistics selected11Sep–8Oct,InstalledAudience; dailytableDOMempty
ESS canvas width0,filleddates unreadable. Tried ordinary export dropdown/focus/
mouse/keyboard/table scrolling; no readable export options/download generated.
No private app-state/API access or browser security changes. Selected range
is not evidence all dates are filled.

Store-listings effective selectedURLrange8Sep–5Oct:12visitors,3uniqueInstall
clickusers,CTR25%. This selected report does not cover newer7–8Oct Reddit/PH
placements. Rolling changes13→12visitors or184→189impressions are not campaign
gains/losses. Default-listingtable unreadable. No campaign conversion, retained
users or revenue measured. No install attribution or zero-installs claim.

Assessment: modest reach and additional interest/questions, but strong acquisition
or repeat usage remains unproven. ProductHunt launch has very limited visible
engagement. Preserve catalogue status: Uneed/AlternativeTo not submitted.
No new posts, replies, likes, paid actions, accounts, deployments or SDK changes.

Evidence/report: vaulto_note_mobile/marketing/2026-10-launch/followups/20261009T110321Z/results.md


## Unanswered-comment check — 2026-10-09T11:19:43.253135+00:00

Freshly loaded8active Reddit threads andProductHunt.2unanswered sources:

1. [NeuralNomad87 /pepe2p0](https://www.reddit.com/r/AIToolBench/comments/1x08awu/comment/pepe2p0/): direct question about
Qwen download sizes and mid-range/flagship performance. No own reply present.
Public raw catalogue checked:0.8B~530MB,2B~1.3GB,4B~2.7GB; model files,
not RAM/total storage. Device timing/quality benchmark still absent.
2. [befittingswimmer66 /pekzb1c](https://www.reddit.com/r/IMadeThis/comments/1wyexi9/comment/pekzb1c/): onboarding boundary
and finding old ideas via vague questions. No own reply present. Preserve
local/cloud/sync distinction; don't repeat inaccurate sync-only privacy phrase
or claim the proposed retrieval test was performed.

Both incoming comments independently readable through unauthenticated web
reader today. New responses prepared in prepared-replies.json, **not sent**.
Readability verified in author UI as well. Existing AskliResearch/investigatormaker
comments already have pe67pcb/pe67tw2 answers. Pixel7 comment already has
peezu8b; no answer to mode/model question yet. Don't send duplicate thanks.
Original developer test-phone question remains incompletely answered because
handset/benchmark information still missing, not a reason to invent it.

Other5active Reddit threads have no incoming comments. PH says Be the first
to comment; no incoming response to answer. Makercomment still absent,
user-written per PH rule. No posts, replies, likes, tests or product changes
performed in this inspection. Both sources already in USER_FEEDBACK.md.

Evidence: vaulto_note_mobile/marketing/2026-10-launch/reply-checks/20261009T111943Z/.


## Authorized comment replies — 2026-10-09T11:31:05.136635+00:00

- [NeuralNomad87: t1_petsd7o](https://www.reddit.com/r/AIToolBench/comments/1x08awu/comment/petsd7o/) — parent t1_pepe2p0, 2026-10-09T14:27:52.457000+03:00 Moscow.
- [befittingswimmer66: t1_petsj7d](https://www.reddit.com/r/IMadeThis/comments/1wyexi9/comment/petsj7d/) — parent t1_pekzb1c, 2026-10-09T14:28:54.153000+03:00 Moscow.

Exact approved drafts posted, not rewritten. Correct author/parent/body verified
after loading returned reply permalinks. Both also publicly readable through
unauthenticated web reader with Log In and exact own reply text. No CAPTCHA
interaction or likes of incoming comments. No duplicates. Own comment votes
are platform defaults, not organic engagement.

Neural reply gives source-checked approximate catalogue file sizes, distinguishes
storage/RAM/Whisper, no invented mid-range benchmark, asks phone/RAM. Befit reply
records untested retrieval scenario, explains local/cloud/sync separately, asks
preferred retrieval result. No claim of implemented fix/new release.

Campaign substantive incoming comments remain5; own replies now5 (+2), bots
separate. No new post/campaign placement, app change, test, SDK, spending or
ProductHunt comment. Prepared-replies.json remains historical prepared state;
sent-replies.json records completed transition.

Browser note: verified document.visibilityState visible before commenting.
Native Chrome tab IDs compare as text; earlier numeric loop didn't activate
the intended tab. Used literal tab indices9/10 and verified visible. Reply
action rows mounted then. Focus actual submit button before click so the
custom form honors its validation. No private handlers/API or validation bypass.

Evidence: vaulto_note_mobile/marketing/2026-10-launch/reply-checks/20261009T113105Z/.
