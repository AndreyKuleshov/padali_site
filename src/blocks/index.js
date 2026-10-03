import hero from './hero.js'
import release from './release.js'
import concert from './concert.js'
import links from './links.js'
import gallery from './gallery.js'
import richtext from './richtext.js'

/**
 * Типы полей, которые умеет отрисовать админка.
 * Добавление нового типа ввода = шаблон в views/admin/fields/.
 */
const INPUT_TYPES = new Set([
  'text', 'textarea', 'richtext', 'number', 'checkbox',
  'select', 'date', 'url', 'repeater'
])

const DESCRIPTORS = [hero, release, concert, links, gallery, richtext]

/** Падаем на старте, а не на первом открытии формы в админке. */
function validateDescriptor (descriptor) {
  const where = `Дескриптор блока «${descriptor?.type ?? '?'}»`

  if (!descriptor?.type || !/^[a-z][a-z0-9_]*$/.test(descriptor.type)) {
    throw new Error(`${where}: поле type обязательно, строчные латинские буквы и подчёркивания.`)
  }
  if (!descriptor.title) throw new Error(`${where}: не задан title.`)
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
  return [...registry.values()].map(({ type, title, description }) => ({ type, title, description }))
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
  getBlockType, listBlockTypes, hasBlockType,
  defaultSettings, textKeysFor, validateDescriptor, INPUT_TYPES
}
