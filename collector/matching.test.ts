import { locationText, matchedSearchIds, normalizeCountry } from './matching';
import type { CollectedJob, ReportedLocation, SavedSearch } from './types';

const search: SavedSearch = {
  id: 'software',
  name: 'Software',
  enabled: true,
  titlePhrases: ['software engineer', 'software developer'],
  countries: ['US', 'CA'],
  locationPhrases: [],
  allowUnknownLocation: false,
  workArrangements: [],
  allowUnknownWorkArrangement: false,
};

function location(patch: Partial<ReportedLocation> = {}): ReportedLocation {
  return { text: null, city: null, region: null, country: null, ...patch };
}

function job(patch: Partial<CollectedJob> = {}): CollectedJob {
  return {
    provider: 'ashby',
    source: 'ashby:example',
    sourceJobId: 'fixture-1',
    title: 'Senior Software Engineer',
    company: 'Example',
    jobUrl: null,
    applicationUrl: null,
    descriptionHtml: null,
    descriptionText: null,
    descriptionComplete: true,
    locations: [location({ country: 'US' })],
    workArrangement: null,
    reportedWorkArrangement: null,
    employmentType: null,
    compensation: [],
    reportedCompensation: null,
    sourcePostedAt: null,
    sourceUpdatedAt: null,
    upstreamSource: null,
    ...patch,
  };
}

it.each([
  ['US', 'US'],
  ['USA', 'US'],
  [' United States ', 'US'],
  ['united states of america', 'US'],
  ['ＣＡ', 'CA'],
  ['CAN', 'CA'],
  ['Canada', 'CA'],
  ['DE', 'DE'],
  ['NA', 'NA'],
  ['Germany', 'GERMANY'],
  ['United Kingdom', 'UNITED KINGDOM'],
  ['US / Canada', 'US / CANADA'],
  ['Remote US', 'REMOTE US'],
  ['', null],
  ['  ', null],
  [null, null],
  [undefined, null],
])('normalizes only exact country facts: %p -> %p', (input, expected) => {
  expect(normalizeCountry(input)).toBe(expected);
});

it.each([
  ['Senior SOFTWARE engineer', true],
  ['Software-Engineer (Platform)', true],
  ['Staff\tSoftware\nEngineer, Backend', true],
  ['Principal software developer', true],
  ['Ｓｏｆｔｗａｒｅ Engineer', true],
  ['Software engineering manager', false],
  ['Software engineers', false],
  ['Notsoftware engineer', false],
  ['Data analyst', false],
])('matches any normalized whole title phrase: %p', (title, matches) => {
  expect(matchedSearchIds(job({ title }), [search])).toEqual(matches ? ['software'] : []);
});

it.each([
  ['AI Engineer', true],
  ['Senior ai/ML engineer', true],
  ['Applied Machine-Learning Engineer', true],
  ['Artificial intelligence researcher', true],
  ['Paid Media Engineer', false],
  ['Chair Designer', false],
  ['OpenAI Engineer', false],
  ['AI2 Engineer', false],
  ['AI工程師', false],
])('keeps AI title boundaries in %p', (title, matches) => {
  const ai = {
    ...search,
    id: 'ai',
    titlePhrases: ['AI', 'machine learning', 'artificial intelligence'],
  };
  expect(matchedSearchIds(job({ title }), [ai])).toEqual(matches ? ['ai'] : []);
});

it('requires both title and geography, ORs enabled searches and returns explainable IDs in order', () => {
  const data = { ...search, id: 'data', titlePhrases: ['data engineer'] };
  const overlapping = { ...search, id: 'engineer', titlePhrases: ['engineer'] };
  const disabled = { ...search, id: 'disabled', enabled: false };
  expect(matchedSearchIds(job(), [data, disabled, search, overlapping])).toEqual([
    'software',
    'engineer',
  ]);
  expect(matchedSearchIds(job({ title: 'Data Engineer' }), [data, search])).toEqual(['data']);
  expect(matchedSearchIds(job(), [])).toEqual([]);
  expect(matchedSearchIds(job(), [disabled])).toEqual([]);
  expect(matchedSearchIds(job({ locations: [location({ country: 'DE' })] }), [search])).toEqual([]);
});

it('considers every reported location and all supported structured country aliases', () => {
  for (const country of ['US', 'USA', 'United States', 'CA', 'CAN', 'Canada']) {
    const locations = [
      location({ country: 'DE' }),
      location({ country }),
      location({ country: 'FR' }),
    ];
    expect(matchedSearchIds(job({ locations }), [search])).toEqual(['software']);
    expect(matchedSearchIds(job({ locations: locations.reverse() }), [search])).toEqual([
      'software',
    ]);
  }
  expect(
    matchedSearchIds(job({ locations: [location({ country: 'CA' })] }), [
      { ...search, countries: ['US'] },
    ])
  ).toEqual([]);
});

it('does not infer structured countries from free text, remote style or description text', () => {
  const descriptionText = 'This software engineer can work in the United States or Canada.';
  for (const text of ['Remote', 'Remote - United States', 'Toronto, Canada', 'San Francisco, US']) {
    expect(
      matchedSearchIds(
        job({
          locations: [location({ text })],
          workArrangement: 'remote',
          descriptionText,
          descriptionHtml: `<p>${descriptionText}</p>`,
        }),
        [search]
      )
    ).toEqual([]);
  }
  expect(matchedSearchIds(job({ locations: [], descriptionText }), [search])).toEqual([]);
});

