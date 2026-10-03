# PADALI — сайт с блочной CMS

Дата: 2026-10-03
Репозиторий: https://github.com/AndreyKuleshov/padali_site

## 1. Задача

Статический экспорт лендинга (`index.html` + 6 изображений) превратить в сайт с
нормальной структурой и бэкендом для редактирования контента.

Требования заказчика:

- весь текстовый контент хранится в MySQL;
- изображения хранятся локально, на диске;
- предусмотрена возможность добавлять новые разделы (блоки);
- первый новый тип раздела — фотогалерея, универсальный модуль,
  вставляемый в любое место страницы.

## 2. Исходное состояние

Один файл `index.html` (18 КБ): inline-стили, inline-скрипты, захардкоженный
текст на двух языках (EN/SR) через `data-i18n` и CSS-переключение, захардкоженная
дата релиза `2026-10-22` в скрипте обратного отсчёта, дублирующиеся SVG-иконки
соцсетей. Ассеты: `band-photo.webp`, `concert-poster.webp`, `single-cover.webp`,
`padali-mark.webp`, `padali-wordmark.webp`, `favicon.png`.

Секции страницы: hero, быстрая навигация, релиз сингла, концерт, соцсети, подвал.

## 3. Принятые решения

| Решение | Выбор | Причина |
|---|---|---|
| Хостинг | Coolify (Docker, деплой из GitHub) | задано заказчиком |
| Стек | Node.js + Fastify + MySQL 8 + Eta (SSR) | схема блоков версионируется в git, воспроизводится из репозитория одной командой |
| Админка | серверный рендеринг, обычные формы | один редактор, минимум кода и зависимостей |
| Редакторы | один пользователь (разработчик) | без ролей, без истории правок |
| Структура | блоки на одной странице | таблица `pages` заложена, но на старте одна строка `home` |
| Языки | EN + SR, отдельные URL `/` и `/sr` | вдвое меньше HTML, корректная индексация обеих версий |
| Галерея | альбомы + блок-вставка | один альбом переиспользуется в нескольких местах |
| Вкладки альбомов | не делаем | YAGNI; схема позволит добавить тип `gallery_tabs` без миграций |

Отклонённые варианты: Directus (схема настраивается в UI и не версионируется,
тяжёлый контейнер), генерация статики по кнопке «Опубликовать» (лишний шаг
публикации, усложняет динамику).

## 4. Архитектура

```
Браузер
  │
  ├── GET /, /sr ─────────► routes/public ──► services/page-composer ──► repositories ──► MySQL
  │                                 │
  │                                 └──► views/layout.eta + views/blocks/<type>.eta ──► HTML
  │
  ├── GET /uploads/* ─────► @fastify/static (volume, Cache-Control: immutable)
  │
  └── /admin/* ───────────► routes/admin ──► repositories ──► MySQL
                                   │
                                   └──► services/media-processor (sharp) ──► data/uploads/
```

Единицы и их границы:

