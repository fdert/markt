/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Tajawal', 'system-ui', 'sans-serif'] },
      colors: {
        brand: { 50: '#eef8f6', 100: '#d5eee9', 200: '#acdcd3', 300: '#77c2b5', 400: '#45a394', 500: '#2a8879', 600: '#1d6e63', 700: '#0f5f58', 800: '#114a45', 900: '#123e3a' },
        ink: { 50: '#f7f7f5', 100: '#efeeea', 200: '#e1dfd8', 300: '#c9c6bc', 400: '#9a968a', 500: '#767265', 600: '#5b584d', 700: '#45433b', 800: '#2e2d28', 900: '#1d1c19' },
      },
      boxShadow: { card: '0 1px 2px rgba(29,28,25,.06), 0 1px 1px rgba(29,28,25,.03)', pop: '0 12px 32px -8px rgba(29,28,25,.25)' },
    },
  },
  plugins: [],
};
