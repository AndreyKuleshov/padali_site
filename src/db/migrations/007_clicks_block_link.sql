-- Настоящая связь клика с блоком вместо текстового якоря.
--
-- Якорь был обычной строкой, поэтому после удаления блока его клики
-- оставались сиротами: на карте не рисовались, но попадали в счётчик
-- и в список «на что нажимают». Теперь это внешний ключ с каскадом —
-- блок удалили, клики ушли вместе с ним.
--
-- Служебные области вне блоков (шапка сайта, статический подвал)
-- блока не имеют и по-прежнему опознаются именем.

ALTER TABLE analytics_clicks ADD COLUMN block_id INTEGER;
ALTER TABLE analytics_clicks ALTER COLUMN anchor DROP NOT NULL;

-- Приведение к числу только внутри CASE: условия в WHERE Postgres
-- вправе вычислять в любом порядке, и на «header» каст бы упал.
UPDATE analytics_clicks
   SET block_id = CASE WHEN anchor ~ '^[0-9]+$' THEN anchor::integer END,
       anchor   = CASE WHEN anchor ~ '^[0-9]+$' THEN NULL ELSE anchor END;

-- Клики по блокам, которых уже нет, нарисовать негде.
DELETE FROM analytics_clicks
 WHERE block_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM blocks WHERE blocks.id = analytics_clicks.block_id);

-- Записи без всякого якоря остались от самой первой версии счётчика.
DELETE FROM analytics_clicks WHERE block_id IS NULL AND anchor IS NULL;

ALTER TABLE analytics_clicks
  ADD CONSTRAINT fk_clicks_block FOREIGN KEY (block_id) REFERENCES blocks (id) ON DELETE CASCADE;

-- Либо блок, либо служебное имя: и пусто, и одновременно — ошибка.
ALTER TABLE analytics_clicks
  ADD CONSTRAINT chk_clicks_anchor CHECK ((block_id IS NULL) <> (anchor IS NULL));

CREATE INDEX idx_clicks_block ON analytics_clicks (block_id);
