-- Письма с сайта и цены на мерч.
--
-- Сообщение сначала ложится в базу и только потом уходит почтой.
-- Наоборот нельзя: SMTP отвечает не всегда, и написанное человеком
-- пропало бы бесследно — а это единственный способ до группы
-- достучаться. Отправку отмечаем в самой строке, чтобы по списку
-- было видно, что дошло, а что нет.

CREATE TABLE messages (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- 'contact' — письмо из формы связи, 'order' — заказ мерча
  kind       VARCHAR(16)  NOT NULL,
  contact    VARCHAR(256) NOT NULL DEFAULT '',
  city       VARCHAR(128) NOT NULL DEFAULT '',
  -- Что заказывают: название и цена на момент заказа. Цену храним
  -- строкой здесь же: в каталоге она поменяется, а в заказе должна
  -- остаться та, которую человек видел.
  item       VARCHAR(256) NOT NULL DEFAULT '',
  body       TEXT         NOT NULL DEFAULT '',
  locale     VARCHAR(8),
  mailed_at  TIMESTAMPTZ,
  mail_error TEXT,
  is_read    BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_fresh ON messages (created_at DESC);

-- Цена свободной строкой: «2500 RSD», «25 €», «по договорённости».
-- Числом её держать нельзя — валюта и формат за редактором.
ALTER TABLE gallery_items ADD COLUMN price VARCHAR(64) NOT NULL DEFAULT '';
