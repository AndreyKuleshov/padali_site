-- Таблицы создаются в схеме приложения: база может быть общей
-- с другими проектами. Схему подставляет раннер миграций.

-- ─── Языки ────────────────────────────────────────────────────
CREATE TABLE locales (
  code       VARCHAR(8)  PRIMARY KEY,
  title      VARCHAR(64) NOT NULL,
  is_default BOOLEAN     NOT NULL DEFAULT FALSE,
  position   INTEGER     NOT NULL DEFAULT 0
);

-- ─── Глобальные настройки ─────────────────────────────────────
CREATE TABLE settings (
  key        VARCHAR(64) PRIMARY KEY,
  value_json JSONB       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Медиатека ────────────────────────────────────────────────
CREATE TABLE media (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- путь относительно UPLOAD_DIR, например 2026/10/<hash>.webp
  path          VARCHAR(255) NOT NULL,
  mime          VARCHAR(64)  NOT NULL,
  width         INTEGER      NOT NULL,
  height        INTEGER      NOT NULL,
  bytes         INTEGER      NOT NULL,
  hash          CHAR(64)     NOT NULL UNIQUE,
  original_name VARCHAR(255) NOT NULL,
  -- ширины сгенерированных webp-деривативов, массив чисел
  derivatives   JSONB        NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE media_texts (
  media_id INTEGER     NOT NULL CONSTRAINT fk_media_texts_media  REFERENCES media (id)    ON DELETE CASCADE,
  locale   VARCHAR(8)  NOT NULL CONSTRAINT fk_media_texts_locale REFERENCES locales (code) ON DELETE CASCADE,
  field    VARCHAR(64) NOT NULL,
  value    TEXT        NOT NULL,
  PRIMARY KEY (media_id, locale, field)
);

-- ─── Альбомы ──────────────────────────────────────────────────
CREATE TABLE galleries (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug       VARCHAR(128) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE gallery_texts (
  gallery_id INTEGER     NOT NULL CONSTRAINT fk_gallery_texts_gallery REFERENCES galleries (id) ON DELETE CASCADE,
  locale     VARCHAR(8)  NOT NULL CONSTRAINT fk_gallery_texts_locale  REFERENCES locales (code) ON DELETE CASCADE,
  field      VARCHAR(64) NOT NULL,
  value      TEXT        NOT NULL,
  PRIMARY KEY (gallery_id, locale, field)
);

-- Фотография не удаляется, пока она состоит в альбоме: RESTRICT.
CREATE TABLE gallery_items (
  gallery_id INTEGER NOT NULL CONSTRAINT fk_gallery_items_gallery REFERENCES galleries (id) ON DELETE CASCADE,
  media_id   INTEGER NOT NULL CONSTRAINT fk_gallery_items_media   REFERENCES media (id)     ON DELETE RESTRICT,
  position   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (gallery_id, media_id)
);

CREATE INDEX idx_gallery_items_order ON gallery_items (gallery_id, position);

-- ─── Страницы ─────────────────────────────────────────────────
CREATE TABLE pages (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug         VARCHAR(128) NOT NULL UNIQUE,
  is_published BOOLEAN      NOT NULL DEFAULT TRUE,
  position     INTEGER      NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE page_texts (
  page_id INTEGER     NOT NULL CONSTRAINT fk_page_texts_page   REFERENCES pages (id)     ON DELETE CASCADE,
  locale  VARCHAR(8)  NOT NULL CONSTRAINT fk_page_texts_locale REFERENCES locales (code) ON DELETE CASCADE,
  field   VARCHAR(64) NOT NULL,
  value   TEXT        NOT NULL,
  PRIMARY KEY (page_id, locale, field)
);

-- ─── Блоки ────────────────────────────────────────────────────
CREATE TABLE blocks (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  page_id    INTEGER     NOT NULL CONSTRAINT fk_blocks_page REFERENCES pages (id) ON DELETE CASCADE,
  type       VARCHAR(64) NOT NULL,
  position   INTEGER     NOT NULL DEFAULT 0,
  is_visible BOOLEAN     NOT NULL DEFAULT TRUE,
  -- якорь для ссылки в быстрой навигации; NULL — блок в меню не попадает
  anchor     VARCHAR(64),
  -- только непереводимое: выбранный альбом, раскладка, даты, URL
  settings   JSONB       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_blocks_page_order ON blocks (page_id, position);
-- Поиск вставок конкретного альбома: «куда ещё подставлен этот альбом».
CREATE INDEX idx_blocks_gallery ON blocks ((settings ->> 'gallery_id'));

CREATE TABLE block_texts (
  block_id INTEGER      NOT NULL CONSTRAINT fk_block_texts_block  REFERENCES blocks (id)    ON DELETE CASCADE,
  locale   VARCHAR(8)   NOT NULL CONSTRAINT fk_block_texts_locale REFERENCES locales (code) ON DELETE CASCADE,
  field    VARCHAR(128) NOT NULL,
  value    TEXT         NOT NULL,
  PRIMARY KEY (block_id, locale, field)
);

CREATE TABLE block_media (
  block_id INTEGER     NOT NULL CONSTRAINT fk_block_media_block REFERENCES blocks (id) ON DELETE CASCADE,
  field    VARCHAR(64) NOT NULL,
  position INTEGER     NOT NULL DEFAULT 0,
  media_id INTEGER     NOT NULL CONSTRAINT fk_block_media_media REFERENCES media (id)  ON DELETE RESTRICT,
  PRIMARY KEY (block_id, field, position)
);

CREATE INDEX idx_block_media_media ON block_media (media_id);

-- ─── Администраторы ───────────────────────────────────────────
CREATE TABLE admin_users (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id         CHAR(64)    PRIMARY KEY,
  user_id    INTEGER     NOT NULL CONSTRAINT fk_sessions_user REFERENCES admin_users (id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_expires ON sessions (expires_at);

-- ─── updated_at ───────────────────────────────────────────────
-- В Postgres нет аналога ON UPDATE CURRENT_TIMESTAMP, поэтому триггер.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pages_updated     BEFORE UPDATE ON pages
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_blocks_updated    BEFORE UPDATE ON blocks
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_galleries_updated BEFORE UPDATE ON galleries
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_settings_updated  BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
