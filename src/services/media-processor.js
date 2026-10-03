import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import sharp from 'sharp'
import config from '../config.js'
import { findMediaByHash, insertMedia } from '../repositories/media.js'

const MIME_BY_EXTENSION = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif'
}

class UploadError extends Error {
  constructor (message) {
    super(message)
    this.name = 'UploadError'
    this.statusCode = 400
  }
}

function hashOf (buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Ширины, которые должны существовать для оригинала такой ширины.
 * Апскейла нет, но полная ширина входит всегда: без неё srcset
 * обрывался бы на предыдущей ступени и браузер растягивал бы кадр,
 * хотя на диске есть версия крупнее.
 */
function expectedWidths (width) {
  return [...new Set([
    ...config.derivativeWidths.filter((candidate) => candidate < width),
    width
  ])].sort((a, b) => a - b)
}

/** Папка по году и месяцу: каталог загрузок не превращается в свалку. */
function datedFolder (date = new Date()) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${year}/${month}`
}

function absolutePath (relativePath) {
  return join(config.uploadDir, relativePath)
}

/** URL для отдачи файла: статика смонтирована на /uploads. */
function mediaUrl (relativePath) {
  return `/uploads/${relativePath}`
}

function derivativeRelPath (relativeOriginal, width) {
  const dir = dirname(relativeOriginal)
  const base = relativeOriginal.slice(dir.length + 1, -extname(relativeOriginal).length)
  return `${dir}/${base}-${width}.webp`
}

/**
 * Кладёт оригинал на диск и генерирует webp-версии.
 * Общая часть загрузки через админку и обновления файлов репозитория.
 *
 * @returns {{path: string, width: number, height: number, derivatives: number[]}}
 */
async function writeDerivatives ({ buffer, mime, hash }) {
  let image = sharp(buffer, { failOn: 'error' })
  let metadata
  try {
    metadata = await image.metadata()
  } catch {
    throw new UploadError('Файл не является изображением или повреждён.')
  }
  if (!metadata.width || !metadata.height) {
    throw new UploadError('Не удалось определить размеры изображения.')
  }

  /* Присланный файл на диск не кладём: вместо него пишем мастер-копию
     в webp, повёрнутую по EXIF и ограниченную по ширине. Снимок с
     телефона на 12 мегабайт превращается в несколько сотен килобайт,
     а качества хватает и для деривативов, и для полноэкранного показа.

     Исключение — уже готовый webp подходящей ширины: перекодировать
     его бессмысленно. Это вторая потеря качества, а размер от неё
     может даже вырасти, если исходник был сжат сильнее нашего. */
  const alreadyFine =
    mime === 'image/webp' &&
    metadata.width <= config.masterMaxWidth &&
    (metadata.orientation ?? 1) === 1

  const master = alreadyFine
    ? { data: buffer, info: { width: metadata.width, height: metadata.height } }
    : await image
        .rotate()
        .resize({ width: config.masterMaxWidth, withoutEnlargement: true })
        .webp({ quality: config.masterQuality })
        .toBuffer({ resolveWithObject: true })

  const width = master.info.width
  const height = master.info.height

  const folder = datedFolder()
  const relativeMaster = `${folder}/${hash}.webp`

  await mkdir(absolutePath(folder), { recursive: true })
  await writeFile(absolutePath(relativeMaster), master.data)

  const widths = expectedWidths(width)

  for (const targetWidth of widths) {
    await sharp(master.data)
      .resize({ width: targetWidth, withoutEnlargement: true })
      // Мелкие кадры сжимаем сильнее: на превью разницы не видно,
      // а крупные идут в шапку и на весь экран.
      .webp({ quality: targetWidth <= 640 ? 80 : 86 })
      .toFile(absolutePath(derivativeRelPath(relativeMaster, targetWidth)))
  }

  return {
    path: relativeMaster,
    width,
    height,
    bytes: master.data.length,
    derivatives: widths
  }
}

/**
 * Сохраняет загруженный файл и его webp-деривативы.
 * Повторная загрузка того же содержимого возвращает существующую запись:
 * hash уникален, файлы не дублируются.
 */
async function processUpload ({ buffer, originalName, mime, managedKey = null }) {
  if (!config.allowedImageMimes.includes(mime)) {
    throw new UploadError(`Тип файла «${mime}» не поддерживается. Разрешены: JPEG, PNG, WebP, AVIF.`)
  }
  if (buffer.length > config.uploadMaxBytes) {
    throw new UploadError(`Файл больше ${Math.round(config.uploadMaxBytes / 1024 / 1024)} МБ.`)
  }

  const hash = hashOf(buffer)
  const existing = await findMediaByHash(hash)
  if (existing) return { media: existing, deduplicated: true }

  const written = await writeDerivatives({ buffer, mime, hash })

  const record = {
    ...written,
    // На диске лежит webp-мастер, каким бы ни был присланный формат.
    mime: 'image/webp',
    hash,
    originalName: originalName.slice(0, 255),
    managedKey
  }
  record.id = await insertMedia(record)

  return { media: record, deduplicated: false }
}

/** Удаляет оригинал и все деривативы с диска. Запись в БД удаляется отдельно. */
async function deleteFiles (media) {
  await rm(absolutePath(media.path), { force: true })
  for (const width of media.derivatives ?? []) {
    await rm(absolutePath(derivativeRelPath(media.path, width)), { force: true })
  }
}

/**
 * Данные для <picture>: srcset по деривативам и src для браузеров без webp.
 */
function pictureSources (media) {
  const widths = (media.derivatives ?? []).slice().sort((a, b) => a - b)
  const srcset = widths
    .map((width) => `${mediaUrl(derivativeRelPath(media.path, width))} ${width}w`)
    .join(', ')
  const largest = widths.at(-1)
  const best = largest ? mediaUrl(derivativeRelPath(media.path, largest)) : mediaUrl(media.path)

  return {
    srcset,
    src: best,
    /* Полноэкранный показ берёт самый крупный дериватив, а не
       мастер-копию: разницы на экране не видно, а вес заметно меньше. */
    original: best,
    width: media.width,
    height: media.height
  }
}

/**
 * Превью для админки: самая мелкая ступень, но не меньше заданной.
 * У крошечных картинок полной ширины может не быть ступени 160.
 */
function thumbnailUrl (media) {
  const widths = (media.derivatives ?? []).slice().sort((a, b) => a - b)
  if (widths.length === 0) return mediaUrl(media.path)
  const thumb = widths.find((width) => width >= config.thumbWidth) ?? widths.at(-1)
  return mediaUrl(derivativeRelPath(media.path, thumb))
}

/**
 * Запись устарела, если мастер не webp, шире допустимого или набор
 * ступеней не тот, что сделали бы сейчас. Проверка одна на всех:
 * и для файлов репозитория, и для загруженных через админку.
 */
function needsRepair (media) {
  if (media.mime !== 'image/webp' || !media.path.endsWith('.webp')) return true
  if (media.width > config.masterMaxWidth) return true
  const expected = expectedWidths(media.width)
  const actual = [...(media.derivatives ?? [])].sort((a, b) => a - b)
  return JSON.stringify(expected) !== JSON.stringify(actual)
}

export {
  processUpload, writeDerivatives, deleteFiles, pictureSources, thumbnailUrl,
  mediaUrl, derivativeRelPath, absolutePath, hashOf,
  MIME_BY_EXTENSION, expectedWidths, needsRepair, UploadError
}
