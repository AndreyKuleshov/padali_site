-- ─── Языки ────────────────────────────────────────────────────
CREATE TABLE locales (
  code       VARCHAR(8)   NOT NULL,
  title      VARCHAR(64)  NOT NULL,
  is_default TINYINT(1)   NOT NULL DEFAULT 0,
  position   INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Глобальные настройки ─────────────────────────────────────
CREATE TABLE settings (
  `key`      VARCHAR(64) NOT NULL,
  value_json JSON        NOT NULL,
  updated_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Медиатека ────────────────────────────────────────────────
CREATE TABLE media (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- путь относительно UPLOAD_DIR, например 2026/10/<hash>.webp
  path          VARCHAR(255) NOT NULL,
  mime          VARCHAR(64)  NOT NULL,
  width         INT UNSIGNED NOT NULL,
  height        INT UNSIGNED NOT NULL,
  bytes         INT UNSIGNED NOT NULL,
  hash          CHAR(64)     NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  -- ширины сгенерированных webp-деривативов, массив чисел
  derivatives   JSON         NOT NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_media_hash (hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE media_texts (
  media_id INT UNSIGNED NOT NULL,
  locale   VARCHAR(8)   NOT NULL,
  field    VARCHAR(64)  NOT NULL,
  value    TEXT         NOT NULL,
  PRIMARY KEY (media_id, locale, field),
  CONSTRAINT fk_media_texts_media  FOREIGN KEY (media_id) REFERENCES media (id)    ON DELETE CASCADE,
  CONSTRAINT fk_media_texts_locale FOREIGN KEY (locale)   REFERENCES locales (code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Альбомы ──────────────────────────────────────────────────
CREATE TABLE galleries (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug       VARCHAR(128) NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_galleries_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE gallery_texts (
  gallery_id INT UNSIGNED NOT NULL,
  locale     VARCHAR(8)   NOT NULL,
  field      VARCHAR(64)  NOT NULL,
  value      TEXT         NOT NULL,
  PRIMARY KEY (gallery_id, locale, field),
  CONSTRAINT fk_gallery_texts_gallery FOREIGN KEY (gallery_id) REFERENCES galleries (id) ON DELETE CASCADE,
  CONSTRAINT fk_gallery_texts_locale  FOREIGN KEY (locale)     REFERENCES locales (code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Фотография не удаляется, пока она состоит в альбоме: RESTRICT.
CREATE TABLE gallery_items (
  gallery_id INT UNSIGNED NOT NULL,
  media_id   INT UNSIGNED NOT NULL,
  position   INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (gallery_id, media_id),
  KEY idx_gallery_items_order (gallery_id, position),
  CONSTRAINT fk_gallery_items_gallery FOREIGN KEY (gallery_id) REFERENCES galleries (id) ON DELETE CASCADE,
  CONSTRAINT fk_gallery_items_media   FOREIGN KEY (media_id)   REFERENCES media (id)     ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Страницы ─────────────────────────────────────────────────
CREATE TABLE pages (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug         VARCHAR(128) NOT NULL,
  is_published TINYINT(1)   NOT NULL DEFAULT 1,
  position     INT          NOT NULL DEFAULT 0,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pages_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE page_texts (
  page_id INT UNSIGNED NOT NULL,
  locale  VARCHAR(8)   NOT NULL,
  field   VARCHAR(64)  NOT NULL,
  value   TEXT         NOT NULL,
  PRIMARY KEY (page_id, locale, field),
  CONSTRAINT fk_page_texts_page   FOREIGN KEY (page_id) REFERENCES pages (id)    ON DELETE CASCADE,
  CONSTRAINT fk_page_texts_locale FOREIGN KEY (locale)  REFERENCES locales (code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Блоки ────────────────────────────────────────────────────
CREATE TABLE blocks (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  page_id    INT UNSIGNED NOT NULL,
  type       VARCHAR(64)  NOT NULL,
  position   INT          NOT NULL DEFAULT 0,
  is_visible TINYINT(1)   NOT NULL DEFAULT 1,
  -- якорь для ссылки в быстрой навигации; NULL — блок в меню не попадает
  anchor     VARCHAR(64)  DEFAULT NULL,
  -- только непереводимое: выбранный альбом, раскладка, даты, URL
  settings   JSON         NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_blocks_page_order (page_id, position),
  CONSTRAINT fk_blocks_page FOREIGN KEY (page_id) REFERENCES pages (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE block_texts (
  block_id INT UNSIGNED NOT NULL,
  locale   VARCHAR(8)   NOT NULL,
  field    VARCHAR(128) NOT NULL,
  value    TEXT         NOT NULL,
  PRIMARY KEY (block_id, locale, field),
  CONSTRAINT fk_block_texts_block  FOREIGN KEY (block_id) REFERENCES blocks (id)   ON DELETE CASCADE,
  CONSTRAINT fk_block_texts_locale FOREIGN KEY (locale)   REFERENCES locales (code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE block_media (
  block_id INT UNSIGNED NOT NULL,
  field    VARCHAR(64)  NOT NULL,
  position INT          NOT NULL DEFAULT 0,
  media_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (block_id, field, position),
  KEY idx_block_media_media (media_id),
  CONSTRAINT fk_block_media_block FOREIGN KEY (block_id) REFERENCES blocks (id) ON DELETE CASCADE,
  CONSTRAINT fk_block_media_media FOREIGN KEY (media_id) REFERENCES media (id)  ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Администраторы ───────────────────────────────────────────
CREATE TABLE admin_users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email         VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sessions (
  id         CHAR(64)     NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  expires_at DATETIME     NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES admin_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
