/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        gold: {
          300: '#FDE047',
          400: '#FACC15',
          500: '#EAB308',
          600: '#CA8A04',
          700: '#A16207',
          glow: '#d4af37',
        },
        dark: {
          900: '#0a0a0a',
          800: '#171717',
          700: '#262626',
        }
      },
      backgroundImage: {
        'gold-gradient': 'linear-gradient(to right, #A16207, #FDE047, #A16207)',
      },
      boxShadow: {
        'gold-glow': '0 0 20px rgba(212, 175, 55, 0.3)',
        'gold-glow-lg': '0 0 40px rgba(212, 175, 55, 0.5)',
      }
    },
  },
  plugins: [],
}