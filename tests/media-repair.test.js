import test, { beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { stat } from 'node:fs/promises'
import { resetDatabase, makeImage, closePool } from './helpers.js'
import { query } from '../src/db/pool.js'
import config from '../src/config.js'
import { getMedia, listMedia } from '../src/repositories/media.js'
import {
  processUpload, absolutePath, derivativeRelPath, needsRepair, thumbnailUrl
} from '../src/services/media-processor.js'
import { repairMedia } from '../src/services/media-repair.js'

const silent = { info () {}, warn () {} }

beforeEach(async () => { await resetDatabase() })
after(async () => { await closePool() })

async function exists (path) {
  try { await stat(path); return true } catch { return false }
}

test('свежая загрузка в починке не нуждается', async () => {
  const { media } = await processUpload({
    buffer: await makeImage({ width: 1200, height: 800, seed: 61 }),
    originalName: 'fresh.png', mime: 'image/png'
  })

  assert.equal(needsRepair(media), false)
  assert.deepEqual(await repairMedia({ logger: silent }), [])
})

/**
 * Снимки, загруженные до появления сжатия, давали дериватив шириной
 * в кадр камеры — полтора мегабайта на картинку в галерее.
 */
test('запись с шириной сверх предела пересобирается', async () => {
  const { media } = await processUpload({
    buffer: await makeImage({ width: 1200, height: 800, seed: 62 }),
    originalName: 'old.png', mime: 'image/png'
  })

  // Имитируем состояние до сжатия: гигантская ширина и лишняя ступень.
  await query('UPDATE media SET width = ?, derivatives = ?::jsonb WHERE id = ?',
    [6240, JSON.stringify([320, 640, 1280, 1920, 2560, 6240]), media.id])

  const stale = await getMedia(media.id)
  assert.equal(needsRepair(stale), true)

  const repaired = await repairMedia({ logger: silent })
  assert.equal(repaired.length, 1)

  const after = await getMedia(media.id)
  assert.ok(after.width <= config.masterMaxWidth)
  assert.deepEqual(after.derivatives, [160, 320, 640, 1200])
  assert.equal(after.mime, 'image/webp')
})

test('лишние ступени удаляются с диска', async () => {
  const { media } = await processUpload({
    buffer: await makeImage({ width: 1200, height: 800, seed: 63 }),
    originalName: 'extra.png', mime: 'image/png'
  })
  await query('UPDATE media SET derivatives = ?::jsonb WHERE id = ?',
    [JSON.stringify([...media.derivatives, 4096]), media.id])

  await repairMedia({ logger: silent })
  assert.equal(await exists(absolutePath(derivativeRelPath(media.path, 4096))), false)
})

test('починка идемпотентна', async () => {
  await processUpload({
    buffer: await makeImage({ width: 1500, height: 900, seed: 64 }),
    originalName: 'idem.png', mime: 'image/png'
  })
  await query("UPDATE media SET mime = 'image/png'")

  assert.equal((await repairMedia({ logger: silent })).length, 1)
  assert.deepEqual(await repairMedia({ logger: silent }), [])
})

test('повреждённый файл не роняет починку остальных', async () => {
  const good = await processUpload({
    buffer: await makeImage({ width: 1000, height: 700, seed: 65 }),
    originalName: 'good.png', mime: 'image/png'
  })
  await query("UPDATE media SET mime = 'image/png'")
  // Запись, у которой файла на диске нет.
  await query(
    'INSERT INTO media (path, mime, width, height, bytes, hash, original_name, derivatives) ' +
    "VALUES ('2026/10/нет-такого.webp', 'image/png', 900, 600, 100, ?, 'broken.png', '[320]'::jsonb)",
    ['f'.repeat(64)]
  )

  const repaired = await repairMedia({ logger: silent })
  assert.equal(repaired.length, 1, 'целая запись починена')
  assert.equal(repaired[0].name, 'good.png')
  assert.equal((await listMedia()).length, 2, 'битая запись осталась на месте')
  assert.equal((await getMedia(good.media.id)).mime, 'image/webp')
})

test('превью для админки берёт мелкую ступень', async () => {
  const { media } = await processUpload({
    buffer: await makeImage({ width: 2000, height: 1300, seed: 66 }),
    originalName: 'thumb.png', mime: 'image/png'
  })
  assert.match(thumbnailUrl(media), /-160\.webp$/)
})

test('у крошечной картинки превью — она сама', async () => {
  const { media } = await processUpload({
    buffer: await makeImage({ width: 90, height: 90, seed: 67 }),
    originalName: 'tiny.png', mime: 'image/png'
  })
  assert.deepEqual(media.derivatives, [90])
  assert.match(thumbnailUrl(media), /-90\.webp$/)
})
