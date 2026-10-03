export default {
  type: 'richtext',
  title: 'Текст',
  description: 'Заголовок и форматированный текст: новости, биография, объявления.',

  texts: [
    { key: 'heading', label: 'Заголовок', input: 'text' },
    {
      key: 'body',
      label: 'Текст',
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
      label: 'Ширина колонки',
      input: 'select',
      options: ['narrow', 'full'],
      optionLabels: { narrow: 'Узкая (удобно читать)', full: 'Во всю ширину' },
      default: 'narrow'
    }
  ],

  template: 'blocks/richtext'
}
