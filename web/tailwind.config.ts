import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        leaf: { DEFAULT: '#2f6b3b', dark: '#1f4b29', light: '#e8f2ea' },
      },
    },
  },
  plugins: [],
} satisfies Config