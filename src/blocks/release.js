const PLATFORMS = [
  'spotify', 'apple-music', 'youtube-music', 'deezer',
  'youtube', 'tiktok', 'bandcamp', 'soundcloud', 'vk'
]

export default {
  type: 'release',
  title: { en: 'Release', sr: 'Izdanje' },
  description: {
    en: 'Cover, release date, countdown and platform links.',
    sr: 'Omot, datum izlaska, odbrojavanje i linkovi ka platformama.'
  },

  // Пункт меню у нового блока уже заполнен: пустые поля редактор
  // чаще пропускает, и блок молча не попадает в меню.
  defaults: { anchor: 'release', navLabel: { en: 'Music', sr: 'Muzika' } },

  texts: [
    { key: 'eyebrow', label: { en: 'Badge', sr: 'Oznaka' },      input: 'text' },
    { key: 'title',   label: { en: 'Title', sr: 'Naziv' },   input: 'text', general: true },
    { key: 'note',    label: { en: 'Note', sr: 'Napomena' }, input: 'textarea', rows: 2 },
    { key: 'more_label', label: { en: '«More» label', sr: 'Naziv za «još»' }, input: 'text' },
    {
      key: 'platforms_label',
      label: { en: 'Label above the platforms', sr: 'Naslov iznad platformi' },
      input: 'text',
      hint: {
        en: 'Without it a row of grey icons reads as broken buttons. Before release: «Soon on».',
        sr: 'Bez njega red sivih ikona izgleda kao pokvarena dugmad. Pre izlaska: «Uskoro na».'
      }
    },
    {
      key: 'countdown_label',
      label: { en: 'Countdown label', sr: 'Tekst odbrojavanja' },
      input: 'text',
      hint: {
        en: '{days} is replaced with the number of days, e.g. «{days} days until release»',
        sr: '{days} se zamenjuje brojem dana, npr. «{days} dana do izlaska»'
      }
    }
  ],

  media: [
    { key: 'cover',   label: { en: 'Cover', sr: 'Omot' },                required: true, size: { w: 1000, h: 1000 } },
    { key: 'sticker', label: { en: 'Sticker over the cover', sr: 'Nalepnica preko omota' }, size: { w: 320, h: 320 } }
  ],

  settings: [
    { key: 'release_date',   label: { en: 'Release date', sr: 'Datum izlaska' },          input: 'date' },
    { key: 'show_countdown', label: { en: 'Show countdown', sr: 'Prikaži odbrojavanje' }, input: 'checkbox', default: true },
    {
      key: 'platforms',
      label: { en: 'Platforms', sr: 'Platforme' },
      input: 'repeater',
      addLabel: { en: 'Add platform', sr: 'Dodaj platformu' },
      fields: [
        { key: 'icon',  label: { en: 'Icon', sr: 'Ikona' },  input: 'select', options: PLATFORMS },
        // Названия платформ — торговые марки, не переводятся.
        { key: 'label', label: { en: 'Label', sr: 'Naziv' }, input: 'text' },
        { key: 'url',   label: { en: 'Link', sr: 'Link' },  input: 'url' }
      ],
      default: []
    }
  ],

  template: 'blocks/release'
}
