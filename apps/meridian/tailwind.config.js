/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg:      '#080808',
        surface: '#111111',
        border:  '#1f1f1f',
        accent:  '#6366f1',  // indigo — AgentPay brand
        gold:    '#f59e0b',  // trust score color
        green:   '#22c55e',
        red:     '#ef4444',
        muted:   '#6b7280',
      },
      fontFamily: {
        sans: ['System'],
      },
    },
  },
  plugins: [],
};