- **repositories/** — единственное место, где есть SQL. Каждый репозиторий отдаёт
  простые объекты, не знает про HTTP и шаблоны.
- **services/page-composer** — собирает дерево страницы из репозиториев.
  Не знает про Fastify. Тестируется изолированно.
- **services/media-processor** — принимает путь к загруженному файлу, отдаёт
  запись медиа с деривативами. Не знает про БД.
- **blocks/** — декларативные дескрипторы типов. Не содержат логики доступа к данным.
- **routes/** — только HTTP: валидация ввода, вызов репозиториев/сервисов, рендер.

## 5. Структура репозитория

```
padali_site/
├─ docker-compose.yml
├─ Dockerfile
├─ .env.example
├─ .dockerignore / .gitignore
├─ package.json
├─ src/
│  ├─ server.js              сборка Fastify, регистрация плагинов, graceful shutdown
│  ├─ config.js              чтение и валидация env
│  ├─ db/
│  │  ├─ pool.js             mysql2/promise pool
│  │  ├─ migrate.js          раннер миграций, таблица `migrations`
│  │  └─ migrations/001_init.sql …
│  ├─ blocks/
│  │  ├─ index.js            сбор и валидация дескрипторов
│  │  ├─ hero.js  release.js  concert.js  links.js  gallery.js  richtext.js
│  ├─ repositories/
│  │  ├─ pages.js  blocks.js  media.js  galleries.js  settings.js  users.js  sessions.js
│  ├─ services/
│  │  ├─ page-composer.js    сборка дерева страницы
│  │  ├─ media-processor.js  sharp: деривативы + webp
│  │  └─ cache.js            in-memory кэш отрендеренных страниц
│  ├─ routes/
│  │  ├─ public.js
│  │  └─ admin/  auth.js  blocks.js  media.js  galleries.js  settings.js
│  └─ views/
│     ├─ layout.eta
│     ├─ partials/  icons.eta  picture.eta  quicknav.eta
│     ├─ blocks/    hero.eta  release.eta  concert.eta  links.eta  gallery.eta  richtext.eta
│     └─ admin/     login.eta  dashboard.eta  block-form.eta  media.eta  galleries.eta  settings.eta
├─ public/
│  ├─ css/site.css  css/admin.css
│  ├─ js/site.js    js/admin.js
│  └─ brand/        padali-wordmark.webp  padali-mark.webp  favicon.png
├─ data/uploads/    volume, в git не попадает
├─ scripts/seed.js  перенос текущего index.html в БД
└─ tests/
```

Брендовые ассеты (вордмарк, знак, favicon) лежат в `public/brand/` и версионируются:
это часть дизайна, а не редактируемый контент. Фотографии (band-photo,
concert-poster, single-cover) при сидировании попадают в медиатеку.

## 6. Схема данных

Весь переводимый текст лежит в таблицах `*_texts` строками `(locale, field, value)`.
Добавление языка — вставка строки в `locales`, не изменение схемы.

```sql
settings      (`key` PK, value_json JSON, updated_at)
locales       (code PK, title, is_default TINYINT, position)

pages         (id PK, slug UNIQUE, is_published, position, created_at, updated_at)
page_texts    (page_id FK, locale FK, field, value, PK(page_id, locale, field))

blocks        (id PK, page_id FK, type, position, is_visible,
               anchor NULL, settings JSON, created_at, updated_at,
               INDEX(page_id, position))
block_texts   (block_id FK, locale FK, field, value, PK(block_id, locale, field))
block_media   (block_id FK, field, position, media_id FK, PK(block_id, field, position))

media         (id PK, path, mime, width, height, bytes,
               hash CHAR(64) UNIQUE, original_name, created_at)
media_texts   (media_id FK, locale FK, field, value, PK(media_id, locale, field))

galleries     (id PK, slug UNIQUE, created_at, updated_at)
gallery_texts (gallery_id FK, locale FK, field, value, PK(gallery_id, locale, field))
gallery_items (gallery_id FK, media_id FK, position, PK(gallery_id, media_id),
               INDEX(gallery_id, position))

admin_users   (id PK, email UNIQUE, password_hash, created_at)
sessions      (id CHAR(64) PK, user_id FK, expires_at, INDEX(expires_at))
```

`blocks.settings` хранит только непереводимое и структурное: `gallery_id`,
`layout`, `columns`, `lightbox`, `limit`, URL ссылок, даты. Переводимое туда
не попадает никогда.

Подпись и alt — свойства самой фотографии (`media_texts`), а не вставки в альбом:
фото с одной подписью в двух альбомах — норма, две разные подписи у одного
файла — нет.

Каскады: удаление блока удаляет его `block_texts` и `block_media`;
удаление альбома удаляет `gallery_items`; удаление `media` запрещено, пока
на файл есть ссылки (проверка в репозитории, FK `RESTRICT`).

## 7. Реестр типов блоков

Дескриптор описывает поля; админка строит форму автоматически.

```js
// src/blocks/gallery.js
export default {
  type: 'gallery',
  title: 'Фотогалерея',
  texts: [
    { key: 'heading', label: 'Заголовок', input: 'text' },
    { key: 'intro',   label: 'Подводка',  input: 'textarea' },
  ],
  settings: [
    { key: 'gallery_id', label: 'Альбом',   input: 'gallery-picker', required: true },
    { key: 'layout',     label: 'Раскладка', input: 'select',
      options: ['grid', 'strip', 'masonry'], default: 'grid' },
    { key: 'columns',    label: 'Колонок',  input: 'number', default: 3, min: 2, max: 5 },
    { key: 'lightbox',   label: 'Лайтбокс', input: 'checkbox', default: true },
    { key: 'limit',      label: 'Показать первые N (0 — все)',
      input: 'number', default: 0, min: 0 },
  ],
  media: [],
  template: 'blocks/gallery',
}
```

Доступные `input`: `text`, `textarea`, `richtext`, `number`, `checkbox`,
`select`, `date`, `url`, `image-picker`, `gallery-picker`, `repeater`.

`repeater` — повторяющиеся наборы полей (платформы у релиза, ссылки у `links`);
хранится в `settings` как массив, переводимые подписи элементов — в
`block_texts` по ключу вида `items.<index>.<field>`.

**Добавление нового типа раздела**: создать `src/blocks/<type>.js` и
`src/views/blocks/<type>.eta`. Миграции не требуются.

### Типы на старте

| Тип | Что заменяет | Поля |
|---|---|---|
| `hero` | шапка с фото | фоновое изображение, слоган (EN/SR), показывать ли вордмарк |
| `release` | блок сингла | обложка, бейдж, название, дата релиза, вкл/выкл обратный отсчёт, примечание, список платформ (repeater) |
| `concert` | блок концерта | афиша, дата, площадка, описание, тег |
| `links` | «Listen & watch» | список ссылок (repeater: иконка, название, handle, URL) |
| `gallery` | новый | см. выше |
| `richtext` | новый | заголовок + форматированный текст |

Блок быстрой навигации (`quicknav`) типом не является: он собирается
автоматически из видимых блоков, у которых заполнен `anchor`, и берёт подпись
из поля `nav_label` в `block_texts`.

## 8. Галерея как универсальный модуль

Альбом (`galleries`) существует независимо от места показа. Блок `gallery`
ссылается на альбом через `settings.gallery_id`.

Следствия:

- на странице может стоять сколько угодно блоков-галерей с **разными** альбомами;
- **один** альбом можно вставить в нескольких местах с разной раскладкой
  (например, лента из 4 фото вверху через `limit: 4` и полная сетка ниже);
- порядок фото и подписи правятся один раз в альбоме — обновляются все вставки.

Лайтбокс из текущего сайта переиспользуется, вынесен в `public/js/site.js`.

## 9. Обработка изображений

Загрузка (`@fastify/multipart`, лимит 20 МБ, белый список
`image/jpeg|png|webp|avif`) → `sharp` → деривативы шириной 320 / 640 / 1280 / 1920
в WebP (`quality: 82`), апскейл не делается → сохранение рядом с оригиналом.

Путь: `data/uploads/<ГГГГ>/<ММ>/<hash>-<ширина>.webp`, оригинал —
`<hash>.<ext>`. `hash` — SHA-256 содержимого, даёт дедупликацию: повторная
загрузка того же файла возвращает существующую запись.

В шаблоны уходит `<picture>` с `srcset` и `sizes`; отдача через
`@fastify/static` с `Cache-Control: public, max-age=31536000, immutable`
(имя файла содержит хеш, инвалидация не нужна).

## 10. Рендеринг и языки

`GET /` (en) и `GET /sr` → `page-composer` собирает дерево страницы →
Eta рендерит `layout.eta` и по шаблону на каждый видимый блок.

Композер делает фиксированное число запросов независимо от количества блоков:
блоки, тексты блоков, связи с медиа, сами медиа, альбомы и их элементы —
по одному запросу на таблицу, сборка в памяти. N+1 не допускается.

Кэш: готовый HTML лежит в памяти процесса, ключ — локаль; сбрасывается
целиком при любой записи из админки. Отдаётся `ETag`; на `If-None-Match`
возвращается `304`.

Фоллбэк языка: если перевода поля нет, берётся значение локали по умолчанию
(`locales.is_default`). В админке незаполненные переводы подсвечиваются.

В `<head>` — `lang`, `hreflang` на обе версии и `canonical`.
Переключатель языка становится ссылкой на парный URL.

## 11. Админка

Серверный рендеринг, формы без JS-фреймворка. Единственная внешняя
JS-зависимость — SortableJS для перетаскивания.

| Маршрут | Назначение |
|---|---|
| `GET/POST /admin/login` | вход |
| `POST /admin/logout` | выход |
| `GET /admin` | список блоков: перетаскивание порядка, переключатель видимости, «Добавить блок» |
| `GET/POST /admin/blocks/:id` | форма блока по дескриптору, поля EN и SR рядом |
| `POST /admin/blocks/:id/delete` | удаление блока |
| `POST /admin/blocks/reorder` | сохранение порядка |
| `GET /admin/media` | медиатека: загрузка, alt/caption, удаление |
| `GET/POST /admin/galleries` | список и создание альбомов |
| `GET/POST /admin/galleries/:id` | состав альбома, порядок фото |
| `GET/POST /admin/settings` | соцсети, мета-теги, OG-изображение |

Безопасность: пароль — argon2id; сессия — httpOnly + Secure + SameSite=Lax
cookie со случайным 32-байтным идентификатором, срок 30 дней, запись в
`sessions`; CSRF-токен на всех POST-формах; rate-limit на `/admin/login`
(10 попыток за 15 минут с адреса); все `/admin/*` закрыты префиксным хуком;
вывод пользовательского текста экранируется по умолчанию, `richtext`
санитизируется белым списком тегов.

Первый администратор создаётся при старте из `ADMIN_EMAIL` / `ADMIN_PASSWORD`,
если таблица `admin_users` пуста.

## 12. Конфигурация и деплой

`.env`: `PORT`, `NODE_ENV`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`,
`DB_NAME`, `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `UPLOAD_DIR`,
`PUBLIC_URL`. Отсутствие обязательной переменной валит старт с внятной ошибкой.

`Dockerfile`: multi-stage на `node:22-alpine`, прод-зависимости, non-root
пользователь, `HEALTHCHECK` на `/healthz`.

`docker-compose.yml`: сервисы `app` и `db` (`mysql:8`), тома `db_data` и
`uploads`, `depends_on` с healthcheck БД.

Миграции применяются на старте приложения до начала приёма запросов.

Coolify: деплой из GitHub, persistent storage монтируется в
`/app/data/uploads`, переменные окружения задаются в интерфейсе.

## 13. Перенос текущего контента

`scripts/seed.js` (идемпотентный, выполняется один раз при пустой БД):

1. создаёт локали `en` (по умолчанию) и `sr`;
2. создаёт страницу `home`;
3. кладёт `band-photo.webp`, `concert-poster.webp`, `single-cover.webp`
   в медиатеку через обычный конвейер обработки;
4. создаёт блоки `hero`, `release`, `concert`, `links` с текстами из
   текущего `index.html` на обоих языках;
5. создаёт демонстрационный альбом и блок `gallery` после блока `concert`;
6. заполняет `settings`: ссылки на соцсети, мета-описание, OG-изображение.

Дата релиза `2026-10-22` и дата концерта `2026-10-16` перестают быть
захардкоженными и становятся полями блоков.

## 14. Тестирование

`node:test` + `fastify.inject`, отдельная схема `padali_test` в том же
контейнере MySQL, откат транзакцией между тестами.

Покрывается:

- миграции применяются на пустой БД и повторный прогон идемпотентен;
- CRUD блока, сохранение переводов, сохранение порядка;
- композер собирает страницу за фиксированное число запросов (проверка счётчика);
- фоллбэк на язык по умолчанию при отсутствующем переводе;
- загрузка изображения создаёт деривативы и дедуплицируется по hash;
- удаление используемого медиа отклоняется;
- порядок фото в альбоме и `limit` в блоке;
- один альбом в двух блоках с разными раскладками рендерится корректно;
- неавторизованный доступ к `/admin/*` редиректит на логин;
- POST без CSRF-токена отклоняется;
- публичная страница отдаёт `200` и корректный `ETag`/`304`.

## 15. Что осознанно не делается

- роли и права, история правок, предпросмотр черновиков — один редактор;
- вкладки с несколькими альбомами в одном блоке — добавляется позже файлом;
- несколько страниц — таблица `pages` заложена, маршрутизация по slug не делается;
- CDN, S3, очереди, фоновые воркеры — объём контента этого не требует.


---

## Дополнение от 2026-10-03: база данных — PostgreSQL

Решение из раздела 3 («контент в MySQL») изменено по ходу развёртывания.

**Почему.** На сервере Coolify не оказалось MySQL: единственная база —
PostgreSQL, заведённая для проекта python-coach. Заказчик выбрал
переиспользовать её, выделив приложению отдельную схему, вместо того
чтобы поднимать второй сервер баз данных.

**Что изменилось.**

| | Было | Стало |
|---|---|---|
| СУБД | MySQL 8 | PostgreSQL 16 |
| Драйвер | `mysql2` | `pg` |
| Размещение | своя база | схема `padali` внутри общей базы |
| JSON | `JSON` + `CAST(? AS JSON)` | `JSONB` + `?::jsonb` |
| Автоинкремент | `AUTO_INCREMENT` + `insertId` | `GENERATED ALWAYS AS IDENTITY` + `RETURNING id` |
| Вставка-или-замена | `ON DUPLICATE KEY UPDATE` | `ON CONFLICT … DO UPDATE` |
| `updated_at` | `ON UPDATE CURRENT_TIMESTAMP` | триггер `touch_updated_at()` |
| Поиск по JSON | `JSON_EXTRACT(settings, '$.gallery_id')` | `settings ->> 'gallery_id'` |
| Контейнер БД в compose | был | убран, база внешняя |

Модель данных, реестр блоков, устройство галереи и всё остальное из
разделов 4–15 не изменились: правка затронула только слой доступа
к данным (`src/db`, `src/repositories`) и миграцию.

**Принятый риск.** Схема живёт внутри базы чужого приложения. Удаление
или восстановление ресурса python-coach из бэкапа затронет и PADALI,
подключение идёт под общим пользователем. Вынесение в отдельную базу
остаётся возможным позже: достаточно сменить `DB_HOST`/`DB_NAME` и
прогнать миграции заново.

**Подводный камень, стоивший отладки.** Драйвер `pg` разбирает `jsonb`
сам, в отличие от `mysql2`, который отдавал JSON-колонки текстом.
Повторный `JSON.parse` над уже разобранным значением ломал строковые
настройки: `"padali.band"` корректным JSON не является и превращался
в `null`. Закрыто тестом `tests/settings.test.js` на круговорот
значений всех типов.
