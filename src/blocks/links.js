const ICONS = [
  'instagram', 'tiktok', 'youtube', 'spotify', 'apple-music',
  'youtube-music', 'deezer', 'bandcamp', 'soundcloud', 'vk', 'telegram'
]

export default {
  type: 'links',
  title: { en: 'Links', sr: 'Linkovi' },
  description: {
    en: 'Platforms and social networks as large rows.',
    sr: 'Platforme i društvene mreže u velikim redovima.'
  },

  defaults: { anchor: 'follow', navLabel: { en: 'Follow', sr: 'Mreže' } },

  texts: [
    { key: 'heading', label: { en: 'Section heading', sr: 'Naslov sekcije' }, input: 'text', general: true }
  ],

  media: [],

  settings: [
    {
      key: 'items',
      label: { en: 'Links', sr: 'Linkovi' },
      input: 'repeater',
      addLabel: { en: 'Add link', sr: 'Dodaj link' },
      fields: [
        { key: 'icon',   label: { en: 'Icon', sr: 'Ikona' },   input: 'select', options: ICONS },
        { key: 'label',  label: { en: 'Name', sr: 'Naziv' }, input: 'text' },
        { key: 'handle', label: { en: 'Text on the right', sr: 'Tekst desno' }, input: 'text' },
        { key: 'url',    label: { en: 'Link', sr: 'Link' },   input: 'url' }
      ],
      default: []
    }
  ],

  template: 'blocks/links'
}
