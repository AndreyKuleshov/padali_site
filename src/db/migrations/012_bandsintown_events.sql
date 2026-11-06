-- Концерты переезжают из полей блока в Bandsintown.
--
-- Было: редактор заводил каждый концерт руками — дата, площадка,
-- билеты, афиша. Стало: даты и площадки приходят из Bandsintown,
-- где их и без нас заводят для афиш и трекеров, а на сайте
-- остаётся то, чего там нет: своя афиша и цена.
--
-- Поэтому события живут отдельной таблицей, а не в settings блока:
-- их пишет синхронизация, а не форма, и список должен пережить
-- молчание чужого сервиса. Блоков с концертами может быть и
-- несколько — события у них общие, они про одну группу.

CREATE TABLE concert_events (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- id события в Bandsintown: по нему строка узнаётся при следующей
  -- синхронизации, и к нему же привязано добавленное редактором.
  bit_id      VARCHAR(64)  NOT NULL UNIQUE,

  -- Местное время площадки без смещения — ровно так его отдаёт
  -- Bandsintown: «2026-12-04T20:00:00». Часового пояса в ответе нет,
  -- и привести это к timestamptz не из чего. Текстом оно к тому же
  -- сравнивается с «ГГГГ-ММ-ДД» как есть: отбор будущих концертов
  -- остаётся тем же сравнением строк, что и у прежнего повторителя.
  starts_at   VARCHAR(19)  NOT NULL,
  -- Показывать ли время. У события бывает объявлен только день
  -- (datetime_display_rule), и выдуманные «20:00» хуже, чем ничего.
  show_time   BOOLEAN      NOT NULL DEFAULT TRUE,

  venue_name    VARCHAR(190) NOT NULL DEFAULT '',
  venue_city    VARCHAR(190) NOT NULL DEFAULT '',
  venue_country VARCHAR(190) NOT NULL DEFAULT '',
  venue_address VARCHAR(255) NOT NULL DEFAULT '',

  -- Страница события и продажа билетов. Адреса храним без строки
  -- запроса: Bandsintown подставляет в них наш же app_id, и на
  -- сайте он оказался бы у всех на виду.
  event_url   VARCHAR(500) NOT NULL DEFAULT '',
  ticket_url  VARCHAR(500) NOT NULL DEFAULT '',
  sold_out    BOOLEAN      NOT NULL DEFAULT FALSE,
  is_free     BOOLEAN      NOT NULL DEFAULT FALSE,

  -- Описание как его прислали. Нужно не для показа, а для сверки:
  -- перевод заказывается заново, только когда исходник изменился.
  description TEXT         NOT NULL DEFAULT '',

  -- ─── То, чего в Bandsintown нет; пишет редактор ───────────────
  -- Синхронизация этих трёх колонок не касается: форма, которая
  -- знает не всё, не должна писать «всё целиком».
  poster_id   INTEGER      CONSTRAINT fk_concert_events_poster REFERENCES media (id) ON DELETE RESTRICT,
  price       VARCHAR(64)  NOT NULL DEFAULT '',
  price_from  BOOLEAN      NOT NULL DEFAULT FALSE,

  -- Когда событие в последний раз подтвердил ответ API.
  synced_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_concert_events_starts ON concert_events (starts_at);
CREATE INDEX idx_concert_events_poster ON concert_events (poster_id);

-- Переведённое описание — строка на язык, как весь переводимый текст.
CREATE TABLE concert_event_texts (
  event_id INTEGER     NOT NULL CONSTRAINT fk_concert_event_texts_event  REFERENCES concert_events (id) ON DELETE CASCADE,
  locale   VARCHAR(8)  NOT NULL CONSTRAINT fk_concert_event_texts_locale REFERENCES locales (code)      ON DELETE CASCADE,
  field    VARCHAR(64) NOT NULL,
  value    TEXT        NOT NULL,
  PRIMARY KEY (event_id, locale, field)
);

-- Прежние концерты, заведённые руками, убираем.
--
-- Не из любви к чистоте: показать их больше негде — у блока не
-- осталось полей под них, — а афиша, оставшаяся в block_media,
-- навсегда числилась бы занятой и не удалялась бы из медиатеки.
-- На сайте в этот момент будущих концертов нет, терять нечего.
DELETE FROM block_media
WHERE field LIKE 'events.%'
  AND block_id IN (SELECT id FROM blocks WHERE type = 'concert');

DELETE FROM block_texts
WHERE field LIKE 'events.%'
  AND block_id IN (SELECT id FROM blocks WHERE type = 'concert');

UPDATE blocks
SET settings = settings - 'events'
WHERE type = 'concert';
