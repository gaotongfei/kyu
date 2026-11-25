// Node-only, transient local extraction. Never persist bytes or load document URLs.
import { extractText, getMeta, getResolvedPDFJS } from 'unpdf';

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 20;

function escapeMarkdown(value: string) {
  // PDF text is not Markdown source: prevent inferred headings/lists, active links,
  // image requests, and HTML when the draft is subsequently previewed.
  return value.replace(/[\\`*_{}\[\]()<>#+\-.!|~]/g, '\\$&');
}

export async function extractPdfDraft(
  bytes: Uint8Array
): Promise<{ markdown: string; warnings: string[]; pages: number }> {
  if (bytes.byteLength > MAX_PDF_BYTES) {throw new Error('PDF files must be 10 MiB or smaller.');}
  if (
    bytes.byteLength < 8 ||
    !/^%PDF-\d\.\d/.test(Buffer.from(bytes.subarray(0, 8)).toString('ascii'))
  ) {
    throw new Error('Invalid PDF: the file does not have a PDF signature.');
  }

  const { getDocument } = await getResolvedPDFJS();
  // Use unpdf's bundled, local PDF.js build. Supplying bytes (not a URL) and no
  // CMap/font/worker URLs prevents uploaded content from choosing fetch targets.
  // Keep the loading task so even password/parse failures release PDF.js resources.
  const task = getDocument({
    data: new Uint8Array(bytes), // PDF.js can transfer/detach its input; preserve the caller's bytes.
    verbosity: 0,
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    useWasm: false,
    stopAtErrors: true,
  });
  try {
    const pdf = await task.promise;
    // Non-null permissions also detect owner-encrypted PDFs with an empty user
    // password, which do not trigger PDF.js's PasswordException. Metadata is a
    // second independent signal (Standard / other encryption filters).
    const [permissions, metadata] = await Promise.all([pdf.getPermissions(), getMeta(pdf)]);
    if (permissions !== null || metadata.info.EncryptFilterName) {
      throw new Error('Encrypted PDFs are not supported. Export an unencrypted PDF and try again.');
    }
    if (pdf.numPages > MAX_PDF_PAGES) {throw new Error('PDF files must contain at most 20 pages.');}

    const { text } = await extractText(pdf, { mergePages: false });
    const pages = text.map((page) =>
      page
        .replace(/\r\n?/g, '\n')
        .replace(/[^\S\n]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    );
    if (!pages.some(Boolean)) {
      throw new Error(
        'This PDF has no extractable text. Scanned or image-only PDFs need OCR, which is not supported.'
      );
    }
    const warnings = [
      'PDF import extracts text only, not the original Markdown, layout, or reliable reading order. Review and edit this draft before creating a resume.',
    ];
    const empty = pages.flatMap((page, index) => (page ? [] : [index + 1]));
    if (empty.length) {
      warnings.push(
        `Partial extraction: no text could be extracted from page${empty.length === 1 ? '' : 's'} ${empty.join(', ')}. Those pages were not recovered; OCR is not supported.`
      );
    }
    return {
      markdown: pages.filter(Boolean).map(escapeMarkdown).join('\n\n'),
      warnings,
      pages: pdf.numPages,
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'PasswordException' || /encrypt|password/i.test(error.message)) {
        throw new Error(
          'Encrypted PDFs are not supported. Export an unencrypted PDF and try again.'
        );
      }
      if (/at most 20 pages|no extractable text/.test(error.message)) {throw error;}
    }
    // Do not expose parser details, which can include uploaded document contents.
    throw new Error('Invalid or unreadable PDF. Export a new text-based PDF and try again.');
  } finally {
    await task.destroy();
  }
}
