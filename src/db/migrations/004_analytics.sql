-- Своя статистика посещений. Кук нет, IP не хранится.
--
-- Посетитель опознаётся хешем от адреса и браузера с солью, которая
-- меняется каждый день: за сутки видно уникальных, между сутками
-- связать визиты невозможно — это и нужно, чтобы не вести слежку.

CREATE TABLE analytics_views (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  path          VARCHAR(255) NOT NULL,
  locale        VARCHAR(8),
  visitor_hash  CHAR(32)     NOT NULL,
  referrer_host VARCHAR(190),
  viewport      INTEGER      NOT NULL,
  is_mobile     BOOLEAN      NOT NULL DEFAULT FALSE,
  viewed_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_views_time ON analytics_views (viewed_at);
CREATE INDEX idx_views_path ON analytics_views (path, viewed_at);

-- Клик хранится в долях ширины страницы и в пикселях от её верха:
-- так точки сопоставимы между экранами разной ширины.
CREATE TABLE analytics_clicks (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  path       VARCHAR(255)     NOT NULL,
  x_ratio    DOUBLE PRECISION NOT NULL,
  y_offset   INTEGER          NOT NULL,
  viewport   INTEGER          NOT NULL,
  target     VARCHAR(190),
  clicked_at TIMESTAMPTZ      NOT NULL DEFAULT now()
);

CREATE INDEX idx_clicks_time ON analytics_clicks (clicked_at);
CREATE INDEX idx_clicks_path ON analytics_clicks (path, clicked_at);
