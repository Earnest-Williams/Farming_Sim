export default [
  {
    files: ['js/time.js', 'js/labour.js', 'js/timeflow.js'],
    ignores: ['js/config/**'],
    languageOptions: {
      sourceType: 'module',
    },
    rules: {
      'no-magic-numbers': ['error', { ignore: [0, 1, -1], detectObjects: true }],
    },
  },
];
