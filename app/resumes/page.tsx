import { loadDocument, loadLibrary } from './actions';
import { Editor } from './Editor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ResumesPage({
  searchParams,
}: {
  searchParams: Promise<{ resume?: string }>;
}) {
  const { resume } = await searchParams;
  const library = await loadLibrary();
  if (!library.ok) {
    return <Editor initialLibrary={[]} initialDocument={null} initialError={library.error} />;
  }
  const selectedId = resume || library.value[0]?.id;
  const first = selectedId ? await loadDocument(selectedId) : null;
  return (
    <Editor
      initialLibrary={library.value}
      initialDocument={first?.ok ? first.value : null}
      initialError={first && !first.ok ? first.error : undefined}
    />
  );
}
