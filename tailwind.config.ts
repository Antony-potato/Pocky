import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['Courier New', 'Courier', 'monospace'],
      },
      colors: {
        cream:  '#FFF5E4',
        pink:   '#FF6B9D',
        purple: '#6C5CE7',
      },
      animation: {
        'float':       'float 2.8s ease-in-out infinite',
        'bounce-soft': 'bounceSoft 0.4s ease-in-out infinite',
        'wiggle':      'wiggle 0.3s ease-in-out infinite',
        'jump':        'jump 0.45s ease-in-out infinite',
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
      },
    },
  },
  plugins: [],
};

export default config;