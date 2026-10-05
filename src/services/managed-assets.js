import { readdir, readFile, rm } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  findMediaByHash, getMediaByManagedKey, countBlockUsesByManagedKey
} from '../repositories/media.js'
import {
  hashOf, rebuildMediaFile, MIME_BY_EXTENSION, needsRepair
} from './media-processor.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MANAGED_DIR = join(ROOT, 'seed-assets')

/**
 * Файлы, которыми управляет репозиторий. Ключ — имя файла без
 * расширения, поэтому добавление нового изображения не требует кода.
 */
async function listManagedSources (dir = MANAGED_DIR) {
  let names
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  return names
    .filter((name) => MIME_BY_EXTENSION[extname(name).toLowerCase()])
    .sort()
    .map((name) => ({
      key: basename(name, extname(name)),
      file: name,
      path: join(dir, name),
      mime: MIME_BY_EXTENSION[extname(name).toLowerCase()]
    }))
}

/**
 * Подтягивает в медиатеку изменившиеся файлы репозитория.
 *
 * Содержимое записи заменяется на месте, поэтому все ссылки на неё —
 * блоки, альбомы — продолжают работать и показывают новое изображение.
 * Записи, созданной не из репозитория, механизм не касается: если
 * редактор выбрал в админке свою фотографию, она остаётся.
 */
async function syncManagedAssets ({ logger = console, dir = MANAGED_DIR } = {}) {
  const sources = await listManagedSources(dir)
  const updated = []

  for (const source of sources) {
    const media = await getMediaByManagedKey(source.key)
    if (!media) continue // создаётся только при первичном наполнении

    const buffer = await readFile(source.path)
    const hash = hashOf(buffer)

    if (hash === media.hash) {
      /* Содержимое прежнее, но устареть мог и набор ширин, и сам
         мастер: раньше на диск клался присланный файл как есть,
         включая многомегабайтные png. Проверка — та же, что у
         repairMedia: своя копия здесь уже отстала, в ней не было
         условия про ширину мастера. */
      if (!needsRepair(media)) continue

      const { before, after } = await rebuildMediaFile(media, buffer)
      logger.info?.(
        `Пересобран ${media.originalName}: [${before.derivatives}] → [${after.derivatives}], ` +
        `${Math.round(before.bytes / 1024)} КБ → ${Math.round(after.bytes / 1024)} КБ.`
      )
      updated.push({ key: source.key, file: source.file, width: after.width, height: after.height })
      continue
    }

    // Та же картинка уже лежит в медиатеке под другой записью —
    // две записи с одним hash нарушили бы уникальность.
    const clash = await findMediaByHash(hash)
    if (clash) {
      logger.warn?.(`Файл ${source.file} совпадает с уже загруженным «${clash.originalName}» — пропускаю.`)
      continue
    }

    const { after } = await rebuildMediaFile(media, buffer, { hash, originalName: source.file })
    updated.push({ key: source.key, file: source.file, width: after.width, height: after.height })
  }

  if (updated.length > 0) {
    for (const item of updated) {
      const uses = await countBlockUsesByManagedKey(item.key)
      logger.info?.(
        `Обновлён файл ${item.file} (${item.width}×${item.height}); ` +
        (uses > 0 ? `используется в блоках: ${uses}.` : 'в блоках сейчас не используется.')
      )
    }
  }

  return updated
}

export { syncManagedAssets, MANAGED_DIR }
