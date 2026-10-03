import test, { beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { stat } from 'node:fs/promises'
import { resetDatabase, makeImage, closePool } from './helpers.js'
import config from '../src/config.js'
import {
  processUpload, deleteFiles, absolutePath, derivativeRelPath, pictureSources, UploadError
} from '../src/services/media-processor.js'
import { createPage } from '../src/repositories/pages.js'
import { createBlock, saveBlockMedia } from '../src/repositories/blocks.js'
import { createGallery, setGalleryItems } from '../src/repositories/galleries.js'
import { mediaUsage, countMedia, deleteMedia } from '../src/repositories/media.js'
import { defaultSettings } from '../src/blocks/index.js'

beforeEach(async () => { await resetDatabase() })
after(async () => { await closePool() })

async function exists (path) {
  try { await stat(path); return true } catch { return false }
}

test('загрузка создаёт деривативы по всем подходящим ширинам', async () => {
  const { media } = await processUpload({
    buffer: await makeImage({ width: 1500, height: 1000, seed: 3 }),
    originalName: 'wide.png',
    mime: 'image/png'
  })

  assert.deepEqual(media.derivatives, [320, 640, 1280, 1500],
    'ступени ниже оригинала плюс его полная ширина')
  assert.equal(media.width, 1500)
  assert.ok(await exists(absolutePath(media.path)), 'оригинал сохранён')
  for (const width of media.derivatives) {
    assert.ok(await exists(absolutePath(derivativeRelPath(media.path, width))), `дериватив ${width} на месте`)
  }
})

test('узкая картинка не растягивается', async () => {
  const { media } = await processUpload({
    buffer: await makeImage({ width: 200, height: 200, seed: 9 }),
    originalName: 'tiny.png',
    mime: 'image/png'
  })
  assert.deepEqual(media.derivatives, [200])
})

/**
 * Без полной ширины в наборе srcset обрывался на предыдущей ступени:
 * у снимка 1100px лучшим кандидатом оказывался 640px, и браузер
 * растягивал его на всю шапку.
 */
test('srcset включает полную ширину оригинала', async () => {
  const { media } = await processUpload({
    buffer: await makeImage({ width: 1100, height: 688, seed: 21 }),
    originalName: 'hero.png',
    mime: 'image/png'
  })

  assert.deepEqual(media.derivatives, [320, 640, 1100])

  const sources = pictureSources(media)
  assert.match(sources.srcset, /1100w/, 'крупнейший кандидат — полная ширина')
  assert.match(sources.src, /-1100\.webp$/, 'запасной src тоже полноразмерный')
  assert.ok(await exists(absolutePath(derivativeRelPath(media.path, 1100))))
})

test('ширина, совпадающая со ступенью, не дублируется', async () => {
  const { media } = await processUpload({
    buffer: await makeImage({ width: 640, height: 400, seed: 22 }),
    originalName: 'exact.png',
    mime: 'image/png'
  })
  assert.deepEqual(media.derivatives, [320, 640])
})

test('повторная загрузка того же файла не создаёт дубль', async () => {
  const buffer = await makeImage({ seed: 42 })
  const first = await processUpload({ buffer, originalName: 'a.png', mime: 'image/png' })
  const second = await processUpload({ buffer, originalName: 'b.png', mime: 'image/png' })

  assert.equal(second.deduplicated, true)
  assert.equal(second.media.id, first.media.id)
  assert.equal(await countMedia(), 1)
})

test('не-изображение и запрещённый тип отклоняются', async () => {
  await assert.rejects(
    processUpload({ buffer: Buffer.from('<svg/>'), originalName: 'x.svg', mime: 'image/svg+xml' }),
    UploadError
  )
  await assert.rejects(
    processUpload({ buffer: Buffer.from('не картинка'), originalName: 'x.png', mime: 'image/png' }),
    UploadError
  )
})

test('использование файла видно и в блоках, и в альбомах', async () => {
  const pageId = await createPage({ slug: 'home' })
  const { media } = await processUpload({
    buffer: await makeImage({ seed: 5 }), originalName: 'used.png', mime: 'image/png'
  })

  const free = await mediaUsage(media.id)
  assert.equal(free.isUsed, false)

  const block = await createBlock({ pageId, type: 'hero', settings: defaultSettings('hero') })
  await saveBlockMedia(block, { background: [media.id] })

  const gallery = await createGallery('album')
  await setGalleryItems(gallery, [media.id])

  const used = await mediaUsage(media.id)
  assert.equal(used.isUsed, true)
  assert.equal(used.blocks.length, 1)
  assert.equal(used.galleries.length, 1)
})

test('база не даёт удалить файл, на который есть ссылка', async () => {
  const gallery = await createGallery('album')
  const { media } = await processUpload({
    buffer: await makeImage({ seed: 6 }), originalName: 'locked.png', mime: 'image/png'
  })
  await setGalleryItems(gallery, [media.id])

  await assert.rejects(deleteMedia(media.id), /foreign key|violates/i)
})

test('удаление свободного файла убирает и запись, и файлы с диска', async () => {
  const { media } = await processUpload({
    buffer: await makeImage({ seed: 7, width: 800 }), originalName: 'free.png', mime: 'image/png'
  })

  await deleteMedia(media.id)
  await deleteFiles(media)

  assert.equal(await countMedia(), 0)
  assert.equal(await exists(absolutePath(media.path)), false)
  for (const width of media.derivatives) {
    assert.equal(await exists(absolutePath(derivativeRelPath(media.path, width))), false)
  }
})

test('файлы раскладываются по году и месяцу внутри каталога загрузок', async () => {
  const { media } = await processUpload({
    buffer: await makeImage({ seed: 8 }), originalName: 'dated.png', mime: 'image/png'
  })
  assert.match(media.path, /^\d{4}\/\d{2}\/[a-f0-9]{64}\.png$/)
  assert.ok(absolutePath(media.path).startsWith(config.uploadDir))
})
