-- Название товара на всех языках сайта.
--
-- Было одной строкой, но витрина двуязычная: «Футболка» и
-- «Majica» — это одно и то же поле, а не два разных товара.
-- Храним так же, как остальные переводы: строка на язык.
--
-- Поле field на вырост: цена не переводится, а вот описание
-- товара когда-нибудь может понадобиться.

CREATE TABLE gallery_item_texts (
  gallery_id INTEGER     NOT NULL,
  media_id   INTEGER     NOT NULL,
  locale     VARCHAR(8)  NOT NULL CONSTRAINT fk_item_texts_locale REFERENCES locales (code) ON DELETE CASCADE,
  field      VARCHAR(64) NOT NULL,
  value      TEXT        NOT NULL,
  PRIMARY KEY (gallery_id, media_id, locale, field),
  CONSTRAINT fk_item_texts_item FOREIGN KEY (gallery_id, media_id)
    REFERENCES gallery_items (gallery_id, media_id) ON DELETE CASCADE
);

-- Уже введённые названия переносим в язык по умолчанию: они
-- написаны на нём, и терять их при переезде незачем.
INSERT INTO gallery_item_texts (gallery_id, media_id, locale, field, value)
SELECT i.gallery_id, i.media_id, COALESCE(
         (SELECT code FROM locales WHERE is_default ORDER BY position LIMIT 1),
         (SELECT code FROM locales ORDER BY position LIMIT 1)
       ), 'title', i.title
  FROM gallery_items i
 WHERE i.title <> '';

ALTER TABLE gallery_items DROP COLUMN title;
