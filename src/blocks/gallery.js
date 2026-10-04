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
  title: { en: 'Photo gallery', sr: 'Foto-galerija' },
  description: {
    en: 'An album from the media library, placed anywhere on the page.',
    sr: 'Album iz galerije fajlova, postavljen bilo gde na strani.'
  },

  defaults: { anchor: 'photos', navLabel: { en: 'Photos', sr: 'Fotografije' } },

  texts: [
    { key: 'heading', label: { en: 'Heading', sr: 'Naslov' }, input: 'text', general: true },
    { key: 'intro',   label: { en: 'Intro', sr: 'Uvod' },  input: 'textarea', rows: 2 }
  ],

  media: [],

  settings: [
    { key: 'gallery_id', label: { en: 'Album', sr: 'Album' }, input: 'gallery-picker', required: true },
    {
      key: 'layout',
      label: { en: 'Layout', sr: 'Raspored' },
      input: 'select',
      options: ['grid', 'strip', 'masonry'],
      optionLabels: {
        grid: { en: 'Grid', sr: 'Mreža' },
        strip: { en: 'Strip (horizontal scroll)', sr: 'Traka (horizontalno)' },
        masonry: { en: 'Masonry', sr: 'Zidani raspored' }
      },
      default: 'grid'
    },
    { key: 'columns',  label: { en: 'Columns (grid and masonry)', sr: 'Kolona (mreža i zidani raspored)' }, input: 'number', default: 3, min: 1, max: 5 },
    {
      key: 'columns_mobile',
      label: { en: 'Columns on a phone', sr: 'Kolona na telefonu' },
      input: 'number',
      default: 2,
      min: 1,
      max: 3,
      hint: {
        en: 'On a narrow screen the album is one continuous grid: screens and arrows are for the desktop, where a row fits whole.',
        sr: 'Na uskom ekranu album je jedna neprekidna mreža: ekrani i strelice su za računar, gde red staje ceo.'
      }
    },
    {
      key: 'rows',
      label: { en: 'Rows per screen (grid only)', sr: 'Redova po ekranu (samo mreža)' },
      input: 'number',
      default: 0,
      min: 0,
      max: 6,
      hint: {
        en: '0 — show everything in one grid. Otherwise the album is split into screens of columns × rows, with arrows and swipe to move between them.',
        sr: '0 — sve u jednoj mreži. Inače se album deli na ekrane veličine kolone × redovi, sa strelicama i prevlačenjem za kretanje.'
      }
    },
    { key: 'lightbox', label: { en: 'Open full screen on click', sr: 'Otvori preko celog ekrana na klik' }, input: 'checkbox', default: true },
    { key: 'limit',    label: { en: 'Show first N photos (0 — all)', sr: 'Prikaži prvih N fotografija (0 — sve)' }, input: 'number', default: 0, min: 0 },
    { key: 'show_captions', label: { en: 'Show captions', sr: 'Prikaži potpise' }, input: 'checkbox', default: false }
  ],

  template: 'blocks/gallery'
}
