import { fileName } from '../../app/resumes/markdown';
import { validMarkdown } from '../../app/resumes/model';

export function downloadMarkdown(source: string, name: string): void {
  validMarkdown(source);
  const url = URL.createObjectURL(new Blob([source], { type: 'text/markdown;charset=utf-8' }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName(name, 'md');
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
