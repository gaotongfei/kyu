'use server';

import { getPreparationJob } from '../../assistance/jobs';
import {
  AiError,
  isLocalOrigin,
  isProvider,
  validModel,
  validateDraftInput,
  type DraftResult,
  type SelectedConnection,
} from '../../assistance/model';
import { requestOrigin } from '../../assistance/origin';
import { generateDraftPair } from '../../assistance/providers';
import { aiAttempt } from '../../assistance/result';
import { resolveGenerationConnection } from '../../assistance/settings';
import { validId, validVersion } from '../resumes/model';
import { getResume } from '../resumes/storage';

type GenerateRequest = {
  source: string;
  sourceJobId: string;
  resumeId: string;
  resumeVersion: number;
  connection: SelectedConnection;
};

export async function generateApplicationDrafts(input: GenerateRequest) {
  return aiAttempt<DraftResult>(async () => {
    if (!input || !input.connection || !isProvider(input.connection.provider)) {
      throw new AiError('Choose a connection and model in AI settings.');
    }
    validId(input.resumeId);
    validVersion(input.resumeVersion);
    validModel(input.connection.model);
    const [job, resume] = await Promise.all([
      getPreparationJob(input.source, input.sourceJobId),
      getResume(input.resumeId),
    ]);
    if (resume.version !== input.resumeVersion) {
      throw new AiError(
        'This resume changed in another tab. Refresh resumes before generating drafts.'
      );
    }
    const draftInput = {
      resumeMarkdown: resume.contentMarkdown,
      job: { title: job.title, company: job.company, descriptionText: job.descriptionText ?? '' },
    };
    validateDraftInput(draftInput);
    if (input.connection.provider === 'chatgpt' && !isLocalOrigin(await requestOrigin())) {
      throw new AiError(
        'ChatGPT-plan generation requires a supported same-computer installation. Choose an API-key connection in AI settings.'
      );
    }
    const connection = await resolveGenerationConnection(input.connection);
    const drafts = await generateDraftPair(connection, draftInput);
    return {
      drafts,
      resumeName: resume.name,
      sourceResumeId: resume.id,
      sourceResumeVersion: resume.version,
      provider: connection.provider,
      model: connection.model,
    };
  });
}
