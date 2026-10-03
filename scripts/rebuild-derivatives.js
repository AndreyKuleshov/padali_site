#!/usr/bin/env node
/**
 * Пересобирает webp-версии для уже загруженных изображений.
 *
 * Нужен после изменения лестницы ширин или качества: записи в медиатеке
 * помнят набор, сгенерированный на момент загрузки, и сами не обновятся.
 * Повторный запуск безопасен — файлы перезаписываются теми же именами.
 */
import { readFile, rm } from 'node:fs/promises'
import sharp from 'sharp'
import config from '../src/config.js'
import { waitForDatabase } from '../src/db/migrate.js'
import { query, closePool } from '../src/db/pool.js'
import { listMedia, countMedia } from '../src/repositories/media.js'
import { absolutePath, derivativeRelPath } from '../src/services/media-processor.js'

async function rebuild (media) {
  const source = await readFile(absolutePath(media.path))
  const normalized = await sharp(source, { failOn: 'error' }).rotate().toBuffer({ resolveWithObject: true })
  const width = normalized.info.width

  const widths = [...new Set([
    ...config.derivativeWidths.filter((candidate) => candidate < width),
    width
  ])].sort((a, b) => a - b)

  for (const targetWidth of widths) {
    await sharp(normalized.data)
      .resize({ width: targetWidth, withoutEnlargement: true })
      .webp({ quality: targetWidth <= 640 ? 82 : 88 })
      .toFile(absolutePath(derivativeRelPath(media.path, targetWidth)))
  }

  // Ступени, которых в новом наборе нет, убираем с диска.
  for (const stale of (media.derivatives ?? []).filter((w) => !widths.includes(w))) {
    await rm(absolutePath(derivativeRelPath(media.path, stale)), { force: true })
  }

  await query('UPDATE media SET derivatives = ?::jsonb, width = ?, height = ? WHERE id = ?',
    [JSON.stringify(widths), width, normalized.info.height, media.id])

  return { before: media.derivatives ?? [], after: widths }
}

try {
  await waitForDatabase()
  const total = await countMedia()
  const items = await listMedia({ limit: 500 })
  console.log(`Файлов в медиатеке: ${total}`)

  for (const media of items) {
    try {
      const { before, after } = await rebuild(media)
      const changed = JSON.stringify(before) !== JSON.stringify(after)
      console.log(`  ${media.originalName}: [${before}] → [${after}]${changed ? '' : ' (без изменений)'}`)
    } catch (error) {
      console.error(`  ${media.originalName}: пропущен — ${error.message}`)
    }
  }
  console.log('Готово. Перезапустите приложение, чтобы сбросить кэш страниц.')
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await closePool()
}
