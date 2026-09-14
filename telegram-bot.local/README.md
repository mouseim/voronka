# Telegram runtime для VORONKA_BOT

Локальный backend исполняет `.funnel 3.0.0` из конструктора, хранит данные в
PostgreSQL и работает через Telegram Bot API. VK в этом этапе не используется.

Папка называется `telegram-bot.local`; имя сохранено для совместимости с
существующими Docker-путями. Исходники, миграции и тесты входят в репозиторий,
а `.env`, зависимости, сборка, база и токены исключены точными правилами
корневого `.gitignore`.

## Что реализовано

- long polling для локальной разработки и webhook для production;
- неизменяемые версии `.funnel`, draft/publish/rollback и default-воронка;
- привязка сессии к версии до конца прохождения;
- все 12 типов блоков, переменные, условия и общий scoring из `../src/model`;
- значения переменных в сессии и подстановка `{{variable_key}}` в тексты;
- tracking `/start <code>`, повторный вход и обязательный `/stop`;
- тесты, формы, согласия, тихие часы, таймеры и durable reminders;
- image, video, audio, voice, video note, document и animation через `file_id`;
- mock, Telegram Stars и ЮKassa через Telegram Payments;
- идемпотентные updates, callback, оплаты и выдача;
- Telegram‑админка, CSV, `.funnel` со снимком аналитики и audit log;
- `/health/live`, `/health/ready` и безопасный redirect endpoint.

## 1. Создать бота через BotFather

1. Откройте официальный аккаунт `@BotFather`.
2. Отправьте `/newbot`.
3. Задайте отображаемое имя и username, оканчивающийся на `bot`.
4. Скопируйте токен. Не отправляйте его в чат и не коммитьте.
5. Токен вставьте в `TELEGRAM_BOT_TOKEN` файла `.env`.

Команды бот зарегистрирует сам при запуске. Для получения своего числового ID
запустите бота с пустым `ADMIN_TELEGRAM_IDS`, отправьте ему `/whoami`, внесите
полученное число в `.env` и перезапустите.

Чтобы заявки приходили в отдельную группу:

1. Добавьте бота в группу.
2. Отправьте в группе `/chatid`.
3. Внесите показанный отрицательный ID в `APPLICATIONS_CHAT_ID`.

## 2. Самый простой локальный запуск через Docker

Нужен Docker Desktop. В терминале:

```bash
cd /Users/maksimsinkov/Documents/VORONKA_BOT/telegram-bot.local
cp .env.example .env
```

Откройте `.env` и минимум заполните:

```dotenv
TELEGRAM_BOT_TOKEN=123456:секретный_токен
ADMIN_TELEGRAM_IDS=
POSTGRES_PASSWORD=voronka
DATABASE_URL=postgresql://voronka:voronka@postgres:5432/voronka
BOT_MODE=polling
```

Затем:

```bash
docker compose up -d --build
docker compose logs -f bot
```

После `/whoami` добавьте ID:

```dotenv
ADMIN_TELEGRAM_IDS=123456789
```

Несколько администраторов указываются через запятую. Перезапуск:

```bash
docker compose restart bot
```

Проверка состояния:

```bash
curl http://localhost:8080/health/live
curl http://localhost:8080/health/ready
```

Остановка без удаления базы:

```bash
docker compose down
```

Полностью удалить локальную PostgreSQL-базу можно только явной командой
`docker compose down -v`. Она необратимо удаляет локальные данные.

## 3. Локальный запуск Node.js без контейнера для бота

PostgreSQL всё равно должен быть доступен. Node.js нужен версии 22 или новее.

```bash
cd /Users/maksimsinkov/Documents/VORONKA_BOT/telegram-bot.local
cp .env.example .env
npm ci
npm run migrate
npm run dev
```

Если PostgreSQL поднят контейнером, а бот запускается на Mac, используйте:

```dotenv
DATABASE_URL=postgresql://voronka:voronka@localhost:5432/voronka
```

## 4. Загрузить первую воронку

Production-путь:

1. Отправьте боту `/admin`.
2. Нажмите «Импорт».
3. Отправьте `demo-7-mehanizmov-v3.funnel` или экспорт конструктора как
   Telegram document.
4. Откройте версию → «Файлы» и загрузите обязательные материалы.
5. Настройте каждый продукт командой `/product`.
6. Нажмите «Проверить».
7. Опубликуйте версию.
8. Сделайте опубликованную воронку default.

### Перепривязка Telegram media после смены bot token

