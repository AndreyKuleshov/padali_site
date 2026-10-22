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
    {
      key: 'more_label',
      label: { en: '«More» label', sr: 'Naziv za «još»' },
      input: 'text',
      hint: {
        en: 'The last button of the row. Without a link below it is just a caption.',
        sr: 'Poslednje dugme u redu. Bez linka ispod to je samo natpis.'
      }
    },
    {
      key: 'platforms_label',
      label: { en: 'Label above the platforms, before release', sr: 'Naslov iznad platformi, pre izlaska' },
      input: 'text',
      hint: {
        en: 'Without it a row of grey icons reads as broken buttons. For example «Soon on».',
        sr: 'Bez njega red sivih ikona izgleda kao pokvarena dugmad. Na primer «Uskoro na».'
      }
    },
    {
      key: 'listen_label',
      label: { en: 'Label above the platforms, after release', sr: 'Naslov iznad platformi, posle izlaska' },
      input: 'text',
      hint: {
        en: 'Replaces the one above on the release date — the block switches by itself. Empty: «Listen now».',
        sr: 'Zamenjuje gornji na dan izlaska — blok se prebacuje sam. Prazno: «Slušaj odmah».'
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
    {
      key: 'more_url',
      label: { en: '«More» link', sr: 'Link za «još»' },
      input: 'url',
      hint: {
        en: 'The page with every platform at once. Empty: the button stays a caption and leads nowhere.',
        sr: 'Stranica sa svim platformama odjednom. Prazno: dugme ostaje natpis i ne vodi nikuda.'
      }
    },
    {
      key: 'show_countdown',
      label: { en: 'Show countdown', sr: 'Prikaži odbrojavanje' },
      input: 'checkbox',
      default: true,
      hint: {
        en: 'Until the release date only. After it the block shows the platforms as links, on its own.',
        sr: 'Samo do datuma izlaska. Posle njega blok sam prikazuje platforme kao linkove.'
      }
    },
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
