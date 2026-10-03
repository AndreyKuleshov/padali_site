/**
 * Универсальный модуль-галерея.
 *
 * Блок не хранит фотографии — он ссылается на альбом (`galleries`).
 * Поэтому:
 *   • на странице может стоять сколько угодно галерей с разными альбомами;
 *   • один альбом можно вставить в нескольких местах с разной раскладкой
 *     (например, лента из четырёх снимков вверху через `limit` и полная
 *     сетка ниже) — порядок и подписи правятся один раз в альбоме.
 */
export default {
  type: 'gallery',
  title: 'Фотогалерея',
  description: 'Альбом из медиатеки, вставленный в любое место страницы.',

  texts: [
    { key: 'heading', label: 'Заголовок', input: 'text' },
    { key: 'intro',   label: 'Подводка',  input: 'textarea', rows: 2 }
  ],

  media: [],

  settings: [
    { key: 'gallery_id', label: 'Альбом', input: 'gallery-picker', required: true },
    {
      key: 'layout',
      label: 'Раскладка',
      input: 'select',
      options: ['grid', 'strip', 'masonry'],
      optionLabels: { grid: 'Сетка', strip: 'Лента (горизонтальная прокрутка)', masonry: 'Кладка' },
      default: 'grid'
    },
    { key: 'columns',  label: 'Колонок (для сетки и кладки)', input: 'number', default: 3, min: 2, max: 5 },
    { key: 'lightbox', label: 'Открывать по клику на весь экран', input: 'checkbox', default: true },
    { key: 'limit',    label: 'Показать первые N фото (0 — все)', input: 'number', default: 0, min: 0 },
    { key: 'show_captions', label: 'Показывать подписи', input: 'checkbox', default: false }
  ],

  template: 'blocks/gallery'
}
