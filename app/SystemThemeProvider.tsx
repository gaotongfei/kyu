'use client';

import { MantineProvider, type MantineColorSchemeManager } from '@mantine/core';
import { theme } from '../theme';

const systemColorSchemeManager: MantineColorSchemeManager = {
  get: () => 'auto',
  set: () => {},
  subscribe: () => {},
  unsubscribe: () => {},
  clear: () => {},
};

export function SystemThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <MantineProvider
      theme={theme}
      defaultColorScheme="auto"
      colorSchemeManager={systemColorSchemeManager}
    >
      {children}
    </MantineProvider>
  );
}
