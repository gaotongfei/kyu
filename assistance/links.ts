export function preparationHref(source: string, sourceJobId: string): string {
  return `/prepare?${new URLSearchParams({ source, job: sourceJobId })}`;
}

export function aiSettingsHref(source?: string, sourceJobId?: string): string {
  return source && sourceJobId
    ? `/settings/ai?${new URLSearchParams({ source, job: sourceJobId })}`
    : '/settings/ai';
}
