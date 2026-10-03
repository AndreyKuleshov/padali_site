import { readdir, readFile, rm } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { query } from '../db/pool.js'
import { findMediaByHash, getMediaByManagedKey, updateMediaFile } from '../repositories/media.js'
import {
  hashOf, writeDerivatives, deleteFiles, expectedWidths, MIME_BY_EXTENSION
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
         включая многомегабайтные png. Чиним оба случая. */
      const expected = expectedWidths(media.width)
      const actual = [...(media.derivatives ?? [])].sort((a, b) => a - b)
      const widthsOk = JSON.stringify(expected) === JSON.stringify(actual)
      const masterOk = media.mime === 'image/webp' && media.path.endsWith('.webp')
      if (widthsOk && masterOk) continue

      const previousPath = media.path
      const previousBytes = media.bytes
      const rebuilt = await writeDerivatives({ buffer, mime: source.mime, hash })
      await updateMediaFile(media.id, {
        path: rebuilt.path, mime: 'image/webp',
        width: rebuilt.width, height: rebuilt.height, bytes: rebuilt.bytes,
        hash, originalName: media.originalName, derivatives: rebuilt.derivatives
      })
      // Прежний мастер другого формата остался бы висеть на диске.
      if (previousPath !== rebuilt.path) {
        await deleteFiles({ path: previousPath, derivatives: [] })
      }
      logger.info?.(
        `Пересобран ${media.originalName}: [${actual}] → [${rebuilt.derivatives}], ` +
        `${Math.round(previousBytes / 1024)} КБ → ${Math.round(rebuilt.bytes / 1024)} КБ.`
      )
      updated.push({ key: source.key, file: source.file, width: rebuilt.width, height: rebuilt.height })
      continue
    }

    // Та же картинка уже лежит в медиатеке под другой записью —
    // две записи с одним hash нарушили бы уникальность.
    const clash = await findMediaByHash(hash)
    if (clash) {
      logger.warn?.(`Файл ${source.file} совпадает с уже загруженным «${clash.originalName}» — пропускаю.`)
      continue
    }

    const previous = { path: media.path, derivatives: media.derivatives }
    const written = await writeDerivatives({ buffer, mime: source.mime, hash })

    await updateMediaFile(media.id, {
      path: written.path,
      mime: 'image/webp',
      width: written.width,
      height: written.height,
      bytes: written.bytes,
      hash,
      originalName: source.file,
      derivatives: written.derivatives
    })

    await deleteFiles(previous)
    updated.push({ key: source.key, file: source.file, width: written.width, height: written.height })
  }

  if (updated.length > 0) {
    for (const item of updated) {
      const usage = await query(
        'SELECT COUNT(*)::int AS uses FROM block_media WHERE media_id = ' +
        '(SELECT id FROM media WHERE managed_key = ?)', [item.key]
      )
      const uses = usage[0]?.uses ?? 0
      logger.info?.(
        `Обновлён файл ${item.file} (${item.width}×${item.height}); ` +
        (uses > 0 ? `используется в блоках: ${uses}.` : 'в блоках сейчас не используется.')
      )
    }
  }

  return updated
}

export { syncManagedAssets, listManagedSources, MANAGED_DIR }
