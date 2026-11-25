import { exportMarkdown, fileName } from '../../markdown';
import { ResumeError } from '../../model';
import { getResume } from '../../storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  try {
    const resume = await getResume((await context.params).id);
    if (String(resume.version) !== new URL(request.url).searchParams.get('version')) {
      return Response.json(
        { error: 'The saved resume changed. Reload it before exporting Markdown.' },
        { status: 409, headers }
      );
    }
    return new Response(exportMarkdown(resume.sections), {
      headers: {
        ...headers,
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="resume.md"; filename*=UTF-8''${encodeURIComponent(fileName(resume.name, 'md'))}`,
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof ResumeError
            ? error.message
            : 'Markdown could not be exported. Check PostgreSQL and retry.',
      },
      { status: 500, headers }
    );
  }
}
