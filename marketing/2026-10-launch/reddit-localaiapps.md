# r/localaiapps — 6 октября 2026

Следующее сообщество выбрано по просьбе пользователя продолжить продвижение.
Пост отправлен примерно **11:47 UTC / 14:47 Москва**, точное created_utc неизвестно.

- https://www.reddit.com/r/localaiapps/comments/1wz0hpe/vaulto_android_voice_notes_with_ondevice_whisper/
- Автор `u/Random1k17`, текст без вложений. Категория не требовалась.
- Авторская страница: полный текст, без удаления.
- Начальные Insights: **2 views**, 1 собственный голос, 100% ratio,
  0 comments/shares/awards. Наши проверки могли дать оба просмотра.
- Отдельная публичная проверка **~11:48 UTC / ~14:48 Москва**: Chrome Incognito,
  Log In видна, полный текст и ссылки, без уведомления об удалении. Автоматический
  переход с `?captcha=1`; CAPTCHA не нажималась и не решалась. Наше временное
  приватное окно затем закрыто, остальные окна пользователя не закрывали.

## Выбор площадки

Живая аудитория r/localaiapps: **2.5K weekly visitors / 77 weekly contributions**.
Описание — локальные AI-приложения, работа приватно на своих устройствах.
Кешированный rules JSON пустой, но это не использовалось как разрешение само
по себе: прочитан живой закреплённый пост модератора
[Introduce Yourself and Read First](https://www.reddit.com/r/localaiapps/comments/1svjzx8/welcome_to_rlocalaiapps_introduce_yourself_and/).
Он приглашает делиться local AI tools, приложениями, своими setup/workflows и
проектами. В ленте есть объявления разработчиков и Android-приложения.
Поиск `author:Random1k17` внутри сообщества не нашёл прежних постов перед отправкой.

r/localfirst также прямо приглашает делиться подходящими приложениями, но живая
аудитория лишь **137 weekly visitors / 8 weekly contributions**. Оставлен как
небольшой запасной канал; сегодня туда не отправляли. r/WhisperAI по предыдущей
проверке мал, свежую аудиторию не снимали; новый веб-запрос правил не удался.
r/LocalAI свежий веб-запрос возвращает 403; новых действий там не сделано.

## Фактически отправленный текст

Title:

> Vaulto: Android voice notes with on-device Whisper and Qwen

Body:

> I'm the developer of Vaulto, an Android notes app with local speech-to-text and AI. Whisper transcribes the recording; Qwen can clean up the text, extract tasks or answer questions about saved notes.
>
> The models are downloaded after installation, not bundled into the app. For a sense of storage, Whisper Turbo is listed at about 547 MB and Qwen3.5 2B at about 1.3 GB. Those are file sizes; running them needs additional RAM. There are smaller and larger options, with availability based on the phone's memory.
>
> The client checks model fit and releases model contexts when switching between transcription and AI. Model downloads on Android use the system Download Manager. The mobile source is public under GPLv3, including the model selection and local/cloud routing code.
>
> Local notes and on-device processing are free and don't need an account. Optional Pro features add cloud processing and sync. Cloud AI receives the input it processes, and local inference doesn't disable other network features such as model downloads and account services. The hosted backend isn't in the public repo.
>
> Source and data-flow notes: https://github.com/dirusanov/vaulto_note_mobile
>
> Android app: https://play.google.com/store/apps/details?id=com.vaultonotemobile
>
> If you've run speech-to-text plus an LLM locally on Android, which phone and model combination worked well for you? I'd also like feedback on the model setup in Vaulto. The README tour is made from emulator screenshots, so it isn't a phone performance test.

Это отдельный текст для технической аудитории, не повтор текста AiNoteTaker.
Размеры, контексты и память сверены с LocalWhisperService.ts, LocalLLMService.ts
и DeviceCapabilities.ts; Download Manager — с Android ModelDownloadModule.kt.
Это описание исходников/каталога моделей, не гарантия отсутствия OOM или
эмпирический benchmark. Замеры на физическом телефоне не выдумывались.

Публикация продолжает ранее разрешённое самостоятельное продвижение в Reddit.
В этом запросе отправлен один новый пост. Личные сообщения, расходы, повторные
публикации удалённых постов, ответы и голосования за чужие записи не выполнялись.
Следующий замер — через 24/48 часов; автоматическое наблюдение не создано.
