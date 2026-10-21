# Следующие каналы — 6 октября 2026

Новых публикаций сегодня не сделано. Это выбор следующего эксперимента и
подготовленные материалы, а не отчёт о запусках. Проверка: ~09:22–09:26 Москва.

## Что дают текущие результаты

Последний доступный замер Reddit — 5 октября, 21:40–21:43 Москва:
SideProject 133 просмотра, IMadeThis 26, alphaandbetausers 26. Всего 185;
человеческих комментариев нет, у SideProject один share. Три других поста
были удалены/отфильтрованы. Это пока небольшой охват без подтверждённого
привлечения пользователей. Повторная рассылка того же предложения по Reddit
не проверит, нужен ли людям продукт, и может столкнуться с теми же фильтрами.

6 октября свежий замер заблокирован: подключение к Chrome не стартует,
публичные JSON-запросы ко всем шести постам возвращают HTTP 403. Поисковик
показывает фрагмент alphaandbetausers, но актуальная доступность и статистика
из этого не следуют. Сегодняшние значения — неизвестны, не нули.

Свежие проверяемые данные: GitHub публичный, 0 stars / 0 forks; Google Play
для US/en показывает 1.0.90, обновление 5 октября, диапазон 10+ загрузок.
Из диапазона нельзя посчитать прирост за кампанию или установки из Reddit.

## Порядок запуска

| Приоритет | Канал | Что проверяем | Следующее действие |
| --- | --- | --- | --- |
| 1 | Product Hunt | Понятен ли практический сценарий голос → текст → задачи аудитории новых продуктов | [Карточка и материалы](product-hunt.md); проверить существующий личный аккаунт и дубли, выбрать день, когда можно отвечать |
| 2 | Show HN | Интерес к локальному Whisper/Qwen и открытому мобильному клиенту | [Ручной комплект](hacker-news.md); пользователь пишет финальный текст и отправляет сам |
| 3 | AlternativeTo | Длительный поиск альтернатив голосовым заметкам и транскрипции | Подать бесплатную карточку с полями ниже; не считать её быстрым источником трафика |

