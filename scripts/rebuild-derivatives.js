#!/usr/bin/env node
/**
 * Пересобирает мастер-копии и webp-версии уже загруженных изображений.
 *
 * Нужен после изменения лестницы ширин, качества или предела ширины
 * мастер-копии: записи помнят набор, сделанный на момент загрузки, и
 * «отставшими» по формату не выглядят — поэтому здесь пересобирается
 * всё подряд. Сама работа — та же, что при запуске приложения:
 * повторять её вторым кодом значило бы чинить потом в двух местах.
 */
import { waitForDatabase } from '../src/db/migrate.js'
import { closePool } from '../src/db/pool.js'
import { countMedia } from '../src/repositories/media.js'
import { repairMedia } from '../src/services/media-repair.js'

try {
  await waitForDatabase()
  console.log(`Файлов в медиатеке: ${await countMedia()}`)

  const repaired = await repairMedia({ force: true, logger: { info: console.log, warn: console.warn } })

  console.log(`Готово, пересобрано записей: ${repaired.length}. ` +
              'Перезапустите приложение, чтобы сбросить кэш страниц.')
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await closePool()
}
