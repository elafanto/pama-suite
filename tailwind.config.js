import { fileURLToPath, URL } from 'node:url'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))

/** @type {import('tailwindcss').Config} */
export default {
  content: [here('./index.html'), here('./src/**/*.{vue,js,ts,jsx,tsx}')],
  theme: {
    extend: {
      colors: {
        navy:    '#0f2444',
        primary: '#1a3c6e',
        accent:  '#2563eb',
        'accent-dk': '#1d4ed8',
        teal:    '#0891b2',
        success: '#16a34a',
        warning: '#f59e0b',
        danger:  '#dc2626',
      },
      fontFamily: {
        sans: ['Inter', 'Noto Sans Devanagari', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 6px rgba(15,36,68,0.07)',
        'card-lg': '0 8px 28px rgba(15,36,68,0.12)',
      },
    },
  },
  plugins: [],
}
