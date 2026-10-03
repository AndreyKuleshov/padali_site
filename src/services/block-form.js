/**
 * Разбор формы блока в значения для базы.
 *
 * Форма присылает:
 *   text[<язык>][<поле>]                       — переводимые строки
 *   settings[<ключ>]                           — простые настройки
 *   settings[<повторитель>][<i>][<подполе>]    — строки повторителя
 *   media[<поле>][]                            — id картинок
 *
 * Непереводимые значения повторителя попадают в settings,
 * переводимые — в block_texts под ключом `<повторитель>.<i>.<подполе>`.
 */
import { parseVideoId, watchUrl } from './youtube.js'

function asString (value) {
  if (Array.isArray(value)) value = value[0]
  return typeof value === 'string' ? value.trim() : ''
}

function asBoolean (value) {
  if (Array.isArray(value)) value = value.at(-1)
  return value === 'on' || value === 'true' || value === '1' || value === true
}

function asNumber (value, { min, max, fallback = 0 } = {}) {
  const parsed = Number.parseFloat(asString(value))
  if (!Number.isFinite(parsed)) return fallback
  let result = parsed
  if (typeof min === 'number') result = Math.max(result, min)
  if (typeof max === 'number') result = Math.min(result, max)
  return result
}

/** Пустая строка допустима — значит «дата не задана». */
function asDate (value) {
  const text = asString(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

/** Пропускаем только http(s) и mailto: javascript: в ссылку не попадёт. */
function asUrl (value) {
  const text = asString(value)
  if (text === '') return ''
  try {
    const url = new URL(text)
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? text : ''
  } catch {
    return ''
  }
}

function coerceScalar (field, raw) {
  switch (field.input) {
    case 'checkbox': return asBoolean(raw)
    case 'number': return asNumber(raw, { min: field.min, max: field.max, fallback: field.default ?? 0 })
    case 'date': return asDate(raw)
    case 'url': return asUrl(raw)
    case 'select': {
      const value = asString(raw)
      return field.options?.includes(value) ? value : (field.default ?? field.options?.[0] ?? '')
    }
    case 'gallery-picker': {
      const id = Number.parseInt(asString(raw), 10)
      return Number.isInteger(id) && id > 0 ? id : null
    }
    /* Ссылку приводим к одному виду: её приносят из плеера, из
       «поделиться» и из Shorts, а шаблону нужен один разбор.
       Нераспознанное становится пустотой — тогда обязательное
       поле честно скажет, что не заполнено, вместо того чтобы
       сохранить мусор и показать пустой блок. */
    case 'youtube': {
      const id = parseVideoId(asString(raw))
      return id ? watchUrl(id) : ''
    }
    default: return asString(raw)
  }
}

/**
 * Пустоту строки повторителя определяем по тому, что прислала форма,
 * а не по приведённым значениям: `select` без выбора подставляет первую
 * опцию, и строка, которую пользователь оставил пустой, выглядела бы
 * заполненной.
 */
function isEmptySubmission (rawRow, fields) {
  return fields.every((sub) => asString(rawRow?.[sub.key]) === '')
}

/**
 * @returns {{settings: object, textsByLocale: object, mediaByField: object,
 *            isVisible: boolean}}
 */
function parseBlockForm (descriptor, body = {}, locales = []) {
  const settings = {}
  /** Переносы ключей текстов после выкидывания пустых строк повторителя. */
  const textKeyRemap = new Map()

  for (const field of descriptor.settings ?? []) {
    if (field.input !== 'repeater') {
      settings[field.key] = coerceScalar(field, body.settings?.[field.key])
      continue
    }

    const raw = body.settings?.[field.key]
    // qs отдаёт объект с числовыми ключами, когда индексы разрежены.
    const rawRows = Array.isArray(raw)
      ? raw.map((row, index) => [index, row])
      : Object.entries(raw ?? {}).map(([index, row]) => [Number(index), row])

    const rows = []
    for (const [originalIndex, rawRow] of rawRows.sort((a, b) => a[0] - b[0])) {
      const translatedValues = field.fields
        .filter((sub) => sub.translatable)
        .flatMap((sub) => locales.map(
          (locale) => asString(body.text?.[locale]?.[`${field.key}.${originalIndex}.${sub.key}`])
        ))

      const untranslatable = field.fields.filter((sub) => !sub.translatable)
      if (isEmptySubmission(rawRow, untranslatable) && translatedValues.every((value) => value === '')) continue

      const row = {}
      for (const sub of untranslatable) {
        row[sub.key] = coerceScalar(sub, rawRow?.[sub.key])
      }

      const newIndex = rows.length
      if (newIndex !== originalIndex) {
        for (const sub of field.fields.filter((item) => item.translatable)) {
          textKeyRemap.set(`${field.key}.${originalIndex}.${sub.key}`, `${field.key}.${newIndex}.${sub.key}`)
        }
      }
      rows.push(row)
    }

    settings[field.key] = rows
  }

  // Ключи текстов, которые вообще имеет смысл сохранять.
  const allowedKeys = new Set(['nav_label', ...(descriptor.texts ?? []).map((field) => field.key)])
  for (const field of descriptor.settings ?? []) {
    if (field.input !== 'repeater') continue
    const rows = settings[field.key] ?? []
    for (const sub of field.fields.filter((item) => item.translatable)) {
      rows.forEach((_row, index) => allowedKeys.add(`${field.key}.${index}.${sub.key}`))
    }
  }

  const textsByLocale = {}
  for (const locale of locales) {
    const incoming = body.text?.[locale] ?? {}
    const fields = {}
    for (const [key, value] of Object.entries(incoming)) {
      const finalKey = textKeyRemap.get(key) ?? key
      if (!allowedKeys.has(finalKey)) continue
      const text = asString(value)
      if (text !== '') fields[finalKey] = text
    }
    textsByLocale[locale] = fields
  }

  const mediaByField = {}
  for (const field of descriptor.media ?? []) {
    const raw = body.media?.[field.key]
    const list = Array.isArray(raw) ? raw : (raw == null ? [] : [raw])
    const ids = list
      .map((value) => Number.parseInt(asString(value), 10))
      .filter((id) => Number.isInteger(id) && id > 0)
    mediaByField[field.key] = field.multiple ? ids : ids.slice(0, 1)
  }

  /* Якоря среди полей формы нет: он служебный, его назначает
     сервер при создании блока и дальше не меняет. Ссылки вида
     «/#photos» живут в меню и в переписке, и переименование
     ломало бы их без всякой пользы для редактора. */
  return {
    settings,
    textsByLocale,
    mediaByField,
    isVisible: asBoolean(body.is_visible)
  }
}

export { parseBlockForm, isEmptySubmission, asString, asBoolean, asNumber, asDate, asUrl, coerceScalar }
