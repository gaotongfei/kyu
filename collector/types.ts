export type BoardProvider = 'ashby' | 'greenhouse';
export type Provider = BoardProvider | 'hirebase';
export type WorkArrangement = 'remote' | 'hybrid' | 'onsite';

export interface Board {
  provider: BoardProvider;
  slug: string;
  company: string;
  boardUrl: string;
  enabled: boolean;
  provenance: {
    url: string;
    commit: string | null;
    lastCrawled: string | null;
    license: string | null;
  };
}

export interface SavedSearch {
  id: string;
  name: string;
  enabled: boolean;
  titlePhrases: string[];
  countries: string[];
  locationPhrases: string[];
  allowUnknownLocation: boolean;
  workArrangements: WorkArrangement[];
  allowUnknownWorkArrangement: boolean;
}

export interface CollectionConfig {
  boards: Board[];
  searches: SavedSearch[];
}

export interface ReportedLocation {
  text: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
}

export interface Compensation {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: string | null;
  kind: string | null;
  summary: string | null;
}

export interface CollectedJob {
  provider: Provider;
  source: string;
  sourceJobId: string;
  title: string;
  company: string;
  jobUrl: string | null;
  applicationUrl: string | null;
  descriptionHtml: string | null;
  descriptionText: string | null;
  descriptionComplete: boolean;
  locations: ReportedLocation[];
  workArrangement: WorkArrangement | null;
  reportedWorkArrangement: string | null;
  employmentType: string | null;
  compensation: Compensation[];
  reportedCompensation: unknown;
  sourcePostedAt: string | null;
  sourceUpdatedAt: string | null;
  upstreamSource: { provider: string | null; jobId: string | null; boardUrl: string | null } | null;
}

export interface SourceResult {
  source: string;
  provider: Provider;
  status: 'success' | 'partial' | 'failed' | 'skipped';
  complete: boolean;
  fetched: number;
  retained: number;
  deactivated: number;
  message: string | null;
}

export interface RunReport {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'success' | 'partial' | 'failed' | 'interrupted';
  sources: SourceResult[];
  hirebase: {
    requestedBudget: number;
    reserved: number;
    returned: number;
    uncertain: number;
    providerRemaining: number | null;
    period: string;
  };
}
