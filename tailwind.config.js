/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Segoe UI Variable Display"', '"Inter"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Cascadia Code"', '"Consolas"', 'monospace'],
      },
      colors: {
        caelestia: {
          bg: 'rgba(18, 18, 22, 0.82)',
          card: 'rgba(255, 255, 255, 0.035)',
          cardHover: 'rgba(255, 255, 255, 0.06)',
          border: 'rgba(255, 255, 255, 0.08)',
          cardBorder: 'rgba(255, 255, 255, 0.05)',
          accent: '#cba6f7',
          cyan: '#89dceb',
          blue: '#89b4fa',
          pink: '#f5c2e7',
          green: '#a6e3a1',
          peach: '#fab387',
          red: '#f38ba8',
        },
      },
      transitionTimingFunction: {
        caelestia: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
};
