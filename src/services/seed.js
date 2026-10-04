import { readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { query, transaction } from '../db/pool.js'
import { db } from '../repositories/helpers.js'
import { createPage, getPageBySlug, savePageTexts } from '../repositories/pages.js'
import { createBlock, listBlocks, saveBlockTexts, saveBlockMedia } from '../repositories/blocks.js'
import { listLocales } from '../repositories/locales.js'
import { createGallery, saveGalleryTexts, setGalleryItems } from '../repositories/galleries.js'
import { saveMediaTexts } from '../repositories/media.js'
import { getSetting, setSetting } from '../repositories/settings.js'
import { processUpload, MIME_BY_EXTENSION } from './media-processor.js'
import { MANAGED_DIR } from './managed-assets.js'
import { defaultSettings } from '../blocks/index.js'

/**
 * Кладёт файл репозитория в медиатеку и помечает его ключом: по нему
 * запись потом обновится, если файл в репозитории заменят.
 * Отсутствие файла не валит сидирование.
 */
async function importAsset (directory, filename, texts, logger) {
  try {
    const buffer = await readFile(join(directory, filename))
    const { media } = await processUpload({
      buffer,
      originalName: filename,
      mime: MIME_BY_EXTENSION[extname(filename).toLowerCase()] ?? 'image/webp',
      managedKey: basename(filename, extname(filename))
    })
    if (texts) await saveMediaTexts(media.id, texts)
    return media.id
  } catch (error) {
    logger.warn?.(`Не удалось импортировать ${filename}: ${error.message}`)
    return null
  }
}

/**
 * Первичное наполнение: содержимое исходного лендинга переносится в базу.
 * Запускается один раз — при пустой таблице pages.
 */
async function ensureSeeded ({ logger = console } = {}) {
  const [{ total }] = await query('SELECT COUNT(*) AS total FROM pages')
  if (Number(total) > 0) return false

  logger.info?.('База пуста — переношу содержимое исходного лендинга.')

  await transaction(async (conn) => {
    const insertLocale =
      'INSERT INTO locales (code, title, is_default, position) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT (code) DO NOTHING'
    await db(conn).run(insertLocale, ['en', 'English', true, 0])
    await db(conn).run(insertLocale, ['sr', 'Srpski', false, 1])
  })

  const pageId = await createPage({ slug: 'home' })
  await savePageTexts(pageId, {
    en: {
      title: 'PADALI',
      description: 'PADALI — rapcore band. New single «POČETAK» — out October 22 on all major streaming platforms.'
    },
    sr: {
      title: 'PADALI',
      description: 'PADALI — repkor bend. Novi singl «POČETAK» — 22. oktobra na svim striming platformama.'
    }
  })

  /* ─── Медиатека ───────────────────────────────────────── */
  const bandPhotoId = await importAsset(MANAGED_DIR, 'band-photo.png', {
    en: { alt: 'PADALI band' }, sr: { alt: 'Bend PADALI' }
  }, logger)
  const coverId = await importAsset(MANAGED_DIR, 'single-cover.webp', {
    en: { alt: 'POČETAK single cover' }, sr: { alt: 'Omot singla POČETAK' }
  }, logger)
  const posterId = await importAsset(MANAGED_DIR, 'concert-poster.webp', {
    en: { alt: 'PADALI live at SKC NS Fabrika, 16.10.2026' },
    sr: { alt: 'PADALI uživo u SKC NS Fabrika, 16.10.2026.' }
  }, logger)
  const markId = await importAsset(MANAGED_DIR, 'padali-mark.webp', {
    en: { alt: 'PADALI mark' }, sr: { alt: 'Znak PADALI' }
  }, logger)

  /* ─── Блоки ───────────────────────────────────────────── */
  const hero = await createBlock({
    pageId,
    type: 'hero',
    settings: { ...defaultSettings('hero'), show_wordmark: true, full_height: true }
  })
  await saveBlockTexts(hero, {
    en: { tagline: 'Rapcore band. Loud, honest, right now.' },
    sr: { tagline: 'Repkor bend. Glasno, iskreno, upravo sada.' }
  })
  if (bandPhotoId) await saveBlockMedia(hero, { background: [bandPhotoId] })

  const release = await createBlock({
    pageId,
    type: 'release',
    anchor: 'release',
    settings: {
      ...defaultSettings('release'),
      release_date: '2026-10-22',
      show_countdown: true,
      platforms: [
        { icon: 'spotify', label: 'Spotify', url: '' },
        { icon: 'apple-music', label: 'Apple Music', url: '' },
        { icon: 'youtube-music', label: 'YouTube Music', url: '' },
        { icon: 'deezer', label: 'Deezer', url: '' },
        { icon: 'tiktok', label: 'TikTok', url: '' }
      ]
    }
  })
  await saveBlockTexts(release, {
    en: {
      nav_label: 'Music',
      eyebrow: 'First single',
      title: 'POČETAK',
      note: 'Out on all major streaming platforms.',
      more_label: '+ more',
      countdown_label: '{days} days until release'
    },
    sr: {
      nav_label: 'Muzika',
      eyebrow: 'Prvi singl',
      title: 'POČETAK',
      note: 'Dostupno na svim većim striming platformama.',
      more_label: '+ još',
      countdown_label: '{days} dana do izlaska'
    }
  })
  await saveBlockMedia(release, {
    cover: coverId ? [coverId] : [],
    sticker: markId ? [markId] : []
  })

  const concert = await createBlock({
    pageId,
    type: 'concert',
    anchor: 'concert',
    settings: { ...defaultSettings('concert'), date: '2026-10-16', ticket_url: '' }
  })
  await saveBlockTexts(concert, {
    en: {
      nav_label: 'Concert',
      heading: 'Upcoming concert',
      venue: 'Novi Sad — SKC NS “Fabrika”',
      note: 'Supported by MM Concerts and Serbian Hellbangers.',
      tag: 'FSP · 16.10.2026'
    },
    sr: {
      nav_label: 'Koncert',
      heading: 'Naredni koncert',
      venue: 'Novi Sad — SKC NS „Fabrika“',
      note: 'Uz podršku MM Concerts i Serbian Hellbangers.',
      tag: 'FSP · 16.10.2026'
    }
  })
  if (posterId) await saveBlockMedia(concert, { poster: [posterId] })

  /* ─── Альбом и блок-галерея ───────────────────────────── */
  const galleryId = await createGallery('photos')
  await saveGalleryTexts(galleryId, {
    en: { title: 'Photos', description: 'Live shots and backstage.' },
    sr: { title: 'Fotografije', description: 'Snimci sa svirki i iz bekstejdža.' }
  })
  await setGalleryItems(galleryId, [bandPhotoId, posterId, coverId].filter(Boolean))

  const galleryBlock = await createBlock({
    pageId,
    type: 'gallery',
    anchor: 'photos',
    settings: { ...defaultSettings('gallery'), gallery_id: galleryId, layout: 'grid', columns: 3 }
  })
  await saveBlockTexts(galleryBlock, {
    en: { nav_label: 'Photos', heading: 'Photos' },
    sr: { nav_label: 'Fotografije', heading: 'Fotografije' }
  })

  const links = await createBlock({
    pageId,
    type: 'links',
    anchor: 'follow',
    settings: {
      ...defaultSettings('links'),
      items: [
        { icon: 'instagram', label: 'Instagram', handle: '@padali.band', url: 'https://instagram.com/padali.band' },
        { icon: 'tiktok', label: 'TikTok', handle: '@padali.band', url: 'https://www.tiktok.com/@padali.band' },
        { icon: 'youtube', label: 'YouTube', handle: '@PADALIband', url: 'https://www.youtube.com/@PADALIband' }
      ]
    }
  })
  await saveBlockTexts(links, {
    en: { nav_label: 'Follow', heading: 'Listen & watch' },
    sr: { nav_label: 'Mreže', heading: 'Slušajte i gledajte' }
  })

  /* ─── Настройки ───────────────────────────────────────── */
  await setSetting('social', [
    { icon: 'instagram', label: 'Instagram', url: 'https://instagram.com/padali.band' },
    { icon: 'tiktok', label: 'TikTok', url: 'https://www.tiktok.com/@padali.band' },
    { icon: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/@PADALIband' }
  ])
  await setSetting('footer_note', 'padali.band')
  await setSetting('og_image_id', bandPhotoId)

  logger.info?.('Содержимое перенесено: 5 блоков, 1 альбом, 4 изображения.')
  return true
}


/**
 * Заводит блок подвала, если его ещё нет.
 *
 * Подвал есть у сайта всегда: до появления блока он рисовался
 * статически и не редактировался. Создаём один раз и помечаем это
 * в настройках — если редактор потом удалит блок, подвал вернётся
 * к статическому виду и воскресать не будет.
 */
async function ensureFooterBlock ({ logger = console } = {}) {
  if (await getSetting('footer_block_created', false)) return false

  const page = await getPageBySlug('home')
  if (!page) return false

  const blocks = await listBlocks(page.id)
  if (blocks.some((block) => block.type === 'footer')) {
    await setSetting('footer_block_created', true)
    return false
  }

  const id = await createBlock({
    pageId: page.id,
    type: 'footer',
    settings: defaultSettings('footer')
  })

  // Строку из настроек переносим в блок, чтобы подвал не опустел.
  const note = await getSetting('footer_note', '')
  if (note) {
    const locales = await listLocales()
    const texts = {}
    for (const locale of locales) texts[locale.code] = { note }
    await saveBlockTexts(id, texts)
  }

  logger.info?.('Создан блок подвала — теперь его можно редактировать.')
  await setSetting('footer_block_created', true)
  return true
}

export { ensureSeeded, ensureFooterBlock }
