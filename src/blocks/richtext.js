export default {
  type: 'richtext',
  title: { en: 'Text', sr: 'Tekst' },
  description: {
    en: 'A heading and formatted text: news, bio, announcements.',
    sr: 'Naslov i formatiran tekst: vesti, biografija, najave.'
  },

  texts: [
    { key: 'heading', label: { en: 'Heading', sr: 'Naslov' }, input: 'text' },
    {
      key: 'body',
      label: { en: 'Text', sr: 'Tekst' },
      input: 'richtext',
      rows: 12,
      hint: 'Можно использовать разметку: <p>, <strong>, <em>, <a>, <ul>/<ol>/<li>, ' +
            '<blockquote>, <h3>, <h4>, <hr>, <code>. Остальное вырезается при выводе.'
    }
  ],

  media: [],

  settings: [
    {
      key: 'width',
      label: { en: 'Column width', sr: 'Širina kolone' },
      input: 'select',
      options: ['narrow', 'full'],
      optionLabels: {
        narrow: { en: 'Narrow (easier to read)', sr: 'Uska (lakše za čitanje)' },
        full: { en: 'Full width', sr: 'Puna širina' }
      },
      default: 'narrow'
    }
  ],

  template: 'blocks/richtext'
}
