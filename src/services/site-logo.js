/**
 * Логотип, который стоит на сайте прямо сейчас.
 *
 * Шапка, hero и подвал рисуют одну и ту же картинку по цепочке
 * «свой логотип блока → логотип из настроек → встроенный файл».
 * Админке нужен тот же ответ, иначе поле выглядит пустым, хотя на
 * сайте логотип виден, и редактор думает, что загрузка сломана.
 */
import { getAllSettings } from '../repositories/settings.js'
import { getMedia } from '../repositories/media.js'
import { thumbnailUrl } from './media-processor.js'
import { assetUrl, BUILT_IN_LOGO } from './assets.js'

/** @returns {Promise<{thumb: string, builtIn: boolean, name: string|null}>} */
export async function currentSiteLogo () {
  const settings = await getAllSettings()
  return logoFromSettings(settings)
}

/** То же самое, когда настройки уже прочитаны вызывающим кодом. */
export async function logoFromSettings (settings) {
  const id = Number(settings?.logo_id)
  if (!Number.isInteger(id) || id <= 0) return builtIn()

  const media = await getMedia(id)
  // Файл могли удалить из медиатеки — сайт в этом случае тоже
  // откатывается на встроенный логотип.
  if (!media) return builtIn()

  return { thumb: thumbnailUrl(media), builtIn: false, name: media.originalName }
}

/** Встроенный логотип сам по себе — нужен для отката в интерфейсе. */
export function builtInLogo () {
  return builtIn()
}

function builtIn () {
  // Через assetUrl: встроенный файл отдаётся с длинным кэшем,
  // и без отпечатка админка показывала бы прежнюю картинку.
  return { thumb: assetUrl(BUILT_IN_LOGO), builtIn: true, name: null }
}
