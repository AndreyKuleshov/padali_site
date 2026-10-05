import test from 'node:test'
import assert from 'node:assert/strict'
import { parseBlockForm, asUrl, asDate } from '../src/services/block-form.js'
import gallery from '../src/blocks/gallery.js'
import links from '../src/blocks/links.js'
import concert from '../src/blocks/concert.js'

test('ссылка с небезопасной схемой отбрасывается', () => {
  assert.equal(asUrl('https://example.com'), 'https://example.com')
  assert.equal(asUrl('javascript:alert(1)'), '')
  assert.equal(asUrl('не ссылка'), '')
})

test('дата принимается только в формате ГГГГ-ММ-ДД', () => {
  assert.equal(asDate('2026-10-22'), '2026-10-22')
  assert.equal(asDate('22.10.2026'), '')
})

test('настройки галереи приводятся к нужным типам', () => {
  const parsed = parseBlockForm(gallery, {
    is_visible: 'on',
    text: { en: { heading: 'Photos' }, sr: { heading: '' } },
    settings: { gallery_id: '7', layout: 'strip', columns: '4', lightbox: 'on', limit: '2' }
  }, ['en', 'sr'])

  assert.equal(parsed.settings.gallery_id, 7)
  assert.equal(parsed.settings.layout, 'strip')
  assert.equal(parsed.settings.columns, 4)
  assert.equal(parsed.settings.lightbox, true)
  assert.equal(parsed.settings.show_captions, false, 'снятая галочка должна стать false')
  assert.equal(parsed.settings.limit, 2)
  assert.equal(parsed.anchor, undefined, 'якорь не приходит из формы — его назначает сервер')
  assert.equal(parsed.isVisible, true)
  assert.deepEqual(parsed.textsByLocale.en, { heading: 'Photos' })
  assert.deepEqual(parsed.textsByLocale.sr, {}, 'пустой перевод не сохраняется')
})

test('неизвестное значение select заменяется значением по умолчанию', () => {
  const parsed = parseBlockForm(gallery, {
    settings: { gallery_id: '1', layout: '<script>', columns: '99' }
  }, ['en'])

  assert.equal(parsed.settings.layout, 'grid')
  assert.equal(parsed.settings.columns, 5, 'число зажимается верхней границей')
})

test('пустые строки повторителя выбрасываются, остальные переиндексируются', () => {
  const parsed = parseBlockForm(links, {
    settings: {
      items: {
        0: { icon: 'instagram', label: 'Instagram', handle: '@a', url: 'https://instagram.com/a' },
        1: { icon: '', label: '', handle: '', url: '' },
        2: { icon: 'youtube', label: 'YouTube', handle: '@b', url: 'https://youtube.com/@b' }
      }
    }
  }, ['en'])

  assert.equal(parsed.settings.items.length, 2)
  assert.equal(parsed.settings.items[0].label, 'Instagram')
  assert.equal(parsed.settings.items[1].label, 'YouTube')
})

/* Строку судят по смысловому подполю. Раньше смотрели на все
   сразу: заполнив одну подпись, редактор получал выжившую строку
   без адреса, и на сайте появлялась иконка с href="" — нажатие
   перезагружало страницу саму в себя. */
test('строка без ссылки выбрасывается, даже если подпись заполнена', () => {
  const parsed = parseBlockForm(links, {
    settings: {
      items: {
        0: { icon: 'instagram', label: 'Instagram', handle: '@a', url: 'https://instagram.com/a' },
        1: { icon: 'youtube', label: 'Наш канал', handle: '@b', url: '' }
      }
    }
  }, ['en'])

  assert.equal(parsed.settings.items.length, 1)
  assert.equal(parsed.settings.items[0].label, 'Instagram')
})

/* Цена приходит двумя полями, а хранится одной строкой. Без
   валюты цены нет: сохранить «1000» непонятно в чём хуже, чем не
   сохранить ничего — на сайте появилось бы голое число. */
test('цена собирается из суммы и валюты, без валюты — пусто', () => {
  // Описание на месте: так проверяется сам тип поля, а не то,
  // какой блок сегодня держит цену.
  const withPrice = {
    type: 'test', title: { en: 'T' }, template: 'blocks/test',
    settings: [{ key: 'price', label: { en: 'Price' }, input: 'price' }]
  }
  const price = (body) => parseBlockForm(withPrice, { settings: body }, ['en']).settings.price

  assert.equal(price({ price: '1000', price_currency: 'RSD' }), '1000 RSD')
  assert.equal(price({ price: '1000' }), '', 'без валюты цены нет')
  assert.equal(price({ price_currency: 'EUR' }), '', 'без суммы тоже')
  assert.equal(price({ price: '1000', price_currency: 'XXX' }), '', 'валюта не из списка')
})

/* В строке концерта цена собирается тем же правилом: подполе
   повторителя проходит через ту же сборку, что и настройка. */
test('цена строки повторителя собирается так же', () => {
  const parsed = parseBlockForm(concert, {
    settings: {
      events: {
        0: { date: '2026-10-16', price: '1000', price_currency: 'RSD', tickets: 'link' },
        1: { date: '2026-11-20', price: '500', tickets: 'door' }
      }
    }
  }, ['en'])

  assert.equal(parsed.settings.events[0].price, '1000 RSD')
  assert.equal(parsed.settings.events[1].price, '', 'без валюты цены нет и здесь')
})

/* Имя поля валюты не приписывается к имени суммы: «price[m7]_currency»
   qs разбирает как второе значение того же ключа и схлопывает оба
   в массив. */
test('сумма и валюта в форме не схлопываются в один ключ', async () => {
  const qs = (await import('qs')).default
  const parsed = qs.parse('price[m7]=1000&price_currency[m7]=RSD')

  assert.equal(parsed.price.m7, '1000')
  assert.equal(parsed.price_currency.m7, 'RSD')
})

test('чужие текстовые ключи в форму не проходят', () => {
  const parsed = parseBlockForm(gallery, {
    text: { en: { heading: 'ok', password_hash: 'взлом' } },
    settings: { gallery_id: '1' }
  }, ['en'])

  assert.deepEqual(Object.keys(parsed.textsByLocale.en), ['heading'])
})
