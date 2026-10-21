# Product Hunt — подготовка карточки

6 октября 2026. Только локальный комплект: карточка не создана на площадке,
публикация и дата запуска не назначены. Доступ к личному аккаунту неизвестен;
Chrome сейчас недоступен. Поиск дубликата через веб-инструмент не завершился,
поэтому отсутствие существующей карточки не подтверждено.

## Поля

| Поле | Подготовленное значение |
| --- | --- |
| Product name | Vaulto |
| Tagline | Turn voice notes into text, tasks and reminders |
| Primary URL | https://play.google.com/store/apps/details?id=com.vaultonotemobile |
| Download URL | https://play.google.com/store/apps/details?id=com.vaultonotemobile |
| Source URL, если есть отдельное поле | https://github.com/dirusanov/vaulto_note_mobile |
| Pricing | Paid with a free plan: локальная обработка бесплатная, дополнительные Pro-функции платные |
| Status | Available; это публичное Android-приложение, не закрытая beta |
| Topics, если доступны | Android, Productivity, Open Source |
| Maker | Настоящий личный аккаунт разработчика; username требуется проверить |
| Promo | Пусто: промокоды/скидки не создавались |

Description, максимум 260 символов:

> Record a thought, transcribe it, and turn it into tasks and reminders. Whisper and Qwen run on your Android phone after model download. Local processing is free. Optional Pro features add cloud allowances and sync. The mobile client is GPLv3.

## Картинки и показ продукта

Готовые реальные экраны и логотип уже есть; AI-макеты интерфейса не нужны.
Проверенные файлы внутри репозитория:

- Иконка: `store/google-play/icon_512x512.png` — 512×512, ~20 KB.
- Запись: `store/google-play/_src/raw/en/01_record.png`.
- Задачи: `store/google-play/_src/raw/en/04_tasks.png`.
- Локальные модели: `store/google-play/_src/raw/en/02_offline.png`.
- GIF-обзор: `docs/media/app-tour.gif` — 880×550, ~707 KB.
- MP4-обзор: `docs/media/app-tour.mp4` — монтаж отдельных экранов, не live demo.

Для начала использовать 3 статичных реальных экрана. В форме проверить их
предпросмотр: рекомендуемый формат PH — 1270×760, эти экраны портретные.
Если форма/предпросмотр требует горизонтальный формат, разместить исходный
экран целиком на горизонтальном холсте, без обрезки и перерисовки содержимого.
Новая горизонтальная галерея здесь не отрендерена. Нужны минимум 2 изображения.
512×512 иконка квадратная; рекомендуемый thumbnail PH — 240×240.

Не использовать существующий баннер «in seconds» как доказательство скорости:
измерений на актуальном устройстве нет. Версия реальных экранов — 1.0.87;
нынешняя публичная Play-версия — 1.0.90, интерфейс может отличаться.
GIF можно предложить форме только если поддерживается формат галереи.
Для видео PH поддерживает YouTube-ссылку; MP4 ещё никуда не загружен.
Отсутствие видео не должно задерживать запуск с понятными скриншотами.

## Первый авторский комментарий

[Commenting Guidelines](https://help.producthunt.com/en/articles/10030102-commenting-guidelines)
запрещают AI-generated comments: «No LLMs or Chrome extensions please!».
Поэтому готового сгенерированного комментария для вставки здесь нет.
Разработчик пишет его самостоятельно; ответы в обсуждении тоже человеческие.

Факты и вопросы для собственного рассказа:

- Это твой проект; мобильный клиент недавно опубликован под GPLv3.
- Сценарий: запись → текст → задачи/даты → напоминание. Можно спрашивать заметки
  и экспортировать Markdown. Выбери один пример из своего реального опыта.
- Локальная обработка бесплатная, сначала скачать модели. Локальные заметки
  без аккаунта; память и скорость зависят от устройства.
- Облачный AI получает выбранные входные данные; encrypted sync — отдельный
  путь. Сервер не опубликован, независимого аудита нет.
- Полезный вопрос: какую голосовую заметку человек действительно захотел
  превратить в задачу и что помешало завершить этот сценарий?

Не придумывать историю «я постоянно забывал...» и отзывы первых пользователей,
если такого опыта нет. Не просить голосовать или оставлять отзыв в Play.

## Порядок

1. Найти Vaulto/Vaulto Note и `vaultonote.com` в PH, исключить дубликат.
2. Проверить существующий личный аккаунт и допуск к публикации. Для новых
   аккаунтов обычное ожидание — неделя. Не подписывать пользователя на рассылку
   ради ускорения и не создавать аккаунт автоматически.
3. Внести поля, прикрепить изображения, проверить внешний вид и сохранить draft.
4. Самостоятельно написать первый комментарий. Выбрать день, когда можно
   отвечать людям. Проверить часовой пояс расписания прямо в форме; не переводить
   слово PST из справки механически на московское время во время перехода DST.
5. После публикации открыть страницу без аккаунта и записать точное время/URL
   в `analytics.md`; через 24/48 часов добавить новый снимок результатов.

Нанимать hunter не требуется. Запуск без аудитории допустим как эксперимент,
но попадание на главную, место в рейтинге и число установок не гарантированы.
Массовые сообщения, координированные голоса и награды за голос запрещены.

Источники, проверены 6 октября:

- [Форма и материалы](https://help.producthunt.com/en/articles/479557-how-to-post-a-product).
- [Допуск аккаунта](https://help.producthunt.com/en/articles/481909-how-can-i-get-access-to-post).
- [Распространение ссылки](https://help.producthunt.com/en/articles/2690626-how-do-i-share-my-post).
- [Причины удаления](https://help.producthunt.com/en/articles/484940-why-are-posts-removed).

## Дополнение — 6 октября, ~14:10–14:28 Москва

Упомянутая выше Play-версия 1.0.90 — утренняя проверка. Свежая публичная
US/en страница теперь показывает **1.0.91**, обновлённую 6 октября. Версия
скриншотов остаётся 1.0.87; после удаления Agent chip и изменений настроек в
1.0.91 различия особенно заметны. Не выдавать обзор скриншотов за актуальный
непрерывный запуск или измерение скорости.

Основной URL карточки заменён на прямую страницу продукта в Google Play.
Сайт всё ещё показывает 150 минут/месяц, custom API и прежний сценарий
Passphrase; пока его копирайт не сверили, удобнее направлять новых людей
сразу на установку. Исходники/границы приватности остаются в GitHub.
Внешний PH draft и комментарии не создавались; допуск аккаунта неизвестен.
Подробности — [дневной отчёт](2026-10-06-afternoon-review.md).


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
