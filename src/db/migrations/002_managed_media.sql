-- Пометка «этой картинкой управляет репозиторий».
--
-- Файлы из seed-assets/ попадают в медиатеку при первом запуске.
-- Ключ позволяет потом узнать их и обновить содержимое, когда файл
-- в репозитории заменили: правка файла должна доезжать до сайта
-- так же, как правка кода.
ALTER TABLE media ADD COLUMN managed_key VARCHAR(128);

CREATE UNIQUE INDEX uq_media_managed_key ON media (managed_key);

-- Записи, созданные первичным наполнением до появления ключа.
-- Имена файлов заданы кодом сидера, поэтому совпадение однозначно.
-- Условие по количеству страхует от случайно одноимённой загрузки.
UPDATE media m
   SET managed_key = split_part(m.original_name, '.', 1)
 WHERE m.original_name IN ('band-photo.webp', 'band-photo.png',
                           'concert-poster.webp', 'single-cover.webp',
                           'padali-mark.webp')
   AND (SELECT COUNT(*) FROM media x WHERE x.original_name = m.original_name) = 1;
