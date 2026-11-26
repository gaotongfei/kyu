import localFont from 'next/font/local';

export const classicFont = localFont({
  src: [
    { path: './fonts/Lato-Regular.ttf', weight: '400', style: 'normal' },
    { path: './fonts/Lato-Bold.ttf', weight: '700', style: 'normal' },
    { path: './fonts/Lato-Italic.ttf', weight: '400', style: 'italic' },
    { path: './fonts/Lato-BoldItalic.ttf', weight: '700', style: 'italic' },
  ],
  display: 'swap',
});
