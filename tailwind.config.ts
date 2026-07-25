import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        outfit: ['var(--font-outfit)', 'system-ui', 'sans-serif'],
        inter:  ['var(--font-inter)', 'system-ui', 'sans-serif'],
        caveat: ['var(--font-caveat)', 'cursive'],
        mono:   ['Courier New', 'Courier', 'monospace'],
      },
      colors: {
        cream:  '#FFF5E4',
        pink:   '#FF6B9D',
        purple: '#6C5CE7',
        night:  { from: '#1e1b4b', to: '#312e81' },
      },
      animation: {
        'float':       'float 2.8s ease-in-out infinite',
        'bounce-soft': 'bounceSoft 0.4s ease-in-out infinite',
        'wiggle':      'wiggle 0.3s ease-in-out infinite',
        'jump':        'jump 0.45s ease-in-out infinite',
        'pulse-soft':  'pulseSoft 3s ease-in-out infinite',
        'twinkle':     'twinkle 2s ease-in-out infinite',
        'float-up':    'floatUp 1.2s ease-out forwards',
        'toast-in':    'toastIn 0.25s ease-out',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':      { transform: 'translateY(-8px)' },
        },
        bounceSoft: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':      { transform: 'translateY(-10px)' },
        },
        wiggle: {
          '0%':   { transform: 'rotate(-12deg)' },
          '50%':  { transform: 'rotate(12deg)' },
          '100%': { transform: 'rotate(-12deg)' },
        },
        jump: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '40%':      { transform: 'translateY(-20px)' },
        },
        pulseSoft: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%':      { transform: 'scale(1.04)' },
        },
        twinkle: {
          '0%, 100%': { opacity: '0.3' },
          '50%':      { opacity: '1' },
        },
        floatUp: {
          '0%':   { transform: 'translateY(0) scale(1)', opacity: '1' },
          '100%': { transform: 'translateY(-80px) scale(0.5)', opacity: '0' },
        },
        toastIn: {
          '0%':   { transform: 'translate(-50%, -8px)', opacity: '0' },
          '100%': { transform: 'translate(-50%, 0)',    opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};

export default config;