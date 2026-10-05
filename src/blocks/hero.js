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
    { key: 'background', label: { en: 'Background photo', sr: 'Pozadinska fotografija' }, required: true, size: { w: 2560, h: 1600 } },
    {
      key: 'background_narrow',
      label: { en: 'Photo for phones', sr: 'Fotografija za telefone' },
      size: { w: 1280, h: 2400 },
      hint: {
        en: 'A vertical crop. Without it a wide shot is fitted whole, and the gaps are filled by a blurred copy of it.',
        sr: 'Uspravan kadar. Bez njega se široka fotografija uklapa cela, a praznine popunjava njena zamućena kopija.'
      }
    },
    { key: 'logo', label: { en: 'Logo over the photo', sr: 'Logotip preko fotografije' }, fallback: 'siteLogo', size: { w: 840 } }
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
