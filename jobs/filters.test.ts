import { catalogFilters, catalogHref, literalLike } from './filters';

test('bounds GET values and defaults to active listings/page one', () => {
  expect(catalogFilters({})).toEqual({ q: '', location: '', includeInactive: false, page: 1 });
  expect(
    catalogFilters({
      q: ['  Engineer ', 'ignored'],
      location: 'Canada',
      inactive: '1',
      page: '9999999',
    })
  ).toEqual({ q: 'Engineer', location: 'Canada', includeInactive: true, page: 1 });
  expect(catalogFilters({ q: 'a'.repeat(500), page: '00000' }).q).toHaveLength(120);
  expect(catalogFilters({ page: '99999' }).page).toBe(10000);
});

test('removes control characters before PostgreSQL text comparison', () => {
  expect(
    catalogFilters({ q: `Engineer${String.fromCharCode(0)}`, location: 'Canada\n' })
  ).toMatchObject({ q: 'Engineer', location: 'Canada' });
});

test('preserves filters in pagination and inactive links without unsafe targets', () => {
  const filters = catalogFilters({ q: 'C++ & AI', location: 'Toronto', page: '2' });
  expect(catalogHref(filters)).toBe('/jobs?q=C%2B%2B+%26+AI&location=Toronto&page=2');
  expect(catalogHref(filters, { includeInactive: true, page: 1 })).toBe(
    '/jobs?q=C%2B%2B+%26+AI&location=Toronto&inactive=1'
  );
  expect(catalogHref(catalogFilters({}))).toBe('/jobs');
});

test('treats SQL wildcard characters as literal search text', () => {
  expect(literalLike('50%_\\')).toBe('%50\\%\\_\\\\%');
});
