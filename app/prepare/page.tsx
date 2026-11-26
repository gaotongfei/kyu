import { getPreparationJob } from '../../assistance/jobs';
import { isLocalOrigin } from '../../assistance/model';
import { requestOrigin } from '../../assistance/origin';
import { aiAttempt } from '../../assistance/result';
import { loadLibrary } from '../resumes/actions';
import { loadAiSettings } from '../settings/ai/actions';
import { DraftWorkspace } from './DraftWorkspace';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = { title: 'Application drafts · Kyu' };

export default async function PreparationPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; job?: string }>;
}) {
  const { source, job } = await searchParams;
  const [jobResult, library, settings] = await Promise.all([
    aiAttempt(() => getPreparationJob(source ?? '', job ?? '')),
    loadLibrary(),
    loadAiSettings(),
  ]);
  const errors = [
    jobResult.ok ? '' : jobResult.error,
    library.ok ? '' : library.error,
    settings.ok ? '' : settings.error,
  ].filter(Boolean);
  return (
    <DraftWorkspace
      job={jobResult.ok ? jobResult.value : null}
      initialLibrary={library.ok ? library.value : []}
      initialSettings={settings.ok ? settings.value : null}
      initialError={[...new Set(errors)].join(' ')}
      localChatGPT={isLocalOrigin(await requestOrigin())}
    />
  );
}
