import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Eta } from 'eta'
import sanitizeHtml from 'sanitize-html'
import config from '../config.js'
import { icon, ICON_NAMES } from './icons.js'
import { assetUrl, BUILT_IN_LOGO } from './assets.js'
import { CURRENCIES, PINNED, splitPrice } from './money.js'
import { parseVideoId, thumbnailFor, embedUrl, watchUrl } from './youtube.js'

const VIEWS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'views')

const eta = new Eta({
  views: VIEWS_DIR,
  cache: config.isProduction,
  autoEscape: true,
  rmWhitespace: false
})

/** Белый список для richtext: редактор свой, но дыру делать всё равно незачем. */
const SANITIZE_OPTIONS = {
  allowedTags: ['p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'a',
    'ul', 'ol', 'li', 'blockquote', 'h3', 'h4', 'hr', 'code'],
  allowedAttributes: { a: ['href', 'title', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener', target: '_blank' })
  }
}

function sanitize (html) {
  return sanitizeHtml(html ?? '', SANITIZE_OPTIONS)
}

/** Дата хранится как YYYY-MM-DD, показывается как ДД.ММ.ГГГГ. */
function formatDate (value) {
  if (!value) return ''
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value))
  return match ? `${match[3]}.${match[2]}.${match[1]}` : String(value)
}

/**
 * Дата со временем — для списков в админке.
 *
 * Язык берём от интерфейса, но порядок частей задаём сами:
 * «en» — это американское 10/4/2026, где 4 — день, и рядом с
 * сайтом, где везде 16.10.2026, это читается неверно.
 */
function formatDateTime (value, locale) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString(locale === 'sr' ? 'sr-Latn-RS' : 'en-GB')
}

/** Язык по умолчанию живёт в корне, остальные — в своём префиксе. */
function localeUrl (code, defaultLocale, path = '') {
  const prefix = code === defaultLocale ? '' : `/${code}`
  return `${prefix}/${path}`.replace(/\/+$/, '') || '/'
}

/**
 * Числа раскладки, которые нужны и шаблону, и стилям.
 *
 * Шаблон галереи считает по ним атрибут sizes: браузер выбирает
 * версию снимка до того, как применит CSS, и ошибиться здесь
 * значит выдать версию 1280px в колонку шириной 240.
 *
 * Стили остаются источником истины — здесь их копия, и
 * tests/layout.test.js следит, чтобы копия не разошлась
 * с public/css/site.css.
 */
const LAYOUT = {
  wrap: 760,
  gutter: 24,
  gutterNarrow: 20,
  galleryGap: 10,
  narrow: 640,
  stripVw: 72,
  stripMax: 320
}

const helpers = {
  icon,
  layout: LAYOUT,
  /* Цена хранится строкой, а правится двумя полями. */
  splitPrice,
  currencies: CURRENCIES,
  currenciesPinned: PINNED,
  /** Встроенный логотип — когда своего нет ни у блока, ни в настройках. */
  builtInLogo: BUILT_IN_LOGO,
  asset: assetUrl,
  // Разбор ссылки один на админку и на сайт: иначе шаблон знал бы
  // про форматы адресов YouTube отдельно от того, кто их проверяет.
  youtube: { id: parseVideoId, thumbnail: thumbnailFor, embed: embedUrl, watch: watchUrl },
  iconNames: ICON_NAMES,
  sanitize,
  formatDate,
  formatDateTime,
  localeUrl,
  publicUrl: config.publicUrl,
  /* Год для копирайта. Страницы лежат в кэше до первой правки в
     админке, поэтому после Нового года значение здесь может
     устареть — скрипт на странице его поправит. */
  year: () => new Date().getFullYear(),
  /** Безопасный JSON для вставки в <script type="application/json">. */
  jsonScript: (value) => JSON.stringify(value ?? null).replace(/</g, '\\u003c')
}

function render (template, data = {}) {
  const html = eta.render(template, { ...data, h: helpers })
  if (html === undefined) throw new Error(`Шаблон «${template}» не найден.`)
  return html
}

export {
  render, helpers, sanitize, formatDate, formatDateTime, localeUrl, eta, LAYOUT, VIEWS_DIR
}
