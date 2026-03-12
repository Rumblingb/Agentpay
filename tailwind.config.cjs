/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './dashboard/app/**/*.{js,ts,jsx,tsx}',
    './dashboard/components/**/*.{js,ts,jsx,tsx}',
    './dashboard/src/**/*.{js,ts,jsx,tsx}',
    './src/**/*.{js,ts,jsx,tsx}',
    './apps/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        live: 'var(--color-live)',
        ceremony: 'var(--color-ceremony)',
        trust: 'var(--color-trust)',
        panelGlass: 'var(--panel-glass-bg)',
        panelLedger: 'var(--panel-ledger-bg)',
        panelConstitutional: 'var(--panel-constitutional-bg)',
      },
      spacing: {
        'section': 'var(--space-section)',
        'card': 'var(--space-card)',
        'tight': 'var(--space-tight)'
      },
      boxShadow: {
        'panel-glass': 'var(--panel-glass-elevation)',
        'panel-ledger': 'var(--panel-ledger-elevation)',
        'panel-constitutional': 'var(--panel-constitutional-elevation)'
      },
      fontSize: {
        'heading-xl': 'var(--heading-xl)',
        'heading-lg': 'var(--heading-lg)',
        'heading-md': 'var(--heading-md)',
        'body': 'var(--body-size)',
        'label': 'var(--label-size)'
      }
    }
  },
  plugins: [],
};
