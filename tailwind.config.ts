import type { Config } from 'tailwindcss';

/**
 * Colours resolve to CSS variables so a theme switch is a single attribute
 * change on <html>, with no class rewriting across the tree.
 */
const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        raised: 'var(--bg-raised)',
        overlay: 'var(--bg-overlay)',
        surface: 'var(--surface)',
        'surface-hover': 'var(--surface-hover)',
        line: 'var(--border)',
        'line-strong': 'var(--border-strong)',
        ink: 'var(--text)',
        muted: 'var(--text-muted)',
        faint: 'var(--text-faint)',
        ok: 'var(--ok)',
        warn: 'var(--warn)',
        bad: 'var(--bad)',
        idle: 'var(--idle)',
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        lg: 'var(--radius-lg)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow)',
        lg: 'var(--shadow-lg)',
      },
      maxWidth: {
        shell: '1400px',
      },
    },
  },
  plugins: [],
};

export default config;
