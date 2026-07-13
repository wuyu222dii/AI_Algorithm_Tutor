export const COACH_PROMPT_VERSION = 'coach-v1.1';
export const COACH_MODEL_WHITELIST = [
  'google/gemini-2.5-flash',
  'gpt-5.5',
  'openai/gpt-5.5',
  'anthropic/claude-4.5-sonnet',
] as const;
export const DEFAULT_COACH_MODEL = COACH_MODEL_WHITELIST[0];

export type CoachModel = (typeof COACH_MODEL_WHITELIST)[number];

export class CoachModelError extends Error {
  constructor(
    message: string,
    public readonly code: 'model_not_allowed' | 'provider_failed'
  ) {
    super(message);
    this.name = 'CoachModelError';
  }
}

export function resolveCoachModel(model?: string): CoachModel {
  const candidate =
    model?.trim() ||
    process.env.ALGO_COACH_MODEL?.trim() ||
    DEFAULT_COACH_MODEL;
  if (!COACH_MODEL_WHITELIST.includes(candidate as CoachModel)) {
    throw new CoachModelError(
      `Model "${candidate}" is not allowed for the coach endpoint.`,
      'model_not_allowed'
    );
  }
  return candidate as CoachModel;
}
