-- Новые снимки встают в начало альбома, а не в конец.
--
-- Альбом наполняют порциями, и порядок загрузки — это порядок от
-- старых к новым: свежие кадры оказывались за двумя экранами
-- прокрутки, а первым на странице встречал прошлый год. Само
-- добавление уже переписано (prependGalleryItems); здесь
-- переворачиваем то, что уже лежит, — иначе правило «свежее
-- сверху» начнёт действовать только для будущих загрузок.
--
-- Трогаем только альбомы, которые показывает блок-галерея: у мерча
-- порядок товаров расставлен осознанно, и переворачивать его
-- незачем. Перетаскивание в админке продолжает работать поверх
-- этого: позиция остаётся за редактором.
--
-- Приведение типа стоит внутри CASE: в WHERE рядом с фильтром
-- Postgres порядок вычисления условий не обещает, и на нечисловом
-- gallery_id запрос падал бы.

WITH photo_albums AS (
  SELECT DISTINCT CASE
           WHEN settings ->> 'gallery_id' ~ '^[0-9]+$'
           THEN (settings ->> 'gallery_id')::integer
         END AS gallery_id
  FROM blocks
  WHERE type = 'gallery'
),
flipped AS (
  SELECT i.gallery_id,
         i.media_id,
         row_number() OVER (
           PARTITION BY i.gallery_id
           ORDER BY i.position DESC, i.media_id DESC
         ) - 1 AS fresh_position
  FROM gallery_items i
  JOIN photo_albums a ON a.gallery_id = i.gallery_id
)
UPDATE gallery_items AS i
   SET position = f.fresh_position
  FROM flipped AS f
 WHERE i.gallery_id = f.gallery_id
   AND i.media_id = f.media_id;
