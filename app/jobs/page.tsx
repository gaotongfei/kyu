import { JobCatalog } from '../../components/JobCatalog/JobCatalog';
import { catalogFilters } from '../../jobs/filters';
import { loadCatalog } from '../../jobs/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Kyu · Jobs', description: 'Private, collected job listings.' };

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = catalogFilters(await searchParams);
  const result = await loadCatalog(filters);
  return <JobCatalog result={result} />;
}
