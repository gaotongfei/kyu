export function fileName(name: string, extension: 'md' | 'pdf') {
  const safe = Array.from(name.replace(/[^\p{L}\p{N}\- _]/gu, '').trim())
    .slice(0, 80)
    .join('');
  return `${safe || 'resume'}.${extension}`;
}
