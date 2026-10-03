import { readFile, rm } from 'node:fs/promises'
import { listMedia, updateMediaFile } from '../repositories/media.js'
import {
  absolutePath, derivativeRelPath, writeDerivatives, needsRepair
} from './media-processor.js'

/**
 * Приводит уже загруженные изображения к текущим правилам обработки.
 *
 * Снимки, загруженные до появления сжатия, лежали на диске как есть:
 * кадр с камеры шириной 6240 точек давал дериватив на полтора
 * мегабайта, и галерея открывалась минутами. Правила с тех пор
 * менялись и ещё будут, поэтому проверка выполняется при каждом
 * запуске, а трогаются только отставшие записи.
 */
async function repairMedia ({ logger = console, limit = 500 } = {}) {
  const items = await listMedia({ limit })
  const repaired = []

  for (const media of items) {
    if (!needsRepair(media)) continue

    try {
      const source = await readFile(absolutePath(media.path))
      const before = { path: media.path, derivatives: media.derivatives ?? [], bytes: media.bytes }
      const rebuilt = await writeDerivatives({ buffer: source, mime: media.mime, hash: media.hash })

      await updateMediaFile(media.id, {
        path: rebuilt.path,
        mime: 'image/webp',
        width: rebuilt.width,
        height: rebuilt.height,
        bytes: rebuilt.bytes,
        hash: media.hash,
        originalName: media.originalName,
        derivatives: rebuilt.derivatives
      })

      // Ступени и мастер прежнего формата иначе остались бы на диске.
      for (const stale of before.derivatives.filter((w) => !rebuilt.derivatives.includes(w))) {
        await rm(absolutePath(derivativeRelPath(before.path, stale)), { force: true })
      }
      if (before.path !== rebuilt.path) await rm(absolutePath(before.path), { force: true })

      repaired.push({ name: media.originalName, before, after: rebuilt })
    } catch (error) {
      logger.warn?.(`Не удалось пересобрать ${media.originalName}: ${error.message}`)
    }
  }

  if (repaired.length > 0) {
    const saved = repaired.reduce((sum, item) => sum + (item.before.bytes - item.after.bytes), 0)
    for (const item of repaired) {
      logger.info?.(
        `Пересобрано ${item.name}: ${item.before.after ?? ''}` +
        `[${item.before.derivatives}] → [${item.after.derivatives}], ` +
        `${Math.round(item.before.bytes / 1024)} КБ → ${Math.round(item.after.bytes / 1024)} КБ.`
      )
    }
    logger.info?.(`Медиатека приведена к текущим правилам: записей ${repaired.length}, ` +
                  `освобождено примерно ${Math.round(saved / 1024)} КБ.`)
  }

  return repaired
}

export { repairMedia }
