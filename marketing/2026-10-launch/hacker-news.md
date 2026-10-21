# Hacker News — комплект для ручной публикации

Подготовлено 5 октября 2026. Не опубликовано. Пользователь просил оставить
проверку, редактуру и нажатие кнопок ему.

## Важное правило площадки

[HN Guidelines](https://news.ycombinator.com/newsguidelines.html) запрещают
автоматическую публикацию, сгенерированный и отредактированный ИИ текст.
Поэтому черновик ниже — справочный материал, не готовый текст для вставки:
написать финальную версию самостоятельно, своими словами. Не отправлять этот
документ целиком и не ограничиваться косметическими правками.

## Поля формы

- Форма: https://news.ycombinator.com/submit
- Тип: Show HN. [Правила Show HN](https://news.ycombinator.com/showhn.html).
- URL: https://github.com/dirusanov/vaulto_note_mobile
- Вариант заголовка для ориентира: **Show HN: Vaulto – Android voice notes with on-device Whisper and Qwen**
- Для публикации ссылки поле text оставить пустым; вводный рассказ разместить
  отдельным авторским комментарием после отправки. В URL нет трекинга.

GitHub выбран потому, что там можно сразу посмотреть код, реальные экраны,
лицензию и границы приватности, а из README перейти в Google Play.

## Справочный черновик вводного комментария

I’m the developer of Vaulto, an Android voice-notes app. I’ve just made the mobile client public under GPLv3.

It takes a recording, turns it into text, and lets you clean up the note, extract tasks and reminders, or ask questions about saved notes. Local transcription uses Whisper and local AI uses Qwen through React Native bindings. Both run on the phone after downloading the models.

Local notes don’t require an account, and on-device transcription and AI are free. There’s also optional cloud processing and a paid subscription for cloud allowances and sync features. The hosted backend isn’t part of this source release.

I’ve tried to make the privacy boundaries explicit in the repository. On-device inference, encrypted sync and cloud AI are separate paths: cloud AI receives the input it processes, even if encrypted sync is enabled. The README links to the relevant implementation.

The practical trade-off is storage and device performance. Models need an initial download, and inference speed depends on the phone. The README animation is a tour of real screenshots, not a latency demo. There hasn’t been an independent security audit or a reproducible-build verification of the Play binary.

The Android app is available here: https://play.google.com/store/apps/details?id=com.vaultonotemobile

I’d be interested in hearing how people use voice notes after recording them, and which parts of the local processing or sync implementation need a clearer explanation.

## Проверенные факты для собственного текста

- Публичный мобильный репозиторий; GPL-3.0-only. Сервер отдельно.
- Android-приложение доступно в Google Play, текущая проверенная версия 1.0.89.
- Whisper и Qwen3.5 выполняют выбранную локальную обработку на устройстве.
- Локальные заметки, транскрипция и AI доступны без подписки и без аккаунта.
- Модели сначала скачиваются; занимают память; скорость зависит от телефона.
- Облачная обработка получает выбранное аудио/текст. Загрузка моделей,
  гостевые сессии, покупки и аккаунт могут использовать сеть.
- E2EE относится к синхронизируемому содержимому в этом режиме, не к облачному AI.
- Картинки реальные, версия экранов 1.0.87; ролик — монтаж, не непрерывный тест.
- Независимый аудит, точное соответствие бинарника исходникам и превосходство
  над конкурентами не установлены. Число активных пользователей неизвестно.

## Перед нажатием Submit

1. Написать собственный заголовок и комментарий; раскрыть, что это твой проект.
2. Проверить, что GitHub и Play открываются без твоего аккаунта.
3. Войти в существующий HN-аккаунт; не создавать новый ради продвижения.
4. Отправить один Show HN и собственный вводный комментарий. Не перезаливать
   при слабой реакции, не просить голосовать, не придумывать отзывы пользователей.
5. Сохранить ссылку вида `https://news.ycombinator.com/item?id=…` в analytics.md.
6. Быть готовым самому отвечать на технические вопросы. Снять показатели
   через 24–48 часов: score, comments, публичная доступность. Показатели просмотров
   и установки не выводить из голосов.

## Короткие ссылки для ответов

- Архитектура приватности: https://github.com/dirusanov/vaulto_note_mobile/blob/master/docs/PRIVACY.md
- Сборка: https://github.com/dirusanov/vaulto_note_mobile/blob/master/docs/DEVELOPMENT.md
- Лицензия: https://github.com/dirusanov/vaulto_note_mobile/blob/master/LICENSE
- Локальная транскрипция: https://github.com/dirusanov/vaulto_note_mobile/blob/master/src/services/LocalWhisperService.ts
- Локальный AI: https://github.com/dirusanov/vaulto_note_mobile/blob/master/src/services/LocalLLMService.ts
- Синхронизация: https://github.com/dirusanov/vaulto_note_mobile/blob/master/src/services/SyncService.ts

## Дополнение — 6 октября 2026

Предыдущая версия 1.0.89 выше — факт проверки 5 октября. Свежий прямой
публичный HTTP-запрос Google Play для US/en ~09:24 Москва уже показывает
**1.0.90**, обновлённую 5 октября; диапазон загрузок всё ещё 10+.
Точные новые установки и активные пользователи неизвестны.

[Официальная страница ограничения Show HN](https://news.ycombinator.com/showlim)
сейчас сообщает о временном ограничении для пользователей, ещё не знакомых
с площадкой. Конкретный порог возраста/кармы не указан. Перед запуском
проверить допуск своего существующего аккаунта; не обходить ограничение
новым аккаунтом или выдуманной активностью. Публикация по-прежнему ручная,
финальный заголовок и комментарий писать самостоятельно.
