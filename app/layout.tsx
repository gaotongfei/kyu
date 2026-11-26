import '@mantine/core/styles.css';

import React from 'react';
import { mantineHtmlProps } from '@mantine/core';
import { SystemThemeProvider } from './SystemThemeProvider';
import './resumes/tokens.css';

export const metadata = {
  title: 'Kyu · Resume editor',
  description: 'Private, self-hosted Markdown resumes.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" {...mantineHtmlProps}>
      <head>
        <script
          data-mantine-script
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.setAttribute("data-mantine-color-scheme", window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");`,
          }}
        />
        <link rel="shortcut icon" href="/favicon.svg" />
      </head>
      <body>
        <SystemThemeProvider>{children}</SystemThemeProvider>
      </body>
    </html>
  );
}
