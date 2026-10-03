export default {
  type: 'youtube',
  title: { en: 'YouTube video', sr: 'YouTube video' },
  description: {
    en: 'An embedded clip. Paste a link — the video is checked and previewed right here.',
    sr: 'Ugrađeni klip. Nalepite link — video se proverava i prikazuje odmah ovde.'
  },

  defaults: { anchor: 'video', navLabel: { en: 'Clips', sr: 'Spotovi' } },

  texts: [
    { key: 'title', label: { en: 'Heading', sr: 'Naslov' }, input: 'text', general: true },
    { key: 'note', label: { en: 'Text under the video', sr: 'Tekst ispod videa' }, input: 'textarea', rows: 2 }
  ],

  settings: [
    {
      key: 'url',
      label: { en: 'Video link', sr: 'Link videa' },
      input: 'youtube',
      required: true,
      hint: {
        en: 'A link from the address bar or «Share» — youtube.com/watch, youtu.be or a Shorts link. A bare video id works too.',
        sr: 'Link iz adresne trake ili iz «Podeli» — youtube.com/watch, youtu.be ili Shorts. Može i sam id videa.'
      }
    },
    {
      key: 'full_width',
      label: { en: 'Full width', sr: 'Puna širina' },
      input: 'checkbox',
      default: false,
      hint: {
        en: 'Off — the video keeps the width of the text column.',
        sr: 'Isključeno — video zadržava širinu tekstualne kolone.'
      }
    }
  ],

  template: 'blocks/youtube'
}
