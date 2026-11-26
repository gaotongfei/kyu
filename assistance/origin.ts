import { headers } from 'next/headers';
import 'server-only';

export async function requestOrigin(): Promise<string> {
  const values = await headers();
  const origin = values.get('origin');
  if (origin) {
    return origin;
  }
  const host = values.get('host');
  if (!host) {
    return '';
  }
  return `${values.get('x-forwarded-proto') === 'https' ? 'https' : 'http'}://${host}`;
}