Product Hunt — моя рекомендация для следующего отдельного эксперимента;
прогноз числа установок отсутствует. HN можно сделать раньше, если аккаунт
уже допускает Show HN и есть время на техническое обсуждение. У HN сейчас
действует [ограничение Show HN для новых/неосвоившихся участников](https://news.ycombinator.com/showlim);
публичного числового порога там нет. Не создавать аккаунты/фиктивную активность
для обхода ограничений.

Основное предложение: записать мысль и получить заметку, задачи и напоминания.
Приватность и GPLv3 подкрепляют доверие. Обещание уникальной приватности или
превосходства над другими локальными AI-приложениями не подтверждено.

## Карточка AlternativeTo

[Официальный FAQ](https://alternativeto.net/faq/) проверен 6 октября.
Нужен аккаунт с подтверждённым email; подача через Suggest new application.
Обычная очередь — несколько тысяч заявок без гарантии срока. Ускоренная
проверка стоит $5 и не гарантирует одобрения; здесь выбираем бесплатную,
расходов не разрешено и не сделано. До одобрения карточка видна только автору.
Описание без ссылок; отдельные URL-поля — без UTM. Не размещать рекламу в профиле.

| Поле | Значение |
| --- | --- |
| Name | Vaulto |
| Website | https://vaultonote.com |
| Google Play | https://play.google.com/store/apps/details?id=com.vaultonotemobile |
| Source | https://github.com/dirusanov/vaulto_note_mobile |
| Platform | Android; публичный iOS-релиз не подтверждён |
| Pricing | Freemium: основной локальный сценарий бесплатный, дополнительные Pro-функции платные |
| Open source | GPL-3.0-only, мобильный клиент; hosted backend отдельно |
| Suggested tags | voice-notes, note-taking, speech-to-text, offline, reminders |

Short description:

> Android voice notes with on-device transcription, tasks and reminders.

Description:

> Vaulto records voice notes and turns them into editable text. It can summarize a note, extract tasks and dates, set reminders, and answer questions about saved notes. Notes can be exported as Markdown.
>
> Local transcription uses Whisper and local AI uses Qwen. Both run on the phone after an initial model download. Local notes and on-device processing are free and do not require an account. Models take storage, and performance depends on the phone.
>
> Optional cloud processing sends the selected audio or text to a server. Pro subscriptions add cloud allowances and sync features. The mobile client is published under GPLv3; the hosted backend is maintained separately.

Открытый код сам по себе не гарантирует одобрения. FAQ также допускает отказ
приложениям с недостаточными отличиями и простым оболочкам над AI. В карточке
показывать реальный сценарий заметок, задач и напоминаний; не маскировать AI
и не подавать приложение как замену всем функциям Notion/Obsidian. Конкретные
связи «альтернатива X» выбирать после проверки основного сценария X.

## Что пока отложить

F-Droid подходит по аудитории, но требует отдельной работы над сборкой.
[Политика включения](https://f-droid.org/en/docs/Inclusion_Policy/) требует
свободных зависимостей. В текущем клиенте есть Google Sign-In; его Android
Gradle подключает `com.google.android.gms:play-services-auth:21.4.0`, а
`android/app/build.gradle` — `play-services-auth-blockstore:16.4.0`.
Нет проверенной сборки без этих зависимостей. Нужны отдельный FOSS-вариант,
проверка остальных транзитивных библиотек/моделей и воспроизводимая инструкция.
Не объявлять приложение доступным в F-Droid и не откладывать органический
запуск ради этого проекта.

В privacy-сообществах ограничения на саморекламу уже проверены в
[журнале дополнительных Reddit-публикаций](additional-reddit.md).
Не повторять туда посты только потому, что предыдущие отфильтрованы.

## Измерение следующего эксперимента

1. До запуска сохранить дату, точную ссылку, текст и доступные исходные метрики.
2. Делать площадки последовательно с интервалом хотя бы сутки: это удобнее
   для ответа на вопросы и сравнения, но само по себе не доказывает атрибуцию.
3. Через 24/48 часов записать публичную доступность, охват если доступен,
   комментарии людей и содержательные проблемы при попытке использования.
4. Если доступна Play Console, отдельно посмотреть приобретения и источники
   трафика за эти даты. Сейчас такого доступа нет. Не внедрять SDK и не
   выдавать просмотры за установки. Для AlternativeTo использовать чистый URL.
5. Проверить, дошёл ли хотя бы один новый человек до записи/локальной обработки
   и вернулся ли к заметке. Это можно узнать из добровольного ответа; просить
   описать результат, а не присылать личную запись или ставить оценку в магазине.

Начальная цель эксперимента: получить 3 содержательных ответа от новых людей
о реальном использовании. Это выбранная цель, а не ожидаемый или уже полученный
результат. Платную рекламу и массовые личные сообщения не запускали.


## Revised priorities — 7 October 2026 (2026-10-07T20:17:08.796945+00:00)

Fresh campaign baseline: mobile601views,3incoming substantive comments,1 reported
Pixel7 trial; installs and retention attributed to promotion remain unknown.
Website updated7Oct; earlier website objections above are historical.
No new post or external draft sent during this research.

1. Product Hunt: next larger standalone experiment. Existing local kit available.
   Official posting guide freshly rechecked: personal account/onboarding, self-post
   allowed, direct product URL and Play download link, logo/gallery/pricing.
   Check account eligibility and duplicates before creating/publishing a launch.
   User-written maker comment per existing kit; no promises of exposure/installs.
2. Reddit localfirst: small topical follow-up candidate, not a volume channel.
   Fresh author-view community page contains maker posts and on-device audio
   transcription example. This does not establish all current rules or permission
   to post. Recheck rules and account duplicates before submission.
3. AlternativeTo: directory experiment for later discovery. Official FAQ freshly
   rechecked: verified email, Suggest new application, free queue several thousand
   entries/no timing guarantee. No paid review authorized or made.
4. Show HN: manual user-written submission, local client/GPL/Whisper/Qwen focus.
   Official guidelines freshly checked; applicable HN AI-text and automation ban
   retained. Eligibility check needed.

Recommended creative: show one actual voice-to-task workflow on a physical phone,
with model/download requirements and honest timing. Existing GIF is screenshot
tour, not physical-phone benchmark. A useful grocery task extraction issue has
been reported; avoid selecting or promising an unverified correct output.
Short video can be reused on own social accounts as another experiment, without
guaranteeing reach. Do not wait for perfect metrics to perform one distinct test.
Evaluate voluntary completion/feedback and later dated Play acquisition data;
post views, GitHub clones and install clicks are not completed installations.

Fresh official sources:
- https://help.producthunt.com/en/articles/479557-how-to-post-a-product
- https://help.producthunt.com/en/articles/484940-why-are-posts-removed
- https://alternativeto.net/faq/
- https://news.ycombinator.com/showhn.html
- https://news.ycombinator.com/newsguidelines.html