Telegram `file_id` принадлежит боту, который получил файл. После смены
`TELEGRAM_BOT_TOKEN` старые идентификаторы нельзя конвертировать или переносить.
Runtime проверяет media активных версий через `getFile` при старте и пишет
предупреждение без самого `file_id`. Для каждого отмеченного asset откройте
`/admin` → воронка → версия → «Файлы» → asset → «Заменить» и отправьте исходный
файл новому боту. «Тестовая отправка» позволяет проверить привязку. Эта операция
заменяет только Telegram-привязку: VK media, версии, сессии, статистика и платежи
не меняются.

### Обязательные события VK Long Poll

Для текстов нужны `message_new=1`, а для inline callback-кнопок —
`message_event=1`. Runtime проверяет оба флага при старте и пишет warning, но не
меняет настройки сообщества автоматически. Безопасная команда для включения
нужных событий (запускайте в доверенном shell, где переменные уже загружены):

```bash
curl --fail-with-body --silent --show-error -X POST https://api.vk.com/method/groups.setLongPollSettings \
  --data-urlencode "group_id=$VK_GROUP_ID" \
  --data-urlencode "access_token=$VK_GROUP_TOKEN" \
  --data-urlencode "v=$VK_API_VERSION" \
  --data-urlencode "api_version=$VK_API_VERSION" \
  --data-urlencode "enabled=1" \
  --data-urlencode "message_new=1" \
  --data-urlencode "message_event=1"
```

Токен не подставляйте в команду вручную и не публикуйте ответ API вместе с
секретами.

Для быстрого локального demo с mock‑оплатой и разрешёнными текстовыми
заглушками:

```bash
cd /Users/maksimsinkov/Documents/VORONKA_BOT/telegram-bot.local
npm run migrate
npm run seed:demo
```

Seed не создаёт реальные платежи и не загружает фиктивные Telegram `file_id`.

## 5. Настройка продуктов и оплаты

Общий формат:

```text
/product VERSION_ID PRODUCT_ID TYPE PROVIDER CURRENCY AMOUNT_MINOR [ASSET_ID1,ASSET_ID2]
```

`AMOUNT_MINOR` — сумма в минимальных единицах валюты. Для RUB `149000` означает
1490,00 ₽.

### Mock

Только локально и в CI:

```text
/product VERSION_ID product_report digital mock RUB 149000 asset_guide
```

Оплата сразу считается успешной, реального списания нет.

### Telegram Stars

Для цифровых товаров и услуг внутри Telegram:

```text
/product VERSION_ID product_report digital telegram_stars XTR 250 asset_guide
```

Provider token не нужен. Сумма — целое число Stars. Бот проверяет
`pre_checkout_query`, принимает только совпадающую сумму/валюту и выдаёт
материал после `successful_payment`.

### ЮKassa

Подходит для физических товаров, офлайн‑услуг и иных разрешённых Telegram
сценариев. Цифровую выдачу внутри Telegram через ЮKassa runtime блокирует.

1. В `@BotFather`: `/mybots` → бот → Payments → подключите ЮKassa.
2. Полученный provider token внесите в:

```dotenv
TELEGRAM_PAYMENT_PROVIDER_TOKEN=секретный_provider_token
```

3. Настройте продукт, например:

```text
/product VERSION_ID consultation service yookassa RUB 500000
```

Цена из каталога `products` в `.funnel` проверяется против runtime-настройки;
публикация показывает расхождение. Реальная сумма счёта берётся из
зафиксированной runtime-конфигурации версии.

### Прямая ЮKassa для Telegram и VK

Новый провайдер `yookassa_api` использует YooKassa Server API и redirect checkout,
не Telegram Invoice. В редакторе откройте «Интеграции → ЮKassa», укажите URL
runtime и `EDITOR_ADMIN_TOKEN`, затем сохраните `shopId` и секретный ключ.
Секрет шифруется AES-256-GCM ключом `INTEGRATION_ENCRYPTION_KEY` и не входит в
`.funnel`, localStorage или ответы API.

```dotenv
PUBLIC_BASE_URL=https://bot.example.com
EDITOR_ADMIN_TOKEN=длинный_случайный_токен
INTEGRATION_ENCRYPTION_KEY=base64_от_32_случайных_байт
EDITOR_ORIGINS=https://editor.example.com,http://localhost:5173
```

