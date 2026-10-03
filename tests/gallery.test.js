import test, { before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { resetDatabase, makeImage, closePool } from './helpers.js'
import { createPage } from '../src/repositories/pages.js'
import { createBlock, saveBlockTexts } from '../src/repositories/blocks.js'
import {
  createGallery, saveGalleryTexts, setGalleryItems, getGalleryItems
} from '../src/repositories/galleries.js'
import { saveMediaTexts } from '../src/repositories/media.js'
import { processUpload } from '../src/services/media-processor.js'
import { composePage } from '../src/services/page-composer.js'
import { defaultSettings } from '../src/blocks/index.js'

let pageId
let photos = []

before(async () => { await resetDatabase() })
after(async () => { await closePool() })

beforeEach(async () => {
  await resetDatabase()
  pageId = await createPage({ slug: 'home' })

  photos = []
  for (let seed = 1; seed <= 4; seed += 1) {
    const { media } = await processUpload({
      buffer: await makeImage({ seed, width: 900, height: 600 }),
      originalName: `photo-${seed}.png`,
      mime: 'image/png'
    })
    await saveMediaTexts(media.id, {
      en: { alt: `Photo ${seed}`, caption: `Caption ${seed}` },
      sr: { alt: `Fotografija ${seed}` }
    })
    photos.push(media.id)
  }
})

async function makeGallery (slug, mediaIds, titles) {
  const id = await createGallery(slug)
  await saveGalleryTexts(id, titles)
  await setGalleryItems(id, mediaIds)
  return id
}

function galleryBlocks (page) {
  return page.blocks.filter((block) => block.type === 'gallery')
}

test('два разных альбома живут на одной странице независимо', async () => {
  const live = await makeGallery('live', photos.slice(0, 3), { en: { title: 'Live' }, sr: { title: 'Uživo' } })
  const backstage = await makeGallery('backstage', photos.slice(3), { en: { title: 'Backstage' } })

  await createBlock({
    pageId, type: 'gallery', anchor: 'live',
    settings: { ...defaultSettings('gallery'), gallery_id: live, layout: 'grid', columns: 3 }
  })
  await createBlock({
    pageId, type: 'gallery', anchor: 'backstage',
    settings: { ...defaultSettings('gallery'), gallery_id: backstage, layout: 'strip' }
  })

  const page = await composePage({ slug: 'home', locale: 'en' })
  const blocks = galleryBlocks(page)

  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].gallery.title, 'Live')
  assert.equal(blocks[0].gallery.items.length, 3)
  assert.equal(blocks[0].settings.layout, 'grid')

  assert.equal(blocks[1].gallery.title, 'Backstage')
  assert.equal(blocks[1].gallery.items.length, 1)
  assert.equal(blocks[1].settings.layout, 'strip')
})

test('один альбом в двух вставках: разные раскладки, общий состав', async () => {
  const album = await makeGallery('photos', photos, { en: { title: 'Photos' } })

  await createBlock({
    pageId, type: 'gallery',
    settings: { ...defaultSettings('gallery'), gallery_id: album, layout: 'strip', limit: 2 }
  })
  await createBlock({
    pageId, type: 'gallery',
    settings: { ...defaultSettings('gallery'), gallery_id: album, layout: 'grid', limit: 0 }
  })

  const page = await composePage({ slug: 'home', locale: 'en' })
  const [preview, full] = galleryBlocks(page)

  assert.equal(preview.gallery.items.length, 2, 'limit обрезает показ')
  assert.equal(preview.gallery.totalCount, 4, 'но альбом знает свой полный размер')
  assert.equal(full.gallery.items.length, 4)
  assert.equal(preview.gallery.items[0].id, full.gallery.items[0].id, 'порядок общий')
})

test('перестановка фото в альбоме меняет обе вставки сразу', async () => {
  const album = await makeGallery('photos', photos, { en: { title: 'Photos' } })
  await createBlock({ pageId, type: 'gallery', settings: { ...defaultSettings('gallery'), gallery_id: album } })
  await createBlock({ pageId, type: 'gallery', settings: { ...defaultSettings('gallery'), gallery_id: album } })

  await setGalleryItems(album, [...photos].reverse())

  const page = await composePage({ slug: 'home', locale: 'en' })
  const [first, second] = galleryBlocks(page)

  assert.equal(first.gallery.items[0].id, photos.at(-1))
  assert.equal(second.gallery.items[0].id, photos.at(-1))
  assert.deepEqual(await getGalleryItems(album), [...photos].reverse())
})

test('подписи и alt берутся на нужном языке с откатом на язык по умолчанию', async () => {
  const album = await makeGallery('photos', [photos[0]], { en: { title: 'Photos' }, sr: { title: 'Fotografije' } })
  await createBlock({
    pageId, type: 'gallery',
    settings: { ...defaultSettings('gallery'), gallery_id: album, show_captions: true }
  })

  const en = await composePage({ slug: 'home', locale: 'en' })
  const sr = await composePage({ slug: 'home', locale: 'sr' })

  assert.equal(galleryBlocks(en)[0].gallery.items[0].alt, 'Photo 1')
  assert.equal(galleryBlocks(sr)[0].gallery.items[0].alt, 'Fotografija 1')
  assert.equal(galleryBlocks(sr)[0].gallery.title, 'Fotografije')
  assert.equal(
    galleryBlocks(sr)[0].gallery.items[0].caption, 'Caption 1',
    'сербского перевода подписи нет — берём английский'
  )
})

test('блок со ссылкой на несуществующий альбом не роняет страницу', async () => {
  await createBlock({
    pageId, type: 'gallery',
    settings: { ...defaultSettings('gallery'), gallery_id: 9999 }
  })

  const page = await composePage({ slug: 'home', locale: 'en' })
  assert.equal(galleryBlocks(page)[0].gallery, null)
})

test('скрытый блок на публичную страницу не попадает', async () => {
  const album = await makeGallery('photos', photos, { en: { title: 'Photos' } })
  await createBlock({
    pageId, type: 'gallery', isVisible: false,
    settings: { ...defaultSettings('gallery'), gallery_id: album }
  })

  const page = await composePage({ slug: 'home', locale: 'en' })
  assert.equal(galleryBlocks(page).length, 0)
})

test('меню собирается из блоков с якорем и подписью', async () => {
  const album = await makeGallery('photos', photos, { en: { title: 'Photos' } })

  const withNav = await createBlock({
    pageId, type: 'gallery', anchor: 'photos',
    settings: { ...defaultSettings('gallery'), gallery_id: album }
  })
  await saveBlockTexts(withNav, { en: { nav_label: 'Photos' }, sr: { nav_label: 'Fotografije' } })

  await createBlock({
    pageId, type: 'gallery', anchor: 'hidden-from-nav',
    settings: { ...defaultSettings('gallery'), gallery_id: album }
  })

  const page = await composePage({ slug: 'home', locale: 'sr' })
  assert.deepEqual(page.quicknav, [{ anchor: 'photos', label: 'Fotografije' }])
})
