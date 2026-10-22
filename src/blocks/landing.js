/*
 * Лендинг релиза: отдельная страница, которую питчат.
 *
 * Отличается от блока релиза задачей, а не содержимым. Там —
 * «у нас выходит, следите»; здесь — «вот запись, слушайте где
 * вам удобно», и ничего, кроме этого, на странице быть не должно.
 * Поэтому меню сайта лендинг не показывает: уводить внимание в
 * мерч и фото со страницы, которая продаёт один трек, незачем.
 */
const PLATFORMS = [
  'spotify', 'apple-music', 'youtube-music', 'amazon-music', 'deezer', 'tidal',
  'youtube', 'tiktok', 'bandcamp', 'soundcloud', 'vk'
]

export default {
  type: 'landing',
  title: { en: 'Release landing', sr: 'Lending izdanja' },
  description: {
    en: 'A page for one release: cover, player and every platform at once.',
    sr: 'Stranica za jedno izdanje: omot, plejer i sve platforme odjednom.'
  },

  defaults: { anchor: 'listen', navLabel: { en: 'Listen', sr: 'Slušaj' } },

  /* Страница с этим блоком показывается без шапки, меню и подвала
     сайта. Знает об этом дескриптор, а не вёрстка: только он знает,
     что лендинг решает одну задачу и соседей себе не просит. */
  standalone: true,
  

  texts: [
    { key: 'title', label: { en: 'Track or album name', sr: 'Naziv pesme ili albuma' }, input: 'text', general: true },
    { key: 'by', label: { en: 'By', sr: 'Izvođač' }, input: 'text' },
    {
      key: 'platforms_label',
      label: { en: 'Label above the platforms', sr: 'Naslov iznad platformi' },
      input: 'text',
      hint: {
        en: 'For example «Get the music».',
        sr: 'Na primer «Preuzmi muziku».'
      }
    },
    { key: 'buy_label', label: { en: '«Buy» button label', sr: 'Tekst dugmeta «kupi»' }, input: 'text' },
    {
      key: 'note',
      label: { en: 'Note under the buttons', sr: 'Napomena ispod dugmadi' },
      input: 'textarea',
      rows: 3,
      hint: {
        en: 'A few lines about the release: a bit of the lyrics, a word to the listeners. Links in it become links.',
        sr: 'Par redova o izdanju: deo teksta, reč slušaocima. Linkovi u njemu postaju linkovi.'
      }
    },
    { key: 'released_label', label: { en: 'Release line', sr: 'Red o izlasku' }, input: 'text' }
  ],

  media: [
    { key: 'cover', label: { en: 'Cover', sr: 'Omot' }, required: true, size: { w: 1000, h: 1000 } }
  ],

  settings: [
    {
      key: 'spotify_url',
      label: { en: 'Spotify link', sr: 'Spotify link' },
      input: 'url',
      hint: {
        en: 'A link from «Share» — track, album or playlist. Empty: the page shows the cover without a player.',
        sr: 'Link iz «Podeli» — pesma, album ili plejlista. Prazno: stranica prikazuje omot bez plejera.'
      }
    },
    {
      key: 'show_buy',
      label: { en: 'Show the «buy» button', sr: 'Prikaži dugme «kupi»' },
      input: 'checkbox',
      default: false,
      hint: {
        en: 'Off while there is nowhere to buy yet. The link below keeps its value and comes back with the toggle.',
        sr: 'Isključeno dok nema gde da se kupi. Link ispod ostaje zapisan i vraća se sa prekidačem.'
      }
    },
    {
      key: 'buy_url',
      label: { en: '«Buy» link', sr: 'Link za «kupi»' },
      input: 'url',
      showIf: { field: 'show_buy', value: true }
    },
    {
      key: 'platforms',
      label: { en: 'Platforms', sr: 'Platforme' },
      input: 'repeater',
      addLabel: { en: 'Add platform', sr: 'Dodaj platformu' },
      fields: [
        { key: 'icon', label: { en: 'Icon', sr: 'Ikona' }, input: 'select', options: PLATFORMS },
        // Названия платформ — торговые марки, не переводятся.
        { key: 'label', label: { en: 'Label', sr: 'Naziv' }, input: 'text' },
        { key: 'url', label: { en: 'Link', sr: 'Link' }, input: 'url' }
      ],
      default: []
    }
  ],

  template: 'blocks/landing'
}
