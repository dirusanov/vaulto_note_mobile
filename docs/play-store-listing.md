# Google Play: страница приложения и Data safety

Тексты сверены с кодом версии 1.0.83: только то, что приложение реально умеет.
Ограничения, которые нельзя обещать: запись до 5 минут (не «лекции»), тегов нет,
end-to-end шифрование синхронизации включается пользователем (не по умолчанию).

---

## 1. Data safety (Безопасность данных)

### Шаг «Сбор и безопасность данных»

| Вопрос | Ответ |
|---|---|
| Собирает ли приложение пользовательские данные или передаёт их третьим лицам? | **Да** |
| Все ли данные шифруются при передаче? | **Да** (только HTTPS, `src/utils/env.ts` запрещает http в релизе) |
| Можно ли запросить удаление данных? | **Да** — в приложении (Настройки → Удалить аккаунт) и по ссылке `https://vaultonote.com/delete-account` |
| Способы входа | Имя пользователя и пароль, Google (OAuth), другие (гостевой режим без аккаунта) |

### Шаг «Типы данных»

Ничего не **передаётся третьим лицам**: RevenueCat, облачный AI-провайдер и хранилище
S3 работают как обработчики данных от имени разработчика — Google это передачей не считает.
Нет рекламы, нет аналитики, нет SDK отчётов о сбоях.

| Категория → тип | Собирается | Временно (ephemeral) | Обязательно? | Цели |
|---|---|---|---|---|
| Личная информация → **Адрес электронной почты** | Да | Нет | Необязательно (можно пользоваться без аккаунта) | Функциональность приложения, Управление аккаунтом |
| Личная информация → **Имя** | Да | Нет | Необязательно | Управление аккаунтом |
| Личная информация → **Идентификаторы пользователя** | Да | Нет | Необязательно | Функциональность приложения, Управление аккаунтом |
| Финансовая информация → **История покупок** | Да | Нет | Необязательно | Функциональность приложения, Управление аккаунтом |
| Аудио → **Голосовые или звуковые записи** | Да | Нет (хранятся при синхронизации) | Необязательно (расшифровка может идти на телефоне, синхронизацию можно выключить) | Функциональность приложения |
| Действия в приложении → **Другой пользовательский контент** (тексты заметок) | Да | Нет (хранятся при синхронизации) | Необязательно | Функциональность приложения |
| Идентификаторы устройства → **Идентификаторы устройства или другие** | Да | Нет | Обязательно (гостевая сессия по ключу устройства) | Функциональность приложения, Предотвращение мошенничества (лимиты бесплатного тарифа) |

Почему так, по коду:
- e-mail, имя — регистрация и вход (`src/api/auth.ts`), передаются в RevenueCat (`SubscriptionContext.tsx`: `setEmail`, `setDisplayName`).
- идентификатор устройства — `authApi.anonymousAuth(deviceId)` для гостей (`AuthContext.tsx`).
- аудио — облачная расшифровка (`TranscriptionService.ts`) и синхронизация записей в S3 (`SyncService.ts`; без E2EE файл грузится как есть).
- тексты заметок — синхронизация (`api/notes.ts`) и AI-функции (`AIService.ts`). Без E2EE сервер хранит их с серверным шифрованием, поэтому «временная обработка» здесь неприменима.
- **Не указываем**: заметки и аудио при включённом E2EE (разработчик не может их прочитать — Google разрешает не декларировать), локальные данные, которые не покидают телефон, данные on-device AI.

### Значки
- «Независимая проверка безопасности» — нет (пока нет MASA-аудита).

---

## 2. Тексты страницы

### English (en-US, default)

**App name (30):**
```
Vaulto: Private AI Voice Notes
```

**Short description (80):**
```
Speak, get clean text. AI voice notes that work offline and stay private.
```

**Full description:**
```
Talk. Vaulto turns it into clean, organized notes — and keeps them private.

Vaulto is a voice notes app with AI for people who think faster than they type. Record a thought, a to-do list or a plan, and get readable text in seconds. AI can tidy it up, pull out tasks and answer questions about everything you've saved.

Unlike most AI note apps, Vaulto can run completely on your phone. Speech-to-text and the AI model work offline, in airplane mode, without a single word leaving your device.

🎙 VOICE TO TEXT IN SECONDS
• Tap the mic, speak, done — accurate transcription in 99 languages
• Free unlimited on-device transcription (Whisper) — no internet needed
• Live dictation right inside a note
• Agent mode: say "make this a shopping list" and get a checklist

✨ AI THAT WORKS FOR YOU
• Fix grammar, summarize, make it professional, simplify, structure — one tap
• Your own AI instructions: "shorter, with a to-do list"
• Find tasks: pulls action items and deadlines out of a note and adds them to your calendar
• Ask your notes: chat with everything you've written, with links to the source notes
• Every AI edit is saved as a version — compare with the original and switch back anytime

🔒 PRIVATE BY DESIGN
• Offline AI on your phone: nothing is sent anywhere
• Optional end-to-end encrypted sync — only you hold the key, not us
• Protected notes never leave the device unencrypted
• App lock with fingerprint or face unlock
• No ads. No tracking. No selling your data.

📝 A CALM, FOCUSED EDITOR
• Rich text, headings, checklists and Markdown
• Fast search across all notes and versions
• Pin notes, dark theme, tablet layouts
• Share as text, Markdown or image
• 10 interface languages, including right-to-left Arabic

PERFECT FOR
• Capturing ideas while walking or driving
• To-do lists, shopping lists and plans in one breath
• Journaling and daily reflections
• People with ADHD who lose thoughts before they can type them
• Anyone who wants AI without giving their notes to the cloud

Free to start: on-device transcription and offline AI are free. Vaulto AI Pro adds more cloud transcription minutes, more cloud AI and unlimited encrypted sync.

Your thoughts belong to you.
```

