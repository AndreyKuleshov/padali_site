import hero from './hero.js'
import release from './release.js'
import concert from './concert.js'
import links from './links.js'
import gallery from './gallery.js'
import richtext from './richtext.js'
import youtube from './youtube.js'
import footer from './footer.js'

/**
 * Типы полей, которые умеет отрисовать админка.
 * Добавление нового типа ввода = шаблон в views/admin/fields/.
 */
const INPUT_TYPES = new Set([
  'text', 'textarea', 'richtext', 'number', 'checkbox',
  'select', 'date', 'url', 'repeater', 'youtube'
])

const DESCRIPTORS = [hero, release, concert, links, gallery, youtube, richtext, footer]

/** Падаем на старте, а не на первом открытии формы в админке. */
function validateDescriptor (descriptor) {
  const where = `Дескриптор блока «${descriptor?.type ?? '?'}»`

  if (!descriptor?.type || !/^[a-z][a-z0-9_]*$/.test(descriptor.type)) {
    throw new Error(`${where}: поле type обязательно, строчные латинские буквы и подчёркивания.`)
  }
  if (!descriptor.title) throw new Error(`${where}: не задан title.`)
  if (descriptor.pinned && !['top', 'bottom'].includes(descriptor.pinned)) {
    throw new Error(`${where}: pinned принимает только 'top' или 'bottom'.`)
  }
  if (!descriptor.template) throw new Error(`${where}: не задан template.`)

  for (const field of descriptor.texts ?? []) {
    if (!field.key) throw new Error(`${where}: текстовое поле без key.`)
    if (field.key.includes('.')) {
      throw new Error(`${where}: точка в ключе «${field.key}» зарезервирована за элементами повторителя.`)
    }
    if (!INPUT_TYPES.has(field.input)) {
      throw new Error(`${where}: неизвестный тип ввода «${field.input}» у поля «${field.key}».`)
    }
  }

  for (const field of descriptor.settings ?? []) {
    if (!field.key) throw new Error(`${where}: настройка без key.`)
    if (!INPUT_TYPES.has(field.input) && !field.input.endsWith('-picker')) {
      throw new Error(`${where}: неизвестный тип ввода «${field.input}» у настройки «${field.key}».`)
    }
    if (field.input === 'repeater' && !Array.isArray(field.fields)) {
      throw new Error(`${where}: повторитель «${field.key}» без описания fields.`)
    }
  }

  for (const field of descriptor.media ?? []) {
    if (!field.key) throw new Error(`${where}: медиа-поле без key.`)
  }

  return descriptor
}

const registry = new Map()
for (const descriptor of DESCRIPTORS) {
  validateDescriptor(descriptor)
  if (registry.has(descriptor.type)) {
    throw new Error(`Тип блока «${descriptor.type}» объявлен дважды.`)
  }
  registry.set(descriptor.type, descriptor)
}

function getBlockType (type) {
  return registry.get(type) ?? null
}

/** Список для выпадайки «Добавить блок». */
function listBlockTypes () {
  return [...registry.values()].map(({ type, title, description, pinned }) => (
    { type, title, description, pinned: pinned ?? null }
  ))
}

/** Шапка всегда сверху, подвал всегда снизу — порядок за них не решают. */
function pinOf (type) {
  return getBlockType(type)?.pinned ?? null
}

function pinRank (type) {
  const pin = pinOf(type)
  return pin === 'top' ? 0 : pin === 'bottom' ? 2 : 1
}

/**
 * Порядок показа: закреплённые по краям, остальные — как расставил
 * редактор. Сортировка живёт здесь, а не в SQL, потому что
 * закрепление объявлено в дескрипторе, а не в базе.
 */
function sortBlocks (blocks) {
  return [...blocks].sort((left, right) => (
    pinRank(left.type) - pinRank(right.type) ||
    left.position - right.position ||
    left.id - right.id
  ))
}

function hasBlockType (type) {
  return registry.has(type)
}

/** Значения по умолчанию для только что созданного блока. */
function defaultSettings (type) {
  const descriptor = getBlockType(type)
  if (!descriptor) return {}

  const settings = {}
  for (const field of descriptor.settings ?? []) {
    if (field.input === 'repeater') {
      settings[field.key] = field.default ?? []
    } else if (field.default !== undefined) {
      settings[field.key] = field.default
    } else if (field.input === 'checkbox') {
      settings[field.key] = false
    }
  }
  return settings
}

/** Плоский список текстовых ключей блока, включая поля внутри повторителей. */
function textKeysFor (descriptor, settings = {}) {
  const keys = (descriptor.texts ?? []).map((field) => field.key)

  for (const field of descriptor.settings ?? []) {
    if (field.input !== 'repeater') continue
    const rows = Array.isArray(settings[field.key]) ? settings[field.key] : []
    const translatable = field.fields.filter((sub) => sub.translatable)
    rows.forEach((_row, index) => {
      for (const sub of translatable) keys.push(`${field.key}.${index}.${sub.key}`)
    })
  }

  return keys
}

export {
  getBlockType, listBlockTypes, hasBlockType, pinOf, pinRank, sortBlocks,
  defaultSettings, textKeysFor, validateDescriptor, INPUT_TYPES
}
