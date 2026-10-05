/**
 * Цена: сумма и валюта.
 *
 * В базе это одна строка — «1000 RSD», — и так она и попадает на
 * сайт. Делить её на две колонки значило бы менять схему в двух
 * таблицах ради того, что нужно только форме; поэтому делим и
 * собираем здесь, на границе.
 */

/**
 * Валюты в порядке списка. Первые две — местные, их выбирают почти
 * всегда; остальные ниже по алфавиту кода.
 */
const CURRENCIES = [
  'RSD', 'EUR',
  'BAM', 'CHF', 'CZK', 'GBP', 'HUF', 'MKD', 'PLN', 'RUB', 'TRY', 'UAH', 'USD'
]

/** Сколько валют в начале списка отделены от прочих чертой. */
const PINNED = 2

/** Сумма и валюта в одну строку. Без валюты цены нет. */
function joinPrice (amount, currency) {
  const sum = String(amount ?? '').trim()
  const code = String(currency ?? '').trim().toUpperCase()
  if (sum === '' || !CURRENCIES.includes(code)) return ''
  return `${sum} ${code}`
}

/**
 * Обратно: «1000 RSD» → { amount: '1000', currency: 'RSD' }.
 *
 * Старые записи делали руками и писали как придётся — «1000RSD»,
 * «€7». Что не кончается известным кодом, целиком считаем суммой:
 * редактор увидит свой текст и выберет валюту сам, а не получит
 * молча отрезанный хвост.
 */
function splitPrice (value) {
  const raw = String(value ?? '').trim()
  if (raw === '') return { amount: '', currency: '' }

  const code = CURRENCIES.find((item) => raw.toUpperCase().endsWith(item))
  if (!code) return { amount: raw, currency: '' }

  const amount = raw.slice(0, raw.length - code.length).trim()
  return amount === '' ? { amount: raw, currency: '' } : { amount, currency: code }
}

export { CURRENCIES, PINNED, joinPrice, splitPrice }
