import { aiSettingsHref, preparationHref } from '../../../assistance/links';
import { isLocalOrigin } from '../../../assistance/model';
import { requestOrigin } from '../../../assistance/origin';
import { loadAiSettings } from './actions';
import { AiSettingsForm } from './SettingsForm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = { title: 'AI settings · Kyu' };

export default async function AiSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; job?: string }>;
}) {
  const { source, job } = await searchParams;
  const result = await loadAiSettings();
  const returnHref =
    typeof source === 'string' && typeof job === 'string' ? preparationHref(source, job) : '/jobs';
  return (
    <AiSettingsForm
      initialSettings={result.ok ? result.value : null}
      initialError={result.ok ? undefined : result.error}
      localChatGPT={isLocalOrigin(await requestOrigin())}
      returnHref={returnHref}
      settingsHref={aiSettingsHref(source, job)}
    />
  );
}
