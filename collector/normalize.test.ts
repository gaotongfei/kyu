/** @jest-environment node */
import { arrangement, explicitCountry, htmlToText, jobId, safeUrl, timestamp } from './normalize';

test('converts source HTML to readable text without rendering scripts or inventing content', () => {
  expect(htmlToText('&amp;lt;p&amp;gt;Factual &amp;amp; clear&amp;lt;/p&amp;gt;')).toBe(
    'Factual & clear'
  );
  expect(htmlToText('<p>First</p><script>alert(1)</script><p>Second &#x1F600;</p>')).toBe(
    'First\nSecond 😀'
  );
  expect(htmlToText(null)).toBeNull();
});

test('recognizes only explicit country facts, not states, city guesses or remote eligibility', () => {
  expect(explicitCountry('Remote - United States')).toBe('US');
  expect(explicitCountry('Toronto, Canada')).toBe('CA');
  expect(explicitCountry('Remote (USA)')).toBe('US');
  for (const value of ['San Francisco, CA', 'London', 'Worldwide', 'Remote', 'Australia', null]) {
    expect(explicitCountry(value)).toBeNull();
  }
});

test('normalizes reported work arrangements but leaves unknown arrangements unknown', () => {
  expect(arrangement('In-Person')).toBe('onsite');
  expect(arrangement('Hybrid')).toBe('hybrid');
  expect(arrangement(true)).toBeNull();
  expect(arrangement('Flexible')).toBeNull();
});

test('limits identifiers and display links to safe representations', () => {
  expect(jobId(123)).toBe('123');
  expect(() => jobId('../123')).toThrow();
  expect(safeUrl(['javascript', 'alert(1)'].join(':'))).toBeNull();
  expect(safeUrl('https://secret@example.test')).toBeNull();
  expect(safeUrl('https://example.test/apply')).toBe('https://example.test/apply');
  expect(timestamp('unknown')).toBeNull();
  expect(timestamp('2026-11-26')).toBe('2026-11-26T00:00:00.000Z');
});
