import test, { beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetDatabase, makeImage, closePool } from './helpers.js'
import { createPage } from '../src/repositories/pages.js'
import { createBlock, saveBlockMedia, getBlockMedia } from '../src/repositories/blocks.js'
import { getMedia, getMediaByManagedKey, countMedia } from '../src/repositories/media.js'
import { processUpload, absolutePath, derivativeRelPath } from '../src/services/media-processor.js'
import { syncManagedAssets } from '../src/services/managed-assets.js'
import { composePage } from '../src/services/page-composer.js'
import { defaultSettings } from '../src/blocks/index.js'
import { stat } from 'node:fs/promises'
import { query } from '../src/db/pool.js'

const silent = { info () {}, warn () {} }
let dir

beforeEach(async () => {
  await resetDatabase()
  dir = await mkdtemp(join(tmpdir(), 'padali-managed-'))
})

after(async () => { await closePool() })

async function exists (path) {
  try { await stat(path); return true } catch { return false }
}

/** Управляемая репозиторием картинка, прикреплённая к блоку шапки. */
async function seedManagedHero () {
  const pageId = await createPage({ slug: 'home' })
  const buffer = await makeImage({ width: 900, height: 600, seed: 1 })
  await writeFile(join(dir, 'band-photo.png'), buffer)

  const { media } = await processUpload({
    buffer, originalName: 'band-photo.png', mime: 'image/png', managedKey: 'band-photo'
  })

  const block = await createBlock({ pageId, type: 'hero', settings: defaultSettings('hero') })
  await saveBlockMedia(block, { background: [media.id] })
  return { pageId, block, media }
}

test('замена файла в репозитории обновляет картинку на сайте', async () => {
  const { media } = await seedManagedHero()

  // Тот же ключ, другое содержимое и другой размер.
  await writeFile(join(dir, 'band-photo.png'), await makeImage({ width: 1400, height: 900, seed: 2 }))
  const updated = await syncManagedAssets({ logger: silent, dir })

  assert.equal(updated.length, 1)
  const after = await getMedia(media.id)
  assert.equal(after.id, media.id, 'запись та же — ссылки из блоков не рвутся')
  assert.equal(after.width, 1400)
  assert.notEqual(after.hash, media.hash)
  assert.deepEqual(after.derivatives, [160, 320, 640, 1280, 1400])
  assert.equal(await countMedia(), 1, 'дубль не создаётся')

  const page = await composePage({ slug: 'home', locale: 'en' })
  assert.match(page.blocks[0].media.background[0].srcset, /1400w/)
})

test('старые файлы прежней версии удаляются с диска', async () => {
  const { media } = await seedManagedHero()
  const oldOriginal = absolutePath(media.path)
  const oldDerivative = absolutePath(derivativeRelPath(media.path, 320))
  assert.ok(await exists(oldOriginal))

  await writeFile(join(dir, 'band-photo.png'), await makeImage({ width: 1400, height: 900, seed: 3 }))
  await syncManagedAssets({ logger: silent, dir })

  assert.equal(await exists(oldOriginal), false, 'прежний оригинал убран')
  assert.equal(await exists(oldDerivative), false, 'прежние деривативы убраны')
})

test('повторный запуск без изменений ничего не делает', async () => {
  await seedManagedHero()
  assert.deepEqual(await syncManagedAssets({ logger: silent, dir }), [])
  assert.deepEqual(await syncManagedAssets({ logger: silent, dir }), [])
})

/**
 * Если редактор выбрал в админке свою фотографию, репозиторий в это
 * место больше не вмешивается: человек главнее файла в git.
 */
test('выбранная в админке фотография заменой файла не затирается', async () => {
  const { block } = await seedManagedHero()

  const own = await processUpload({
    buffer: await makeImage({ width: 1200, height: 800, seed: 42 }),
    originalName: 'своё-фото.png', mime: 'image/png'
  })
  await saveBlockMedia(block, { background: [own.media.id] })

  await writeFile(join(dir, 'band-photo.png'), await makeImage({ width: 1400, height: 900, seed: 5 }))
  await syncManagedAssets({ logger: silent, dir })

  const attached = await getBlockMedia(block)
  assert.deepEqual(attached.background, [own.media.id], 'в шапке осталась фотография редактора')
  const mine = await getMedia(own.media.id)
  assert.equal(mine.width, 1200, 'её содержимое не тронуто')
})

test('запись без ключа репозитория не трогается', async () => {
  await resetDatabase()
  const own = await processUpload({
    buffer: await makeImage({ width: 500, height: 500, seed: 7 }),
    originalName: 'band-photo.png', mime: 'image/png'
  })
  await writeFile(join(dir, 'band-photo.png'), await makeImage({ width: 1400, height: 900, seed: 8 }))

  assert.deepEqual(await syncManagedAssets({ logger: silent, dir }), [])
  assert.equal((await getMedia(own.media.id)).width, 500)
  assert.equal(await getMediaByManagedKey('band-photo'), null)
})

/**
 * Лестница ширин менялась уже после первых загрузок: у старых записей
 * срезана верхняя ступень, и браузер растягивал мелкий кадр.
 */
test('устаревший набор ширин чинится при неизменном файле', async () => {
  const { media } = await seedManagedHero()

  // Имитируем состояние до исправления: верхней ступени нет.
  await query('UPDATE media SET derivatives = ?::jsonb WHERE id = ?',
    [JSON.stringify([320, 640]), media.id])

  const updated = await syncManagedAssets({ logger: silent, dir })
  assert.equal(updated.length, 1, 'запись пересобрана')

  const after = await getMedia(media.id)
  assert.deepEqual(after.derivatives, [160, 320, 640, 900], 'полная ширина вернулась в набор')
  assert.equal(after.hash, media.hash, 'содержимое то же, перезалива не было')
  assert.ok(await exists(absolutePath(derivativeRelPath(after.path, 900))))
})

/** Старые записи хранили присланный файл как есть, включая тяжёлые png. */
test('мастер-копия не в webp пересобирается при неизменном файле', async () => {
  const { media } = await seedManagedHero()
  await query('UPDATE media SET mime = ?, path = ? WHERE id = ?',
    ['image/png', media.path.replace(/\.webp$/, '.png'), media.id])

  const updated = await syncManagedAssets({ logger: silent, dir })
  assert.equal(updated.length, 1)

  const after = await getMedia(media.id)
  assert.equal(after.mime, 'image/webp')
  assert.match(after.path, /\.webp$/)
})

test('совпадение с уже загруженным файлом не нарушает уникальность', async () => {
  const { media } = await seedManagedHero()
  const duplicate = await makeImage({ width: 1400, height: 900, seed: 9 })
  await processUpload({ buffer: duplicate, originalName: 'уже-есть.png', mime: 'image/png' })

  await writeFile(join(dir, 'band-photo.png'), duplicate)
  assert.deepEqual(await syncManagedAssets({ logger: silent, dir }), [], 'замена пропущена')
  assert.equal((await getMedia(media.id)).hash, media.hash)
})
