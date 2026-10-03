export default {
  type: 'hero',
  title: { en: 'Hero', sr: 'Zaglavlje' },
  description: {
    en: 'Full-height photo with the logo and a tagline over it. Always first on the page.',
    sr: 'Fotografija preko celog ekrana, sa logotipom i sloganom. Uvek prva na strani.'
  },

  // Шапка — всегда первый блок, переставить её нельзя.
  pinned: 'top',

  texts: [
    { key: 'tagline', label: { en: 'Tagline', sr: 'Slogan' }, input: 'text' }
  ],

  media: [
    { key: 'background', label: { en: 'Background photo', sr: 'Pozadinska fotografija' }, required: true },
    { key: 'logo', label: { en: 'Logo over the photo', sr: 'Logotip preko fotografije' } }
  ],

  settings: [
    {
      key: 'show_wordmark',
      label: { en: 'Show the logo over the photo', sr: 'Prikaži logotip preko fotografije' },
      input: 'checkbox',
      default: true,
      hint: {
        en: 'If no logo is uploaded, the one from the site header is used.',
        sr: 'Ako logotip nije otpremljen, koristi se onaj iz zaglavlja sajta.'
      }
    },
    { key: 'full_height',   label: { en: 'Full screen height', sr: 'Preko cele visine ekrana' },           input: 'checkbox', default: true }
  ],

  template: 'blocks/hero'
}
