#!/usr/bin/env node
/**
 * Пересобирает мастер-копии и webp-версии уже загруженных изображений.
 *
 * Нужен после изменения лестницы ширин, качества или предела ширины
 * мастер-копии: записи помнят набор, сделанный на момент загрузки.
 * Повторный запуск безопасен — файлы перезаписываются теми же именами.
 */
import { readFile, rm } from 'node:fs/promises'
import { waitForDatabase } from '../src/db/migrate.js'
import { closePool } from '../src/db/pool.js'
import { listMedia, countMedia, updateMediaFile } from '../src/repositories/media.js'
import {
  absolutePath, derivativeRelPath, writeDerivatives
} from '../src/services/media-processor.js'

async function rebuild (media) {
  const source = await readFile(absolutePath(media.path))
  const before = { path: media.path, derivatives: media.derivatives ?? [], bytes: media.bytes }

  const rebuilt = await writeDerivatives({ buffer: source, mime: media.mime, hash: media.hash })

  // Ступени, которых в новом наборе нет, убираем с диска.
  for (const stale of before.derivatives.filter((w) => !rebuilt.derivatives.includes(w))) {
    await rm(absolutePath(derivativeRelPath(before.path, stale)), { force: true })
  }
  if (before.path !== rebuilt.path) await rm(absolutePath(before.path), { force: true })

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

  return { before, after: rebuilt }
}

try {
  await waitForDatabase()
  const total = await countMedia()
  const items = await listMedia({ limit: 500 })
  console.log(`Файлов в медиатеке: ${total}`)

  let saved = 0
  for (const media of items) {
    try {
      const { before, after } = await rebuild(media)
      saved += before.bytes - after.bytes
      console.log(
        `  ${media.originalName}: [${before.derivatives}] → [${after.derivatives}], ` +
        `${Math.round(before.bytes / 1024)} КБ → ${Math.round(after.bytes / 1024)} КБ`
      )
    } catch (error) {
      console.error(`  ${media.originalName}: пропущен — ${error.message}`)
    }
  }
  console.log(`Готово. Освобождено примерно ${Math.round(saved / 1024)} КБ. ` +
              'Перезапустите приложение, чтобы сбросить кэш страниц.')
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await closePool()
}
