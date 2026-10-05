-- Концерт стал списком концертов.
--
-- Было: одно событие полями самого блока — venue/note/tag/ticket_label
-- в block_texts, афиша в block_media под «poster», дата и билеты в
-- settings. Стало: settings.events[], а тексты и афиша — под
-- составным именем «events.0.<поле>».
--
-- Перенос обязателен: на сайте висит ближайший концерт, и без него
-- раздел исчез бы молча.

UPDATE blocks
SET settings = (settings - 'date' - 'tickets' - 'ticket_url' - 'price')
  || jsonb_build_object('events', jsonb_build_array(
       jsonb_strip_nulls(jsonb_build_object(
         'date',       settings ->> 'date',
         'tickets',    COALESCE(settings ->> 'tickets', 'link'),
         'ticket_url', COALESCE(settings ->> 'ticket_url', ''),
         'price',      COALESCE(settings ->> 'price', '')
       ))
     ))
WHERE type = 'concert'
  AND settings -> 'events' IS NULL;

UPDATE block_texts
SET field = 'events.0.' || field
WHERE field IN ('venue', 'note', 'tag', 'ticket_label')
  AND block_id IN (SELECT id FROM blocks WHERE type = 'concert');

UPDATE block_media
SET field = 'events.0.poster'
WHERE field = 'poster'
  AND block_id IN (SELECT id FROM blocks WHERE type = 'concert');
