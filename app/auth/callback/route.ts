import { completeChatGPTSignIn } from '../../../assistance/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const privateHeaders = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

export async function GET(request: Request) {
  try {
    const host = request.headers.get('host');
    const incoming = new URL(request.url);
    if (
      !host ||
      !/^127\.0\.0\.1(?::[1-9]\d{0,4})?$/.test(host) ||
      incoming.protocol !== 'http:' ||
      incoming.pathname !== '/auth/callback'
    ) {
      throw new Error('Invalid loopback callback authority.');
    }
    const callback = new URL(`/auth/callback${incoming.search}`, `http://${host}`);
    await completeChatGPTSignIn(callback.href);
    return new Response(
      '<!doctype html><html lang="en"><meta charset="utf-8"><title>Kyu</title><h1>ChatGPT connected</h1><p>Return to Kyu. You can close this tab.</p></html>',
      { headers: privateHeaders }
    );
  } catch {
    return new Response(
      '<!doctype html><html lang="en"><meta charset="utf-8"><title>Kyu</title><h1>Sign-in could not be completed</h1><p>Return to Kyu and check AI settings before trying again.</p></html>',
      { status: 400, headers: privateHeaders }
    );
  }
}
