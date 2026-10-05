import { readFile } from 'node:fs/promises'
import { listMedia, countMedia } from '../repositories/media.js'
import { absolutePath, rebuildMediaFile, needsRepair } from './media-processor.js'

/** Размер пакета: столько записей `listMedia` отдаёт за раз. */
const BATCH = 500

/**
 * Приводит уже загруженные изображения к текущим правилам обработки.
 *
 * Снимки, загруженные до появления сжатия, лежали на диске как есть:
 * кадр с камеры шириной 6240 точек давал дериватив на полтора
 * мегабайта, и галерея открывалась минутами. Правила с тех пор
 * менялись и ещё будут, поэтому проверка выполняется при каждом
 * запуске, а трогаются только отставшие записи.
 *
 * `force` пересобирает всё подряд: им пользуется ручной запуск
 * scripts/rebuild-derivatives.js, когда поменялись качество или
 * лестница ширин — такое признаком «отстал» не ловится.
 */
async function repairMedia ({ logger = console, force = false, batch = BATCH } = {}) {
  const repaired = []
  const total = await countMedia()

  /* Идём пакетами до конца таблицы. Раньше брали одну выборку в
     500 записей — а выше неё `listMedia` всё равно не поднимается,
     — и рапортовали «Готово», оставив остальную медиатеку в
     прежнем виде. Молча: в выводе было только число пересобранных.

     Пересборка меняет путь записи, но не её место в порядке
     (`created_at`, `id`), поэтому смещение не съезжает. */
  for (let offset = 0; offset < total; offset += batch) {
    const items = await listMedia({ limit: batch, offset })
    if (items.length === 0) break

    for (const media of items) {
      if (!force && !needsRepair(media)) continue

      try {
        const source = await readFile(absolutePath(media.path))
        const { before, after } = await rebuildMediaFile(media, source)
        repaired.push({ name: media.originalName, before, after })
      } catch (error) {
        logger.warn?.(`Не удалось пересобрать ${media.originalName}: ${error.message}`)
      }
    }
  }

  if (repaired.length > 0) {
    const saved = repaired.reduce((sum, item) => sum + (item.before.bytes - item.after.bytes), 0)
    for (const item of repaired) {
      logger.info?.(
        `Пересобрано ${item.name}: [${item.before.derivatives}] → [${item.after.derivatives}], ` +
        `${Math.round(item.before.bytes / 1024)} КБ → ${Math.round(item.after.bytes / 1024)} КБ.`
      )
    }
    logger.info?.(`Медиатека приведена к текущим правилам: записей ${repaired.length}, ` +
                  `освобождено примерно ${Math.round(saved / 1024)} КБ.`)
  }

  return repaired
}

export { repairMedia }
