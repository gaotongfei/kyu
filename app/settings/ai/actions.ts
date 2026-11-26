'use server';

import {
  AiError,
  isLocalOrigin,
  isProvider,
  type AiProvider,
  type ApiKeyProvider,
} from '../../../assistance/model';
import { cancelChatGPTSignIn, startChatGPTSignIn } from '../../../assistance/oauth';
import { requestOrigin } from '../../../assistance/origin';
import { aiAttempt } from '../../../assistance/result';
import {
  connectApiKey,
  readSettings,
  refreshModels,
  removeConnection,
  selectConnection,
} from '../../../assistance/settings';

function checkProvider(provider: unknown): asserts provider is AiProvider {
  if (!isProvider(provider)) {
    throw new AiError('Choose a supported connection.');
  }
}

async function checkLocal(provider: AiProvider) {
  if (provider === 'chatgpt' && !isLocalOrigin(await requestOrigin())) {
    throw new AiError(
      'ChatGPT sign-in requires a supported same-computer installation. Use an API-key connection on this server.'
    );
  }
}

export async function loadAiSettings() {
  return aiAttempt(readSettings);
}

export async function connectAiProvider(provider: ApiKeyProvider, key: string) {
  return aiAttempt(async () => {
    if (provider !== 'openai' && provider !== 'openrouter') {
      throw new AiError('Choose OpenAI API or OpenRouter for an API key.');
    }
    return connectApiKey(provider, key);
  });
}

export async function removeAiConnection(provider: AiProvider) {
  return aiAttempt(async () => {
    checkProvider(provider);
    return removeConnection(provider);
  });
}

export async function refreshAiModels(provider: AiProvider) {
  return aiAttempt(async () => {
    checkProvider(provider);
    await checkLocal(provider);
    return refreshModels(provider);
  });
}

export async function saveAiSelection(provider: AiProvider, model: string) {
  return aiAttempt(async () => {
    checkProvider(provider);
    await checkLocal(provider);
    return selectConnection(provider, model);
  });
}

export async function beginChatGPTSignIn() {
  return aiAttempt(async () => startChatGPTSignIn(await requestOrigin()));
}

export async function cancelAiSignIn() {
  return aiAttempt(cancelChatGPTSignIn);
}
