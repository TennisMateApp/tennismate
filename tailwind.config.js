module.exports = {
  darkMode: 'class', // 👈 Add this line!
  theme: {
    extend: {
      padding: {
        'safe-bottom': 'env(safe-area-inset-bottom)',
      },
      margin: {
        'safe-bottom': 'env(safe-area-inset-bottom)',
      }
    },
  },
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
};