it('matches explicit location phrases as alternatives to configured structured countries', () => {
  const local = { ...search, countries: ['US'], locationPhrases: ['Toronto', 'New York'] };
  expect(
    matchedSearchIds(
      job({
        locations: [location({ country: 'DE' }), location({ city: 'Toronto', country: 'CA' })],
      }),
      [local]
    )
  ).toEqual(['software']);
  expect(
    matchedSearchIds(job({ locations: [location({ text: 'New-York, NY' })] }), [local])
  ).toEqual(['software']);
  expect(
    matchedSearchIds(job({ locations: [location({ text: 'Greater Torontonians' })] }), [local])
  ).toEqual([]);
  // Phrases may not span distinct locations or come from job descriptions.
  expect(
    matchedSearchIds(job({ locations: [location({ text: 'New' }), location({ text: 'York' })] }), [
      local,
    ])
  ).toEqual([]);
  expect(
    matchedSearchIds(job({ locations: [], descriptionText: 'Toronto, New York' }), [local])
  ).toEqual([]);
  expect(matchedSearchIds(job(), [{ ...local, countries: [] }])).toEqual([]);
});

it('accepts remote text only when explicitly requested as a location phrase, not as a country', () => {
  const remote = job({ locations: [location({ text: 'Remote' })], workArrangement: 'remote' });
  expect(matchedSearchIds(remote, [search])).toEqual([]);
  expect(matchedSearchIds(remote, [{ ...search, locationPhrases: ['remote'] }])).toEqual([
    'software',
  ]);
});

it('treats both geographic lists empty as explicitly unrestricted, with no hidden US/Canada default', () => {
  const unrestricted = { ...search, countries: [], locationPhrases: [] };
  expect(
    matchedSearchIds(job({ locations: [location({ country: 'JP' })] }), [unrestricted])
  ).toEqual(['software']);
  expect(matchedSearchIds(job({ locations: [] }), [unrestricted])).toEqual(['software']);
});

it.each(
  [
    [],
    [location()],
    [location({ text: '' })],
    [location({ text: 'Remote' })],
    [location({ text: 'Fully remote' })],
    [location({ text: 'Remote / Worldwide' })],
    [location({ text: 'Work from anywhere' })],
    [location({ text: 'Unknown', country: 'N/A' })],
  ].map((locations) => ({ locations }))
)('requires explicit unknown opt-in when no usable geography exists: %p', ({ locations }) => {
  const listing = job({ locations, workArrangement: 'remote' });
  expect(matchedSearchIds(listing, [search])).toEqual([]);
  expect(matchedSearchIds(listing, [{ ...search, allowUnknownLocation: true }])).toEqual([
    'software',
  ]);
});

it.each(
  [
    [location({ country: 'DE' })],
    [location({ country: 'NA' })],
    [location({ country: 'Germany' })],
    [location({ city: 'Berlin' })],
    [location({ region: 'Bavaria' })],
    [location({ text: 'Remote - Europe' })],
    [location({ text: 'Remote - Canada' })],
    [location(), location({ country: 'GB' })],
    [location({ text: 'Remote' }), location({ text: 'London, UK' })],
  ].map((locations) => ({ locations }))
)('never treats known excluded or unstructured geography as unknown: %p', ({ locations }) => {
  expect(matchedSearchIds(job({ locations }), [{ ...search, allowUnknownLocation: true }])).toEqual(
    []
  );
});

it('does not let unknown geography bypass the title filter', () => {
  expect(
    matchedSearchIds(job({ title: 'Accountant', locations: [] }), [
      { ...search, allowUnknownLocation: true },
    ])
  ).toEqual([]);
});

it('applies the optional work-style filter with a separate unknown opt-in', () => {
  const remote = { ...search, workArrangements: ['remote' as const] };
  expect(matchedSearchIds(job({ workArrangement: 'remote' }), [remote])).toEqual(['software']);
  expect(matchedSearchIds(job({ workArrangement: 'hybrid' }), [remote])).toEqual([]);
  expect(
    matchedSearchIds(job({ workArrangement: null, reportedWorkArrangement: 'Remote' }), [remote])
  ).toEqual([]);
  expect(matchedSearchIds(job(), [{ ...remote, allowUnknownWorkArrangement: true }])).toEqual([
    'software',
  ]);
  expect(
    matchedSearchIds(job({ workArrangement: 'onsite' }), [
      { ...remote, allowUnknownWorkArrangement: true },
    ])
  ).toEqual([]);
  expect(matchedSearchIds(job({ workArrangement: 'onsite' }), [search])).toEqual(['software']);
  expect(matchedSearchIds(job(), [search])).toEqual(['software']);
  expect(matchedSearchIds(job({ locations: [], workArrangement: 'remote' }), [remote])).toEqual([]);
});

it('exports all reported location fields for storage/filtering without adding descriptions or work style', () => {
  const listing = job({
    locations: [
      location({ text: 'Remote - US', city: 'New York', region: 'NY', country: 'US' }),
      location({ text: 'Toronto', city: 'Toronto', region: 'Ontario', country: 'CA' }),
      location(),
      location({ text: ' Berlin ', country: 'DE' }),
    ],
    descriptionText: 'United Kingdom',
    workArrangement: 'hybrid',
  });
  expect(locationText(listing)).toBe(
    'Remote - US, New York, NY, US; Toronto, Ontario, CA; Berlin, DE'
  );
  expect(locationText(job({ locations: [] }))).toBe('');
  expect(locationText(job({ locations: [location()] }))).toBe('');
});
