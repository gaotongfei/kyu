import { act, render, screen, waitFor } from '@testing-library/react';
import type { Resume } from './model';
import { PdfPreview } from './PdfPreview';

const document: Resume = {
  id: 'doc',
  name: 'Base',
  version: 1,
  sections: [],
  themeKey: 'classic',
  createdAt: '',
  updatedAt: '',
};
const originalFetch = global.fetch;
beforeEach(() => {
  URL.createObjectURL = jest.fn(() => 'blob:pdf-latest');
  URL.revokeObjectURL = jest.fn();
});
afterEach(() => {
  global.fetch = originalFetch;
});
function response() {
  return { ok: true, blob: async () => new Blob(['PDF']), headers: { get: () => null } };
}
it('discards stale PDF responses and shows open/download fallback for the current PDF', async () => {
  let finishOld!: (value: ReturnType<typeof response>) => void;
  const old = new Promise<ReturnType<typeof response>>((resolve) => {
    finishOld = resolve;
  });
  global.fetch = jest.fn().mockReturnValueOnce(old).mockResolvedValueOnce(response());
  const { rerender } = render(<PdfPreview document={document} pending={false} />);
  rerender(<PdfPreview document={{ ...document, version: 2 }} pending={false} />);
  await waitFor(() =>
    expect(screen.getByTitle('PDF preview of Base')).toHaveAttribute('src', 'blob:pdf-latest')
  );
  await act(async () => {
    finishOld(response());
    await old;
  });
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', 'blob:pdf-latest');
  expect(screen.getByRole('link', { name: 'download this preview' })).toHaveAttribute('download');
  rerender(<PdfPreview document={{ ...document, version: 2 }} pending />);
  expect(screen.getByRole('status')).toHaveTextContent('pending edits');
});
it('reports failed generation without displaying a false live preview', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: false, json: async () => ({ error: 'Version conflict' }) });
  render(<PdfPreview document={document} pending={false} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Version conflict');
  expect(screen.queryByTitle('PDF preview of Base')).not.toBeInTheDocument();
});