**Release notes (What's new):**
```
• Tablet layouts and rotation support
• Dark theme, undo for deletes, haptics
• Offline AI on your phone: transcription, AI edits and chat with your notes without internet
• Find tasks: deadlines from your notes straight to your calendar
```

### Русский (ru-RU)

**Название (30):**
```
Vaulto: голосовые заметки с ИИ
```

**Краткое описание (80):**
```
Говорите — получайте текст. ИИ-заметки работают офлайн и остаются приватными.
```

**Полное описание:**
```
Говорите — Vaulto превращает речь в аккуратные заметки и хранит их приватно.

Vaulto — голосовые заметки с ИИ для тех, кто думает быстрее, чем печатает. Надиктуйте мысль, список дел или план и через пару секунд получите читаемый текст. ИИ приведёт его в порядок, найдёт задачи и ответит на вопросы по всем вашим заметкам.

В отличие от большинства ИИ-приложений, Vaulto может работать целиком на телефоне. Распознавание речи и ИИ-модель работают офлайн, даже в авиарежиме, и ни одно слово не покидает устройство.

🎙 ГОЛОС В ТЕКСТ ЗА СЕКУНДЫ
• Нажали на микрофон, сказали — готово. Точная расшифровка на 99 языках
• Бесплатная безлимитная расшифровка на телефоне (Whisper), без интернета
• Диктовка прямо в заметку
• Режим агента: скажите «сделай из этого список покупок» — получите чек-лист

✨ ИИ, КОТОРЫЙ ПОМОГАЕТ
• Исправить ошибки, сократить, сделать деловым, упростить, структурировать — в одно касание
• Свои инструкции для ИИ: «короче и со списком дел»
• Поиск задач: находит дела и сроки в заметке и добавляет их в календарь
• Вопросы по заметкам: чат по всему, что вы записали, со ссылками на источники
• Каждая правка ИИ сохраняется как версия — сравните с оригиналом и вернитесь в любой момент

🔒 ПРИВАТНОСТЬ ПО УМОЛЧАНИЮ
• ИИ на телефоне работает офлайн — ничего никуда не отправляется
• Синхронизация со сквозным шифрованием (включается в настройках) — ключ только у вас, даже мы не можем прочитать заметки
• Защищённые заметки никогда не покидают устройство в открытом виде
• Блокировка приложения отпечатком пальца или лицом
• Без рекламы, без слежки, без продажи данных

📝 СПОКОЙНЫЙ РЕДАКТОР
• Форматирование, заголовки, чек-листы и Markdown
• Быстрый поиск по всем заметкам и версиям
• Закрепление заметок, тёмная тема, режим для планшетов
• Отправка текстом, в Markdown или картинкой
• 10 языков интерфейса

ДЛЯ ЧЕГО
• Записывать идеи на прогулке или за рулём
• Списки дел и покупок, планы — на одном дыхании
• Дневник и ежедневные заметки
• Людям с СДВГ, которые теряют мысль, пока её печатают
• Всем, кто хочет ИИ, но не хочет отдавать свои заметки в облако

Начать можно бесплатно: расшифровка на телефоне и офлайн-ИИ бесплатны. Vaulto AI Pro добавляет больше минут облачной расшифровки, больше облачного ИИ и безлимитную зашифрованную синхронизацию.

Ваши мысли принадлежат только вам.
```

---

## 3. Скриншоты (подписи и порядок)

Рамка Android (без Dynamic Island и «9:41»), актуальный интерфейс 1.0.83.

| # | Заголовок EN | Подзаголовок EN | Что на экране |
|---|---|---|---|
| 1 | Speak. It's text. | Voice to clean text in seconds | Список заметок + панель записи (новые переключатели «To text / Agent») |
| 2 | Works in airplane mode | Transcription and AI run on your phone | Экран «On-device models»: Whisper + Qwen «Ready · works offline», значок авиарежима в статус-баре |
| 3 | Ask your notes | Answers from everything you've written | Чат «Ask your notes» с ответом и номерами источников |
| 4 | Tasks from your voice | Deadlines go straight to your calendar | Лист «Find tasks» с датами |
| 5 | Clean it up with AI | Fix, summarize, restructure — one tap | Лист AI-правок (текущий скриншот 3, новый UI) |
| 6 | Only you hold the key | Optional end-to-end encrypted sync | Настройки: E2EE On, App lock |
| 7 | Every edit is a version | Compare with the original anytime | Версии + сравнение (diff) |
| 8 | Dark theme & tablets | — | Тёмная тема на планшете |

Feature graphic: добавить плашку «Works offline» рядом с «Voice → text», «Encrypted».

Локализовать скриншоты минимум для: ru, es, pt-BR, hi, de.

---

## 4. Прочее в Console
- Категория: **Productivity** (сейчас Tools).
- Теги: Notes, Voice recorder, Productivity.
- Данные разработчика: проверить адрес (индекс 184592 — российский, страна указана Kyrgyzstan) и имя латиницей.
- Ссылка на удаление аккаунта (Контент приложения → Удаление аккаунта): `https://vaultonote.com/delete-account`.
