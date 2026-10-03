-- Горизонталь клика — в пикселях от центра блока, а не долей ширины.
--
-- Блок занимает всю ширину окна, а колонка содержимого центрирована
-- и ограничена по ширине. Поэтому «доля ширины блока» у посетителя
-- с другим окном указывала на другое место: кнопка на 0.667 при окне
-- 2056 и при 1440 — это разные точки. Смещение от центра у
-- центрированной колонки одинаково при любом окне.
--
-- Записи, снятые по старым правилам, нарисовать верно нельзя —
-- удаляем, чтобы карта не врала.
DELETE FROM analytics_clicks WHERE anchor IS NULL;

ALTER TABLE analytics_clicks ADD COLUMN x_offset INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analytics_clicks DROP COLUMN x_ratio;
ALTER TABLE analytics_clicks ALTER COLUMN anchor SET NOT NULL;
