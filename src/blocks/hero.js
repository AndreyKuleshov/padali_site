export default {
  type: 'hero',
  title: { en: 'Hero', sr: 'Zaglavlje' },
  description: {
    en: 'Full-height photo with the wordmark and a tagline over it.',
    sr: 'Fotografija preko celog ekrana, sa logotipom i sloganom.'
  },

  texts: [
    { key: 'tagline', label: { en: 'Tagline', sr: 'Slogan' }, input: 'text' }
  ],

  media: [
    { key: 'background', label: { en: 'Background photo', sr: 'Pozadinska fotografija' }, required: true }
  ],

  settings: [
    { key: 'show_wordmark', label: { en: 'Show the wordmark over the photo', sr: 'Prikaži logotip preko fotografije' }, input: 'checkbox', default: true },
    { key: 'full_height',   label: { en: 'Full screen height', sr: 'Preko cele visine ekrana' },           input: 'checkbox', default: true }
  ],

  template: 'blocks/hero'
}
