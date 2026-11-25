import { fileName } from '../../markdown';
import { ResumeError } from '../../model';
import { renderResumePdf } from '../../pdf';
import { getResume } from '../../storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  try {
    const resume = await getResume((await context.params).id);
    const url = new URL(request.url);
    if (String(resume.version) !== url.searchParams.get('version')) {
      return Response.json(
        { error: 'The saved resume changed. Reload it before generating a PDF.' },
        { status: 409, headers }
      );
    }
    const { buffer, warnings } = await renderResumePdf(resume);
    return new Response(new Uint8Array(buffer), {
      headers: {
        ...headers,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${url.searchParams.has('download') ? 'attachment' : 'inline'}; filename="resume.pdf"; filename*=UTF-8''${encodeURIComponent(fileName(resume.name, 'pdf'))}`,
        'X-Resume-Warnings': encodeURIComponent(JSON.stringify(warnings)),
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof ResumeError
            ? error.message
            : 'The PDF could not be generated. Retry, or check the server configuration and resume content.',
      },
      { status: 500, headers }
    );
  }
}
