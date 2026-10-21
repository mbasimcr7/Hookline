import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#0B0F19',
        card: '#111827',
        'card-hover': '#1F2937',
        border: '#1F293D',
        'border-light': '#2E3A52',
        foreground: '#F8FAFC',
        muted: '#94A3B8',
        'muted-dark': '#64748B',
        brand: {
          50: '#F0FDF4',
          400: '#4ADE80',
          500: '#22C55E',
          600: '#16A34A',
        },
        cyan: {
          400: '#38BDF8',
          500: '#0EA5E9',
        },
        destructive: '#EF4444',
        warning: '#F59E0B',
      },
      fontFamily: {
        mono: ['Fira Code', 'JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 20px -5px rgba(34, 197, 94, 0.15)',
        'glow-cyan': '0 0 20px -5px rgba(56, 189, 248, 0.15)',
        'glow-danger': '0 0 20px -5px rgba(239, 68, 68, 0.2)',
      },
    },
  },
  plugins: [],
};

export default config;