В кабинете ЮKassa включите HTTP-уведомления для `payment.succeeded` и
`payment.canceled` на `https://bot.example.com/webhooks/yookassa`. Runtime всегда
повторно получает платёж из API и сверяет ID внутреннего платежа, сумму и валюту;
доставка защищена отдельной атомарной отметкой. Дополнительно работают фоновая
сверка каждые 45 секунд и кнопка «Проверить оплату».

Редактор записывает в продукт только `paymentProvider: "yookassa_api"`; старые
продукты без поля по-прежнему настраиваются командой `/product`. Чеки и данные
покупателя в MVP не формируются: режим магазина и обязательность чеков нужно
согласовать с настройками конкретного мерчанта, не добавляя фиктивный email,
ставку НДС или предмет расчёта.

## 6. Админка

`/admin` доступна только ID из `ADMIN_TELEGRAM_IDS`.

- «Воронки»: список, версии, активная версия, default и активные сессии.
- «Проверить»: связи, достижимость, циклы, tracking, scoring, продукты и файлы.
- «Опубликовать»: только без блокирующих ошибок.
- «Опубликовать с заглушками»: явное разрешение продолжать без required-файла.
- «Rollback»: меняет версию для новых стартов; текущие сессии не мигрируют.
- «Файлы»: загрузка, замена, отвязка и тестовая отправка.
- «Статистика»: общая или по версии.
- «Контакты», «Заявки», «Платежи»: последние записи и CSV.
- «Экспорт .funnel»: исходная структура плюс снимок аналитики.
- «Диагностика»: pending/failed jobs, версии и активные сессии.

Дополнительные команды:

```text
/rollback FUNNEL_ID VERSION_ID
/csv contacts|applications|payments|sources|nodes|tests [VERSION_ID]
```

CSV и аналитический `.funnel` могут содержать персональные данные.

## 7. Production webhook на обычном VPS

Нужны VPS с Docker, домен и HTTPS reverse proxy (например, Caddy или Nginx).
Telegram принимает только публичный HTTPS webhook.

1. Скопируйте каталог проекта на VPS в непубличную директорию.
2. Создайте `.env`:

```dotenv
TELEGRAM_BOT_TOKEN=...
ADMIN_TELEGRAM_IDS=123456789
APPLICATIONS_CHAT_ID=-1001234567890
POSTGRES_PASSWORD=сложный_пароль
DATABASE_URL=postgresql://voronka:сложный_пароль@postgres:5432/voronka
BOT_MODE=webhook
PUBLIC_BASE_URL=https://bot.example.com
TELEGRAM_WEBHOOK_SECRET=случайная_строка_минимум_16_символов
TELEGRAM_PAYMENT_PROVIDER_TOKEN=
EDITOR_ADMIN_TOKEN=длинный_случайный_токен
INTEGRATION_ENCRYPTION_KEY=base64_от_32_случайных_байт
EDITOR_ORIGINS=https://editor.example.com
LOG_LEVEL=info
PORT=8080
HOST=0.0.0.0
```

3. Убедитесь, что пароль в `POSTGRES_PASSWORD` совпадает с паролем внутри
   `DATABASE_URL`.
4. Направьте reverse proxy с `https://bot.example.com` на `127.0.0.1:8080`.
5. Разрешите извне только 443; PostgreSQL port 5432 в production наружу не
   публикуйте.
6. Запустите:

```bash
cd /opt/voronka/telegram-bot.local
docker compose up -d --build
docker compose logs -f bot
```

Runtime сам выполнит идемпотентные миграции, зарегистрирует webhook с secret
token и запустит worker. Для обновления сначала сделайте резервную копию БД,
замените локальные файлы и повторите `docker compose up -d --build`.

Неактивные сессии помечаются заброшенными после `bot.inactivityDays`, если у
них нет pending delayed jobs. Архивные версии и статистика автоматически не
удаляются.

Пример Caddy:

```caddyfile
bot.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

## 8. Проверки перед запуском

Реальный Telegram token и PostgreSQL не нужны для unit/contract/E2E тестов:

```bash
cd /Users/maksimsinkov/Documents/VORONKA_BOT/telegram-bot.local
npm ci
npm run check
npm audit
```

`npm run check` выполняет typecheck, 23 unit/contract/runtime/load теста,
применяет SQL к встроенному PostgreSQL‑совместимому PGlite и делает
production-сборку. На реальной PostgreSQL миграции применяются командой:

```bash
npm run migrate
```

Архитектурные решения и точная семантика handles находятся в
`docs/ADR-001-runtime-contract.md`.
