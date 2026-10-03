const ICONS = [
  'instagram', 'tiktok', 'youtube', 'spotify', 'apple-music',
  'youtube-music', 'deezer', 'bandcamp', 'soundcloud', 'vk', 'telegram'
]

export default {
  type: 'footer',
  title: { en: 'Footer', sr: 'Podnožje' },
  description: {
    en: 'Logo, a line of text and small links. Always last on the page.',
    sr: 'Logotip, red teksta i male veze. Uvek poslednje na strani.'
  },

  // Подвал — всегда последний блок, переставить его нельзя.
  pinned: 'bottom',

  texts: [
    { key: 'note', label: { en: 'Text on the right', sr: 'Tekst desno' }, input: 'text' }
  ],

  media: [
    { key: 'logo', label: { en: 'Logo', sr: 'Logotip' } }
  ],

  settings: [
    {
      key: 'show_logo',
      label: { en: 'Show the logo', sr: 'Prikaži logotip' },
      input: 'checkbox',
      default: true,
      hint: {
        en: 'If no logo is uploaded, the one from the site header is used.',
        sr: 'Ako logotip nije otpremljen, koristi se onaj iz zaglavlja sajta.'
      }
    },
    {
      key: 'links',
      label: { en: 'Links', sr: 'Veze' },
      input: 'repeater',
      addLabel: { en: 'Add link', sr: 'Dodaj vezu' },
      fields: [
        { key: 'icon', label: { en: 'Icon', sr: 'Ikona' }, input: 'select', options: ICONS },
        { key: 'label', label: { en: 'Name', sr: 'Naziv' }, input: 'text' },
        { key: 'url', label: { en: 'Link', sr: 'Link' }, input: 'url' }
      ],
      default: []
    }
  ],

  template: 'blocks/footer'
}
