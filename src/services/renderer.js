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

/** Экранирование для своей разметки: linkify печатается через <%~. */
function escapeHtml (value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/* Схемы только http и https — те же, что пропускает asUrl, минус
   mailto и tel: в подписи их не пишут. Кавычки и угловые скобки в
   адрес не берём, иначе чужой текст залезет в атрибут. */
const LINK_IN_TEXT = /https?:\/\/[^\s<>"']+/g

/* Точка, запятая или скобка в конце — это почти всегда конец
   предложения, а не часть адреса. Ссылка внутри скобок от этого
   теряет закрывающую — такую цену платим сознательно: точка в
   хвосте встречается несравнимо чаще. */
const SENTENCE_TAIL = /[.,;:!?)\]]+$/

/**
 * Ссылка в обычном тексте становится ссылкой.
 *
 * Подпись под роликом — простая textarea, редактор вставляет туда
 * адрес как есть, и на сайте он лежал мёртвым текстом. Разметку
 * собираем здесь, а не в шаблоне: раз результат печатается через
 * <%~, экранировать всё до единого куска должен тот, кто эту
 * разметку и делает.
 */
function linkify (text) {
  const source = String(text ?? '')
  let out = ''
  let at = 0

  for (const match of source.matchAll(LINK_IN_TEXT)) {
    const tail = SENTENCE_TAIL.exec(match[0])
    const url = tail ? match[0].slice(0, -tail[0].length) : match[0]
    if (url === '') continue

    out += escapeHtml(source.slice(at, match.index))
    out += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>`
    at = match.index + url.length
  }

  return out + escapeHtml(source.slice(at))
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
  linkify,
  formatDate,
  formatDateTime,
  localeUrl,
  publicUrl: config.publicUrl,
  /* Открытый ключ капчи: он и так виден в разметке. Пусто — капчи
     на странице не будет вовсе. */
  turnstileSiteKey: config.turnstile.siteKey,
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
  render, helpers, sanitize, linkify, formatDate, formatDateTime, localeUrl, eta, LAYOUT, VIEWS_DIR
}
