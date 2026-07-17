import type {
  CoachLocale,
  ReviewCardPayload,
  ReviewGradePayload,
  ReviewRating,
} from './types';

const RATING_ORDER: ReviewRating[] = ['again', 'hard', 'good', 'easy'];
const INJECTION_PATTERNS = [
  /\bignore\b.{0,50}\b(?:previous|prior|system|developer)\b.{0,50}\binstructions?\b/i,
  /\b(?:system|developer)\s+(?:prompt|message)\b/i,
  /\b(?:reveal|print|output|return)\b.{0,50}\b(?:secret|token|system prompt|rating|rate me|easy)\b/i,
  /(?:忽略|无视).{0,30}(?:指令|提示词|系统|要求)/i,
  /(?:输出|返回|泄露).{0,30}(?:密钥|令牌|提示词|easy|评级|满分|答案)/i,
] as const;
const INJECTION_MARKER_PATTERN = /\b[A-Z][A-Z0-9_-]{5,}\b/g;
const ENGLISH_STOP_WORDS = new Set([
  'about',
  'after',
  'also',
  'answer',
  'before',
  'check',
  'from',
  'have',
  'into',
  'return',
  'that',
  'their',
  'then',
  'this',
  'through',
  'using',
  'with',
]);
const CHINESE_STOP_BIGRAMS = new Set([
  '一个',
  '使用',
  '可以',
  '检查',
  '记录',
  '返回',
  '通过',
  '需要',
  '进行',
]);

export interface SanitizedReviewGradingInput {
  reviewResponse: string;
  reviewCard: ReviewCardPayload;
  hadSuspiciousContent: boolean;
}

function containsInjectionPattern(value: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(value));
}

function sanitizedLines(value: string): {
  value: string;
  removedSuspiciousContent: boolean;
} {
  let removedSuspiciousContent = false;
  const lines = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => {
      if (!containsInjectionPattern(line)) return true;
      removedSuspiciousContent = true;
      return false;
    });
  return { value: lines.join('\n').trim(), removedSuspiciousContent };
}

export function sanitizeReviewGradingInput(
  reviewResponse: string,
  reviewCard: ReviewCardPayload,
  locale: CoachLocale = 'zh'
): SanitizedReviewGradingInput {
  const response = sanitizedLines(reviewResponse);
  const front = sanitizedLines(reviewCard.front);
  const back = sanitizedLines(reviewCard.back);
  let removedTag = false;
  const tags = reviewCard.tags
    .map((tag) => tag.trim())
    .filter((tag) => {
      if (!containsInjectionPattern(tag)) return Boolean(tag);
      removedTag = true;
      return false;
    })
    .slice(0, 8);
  const fallbackReference =
    tags.join(locale === 'zh' ? '；' : '; ') ||
    (locale === 'zh'
      ? '说明核心思路、复杂度和边界条件。'
      : 'Explain the core idea, complexity, and boundary conditions.');

  return {
    reviewResponse: response.value,
    reviewCard: {
      front:
        front.value ||
        (locale === 'zh' ? '请主动回忆本题要点。' : 'Recall the key ideas.'),
      back: back.value || fallbackReference,
      tags,
    },
    hadSuspiciousContent:
      response.removedSuspiciousContent ||
      front.removedSuspiciousContent ||
      back.removedSuspiciousContent ||
      removedTag,
  };
}

function normalizedText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}+#]+/gu, ' ')
    .trim();
}

function conceptTokens(value: string): Set<string> {
  const normalized = normalizedText(value);
  const tokens = new Set<string>();
  for (const token of normalized.match(/[a-z][a-z0-9+#-]*/g) ?? []) {
    if (token.length >= 3 && !ENGLISH_STOP_WORDS.has(token)) tokens.add(token);
  }
  for (const sequence of normalized.match(/[\p{Script=Han}]+/gu) ?? []) {
    if (sequence.length === 1) tokens.add(sequence);
    for (let index = 0; index < sequence.length - 1; index += 1) {
      const bigram = sequence.slice(index, index + 2);
      if (!CHINESE_STOP_BIGRAMS.has(bigram)) tokens.add(bigram);
    }
  }
  for (const complexity of value.match(/O\s*\([^)]{1,30}\)/gi) ?? []) {
    tokens.add(complexity.replace(/\s+/g, '').toLowerCase());
  }
  return tokens;
}

function referenceConcepts(back: string, tags: readonly string[]): string[] {
  const points = back
    .split(/[；;。.!?！？\n]+/)
    .map((point) => point.trim().slice(0, 300))
    .filter((point) => point.length >= 2 && !containsInjectionPattern(point));
  const candidates = points.length ? points : tags;
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = normalizedText(candidate);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isConceptHit(responseTokens: Set<string>, concept: string): boolean {
  const tokens = conceptTokens(concept);
  if (tokens.size) {
    return Array.from(tokens).some((token) => responseTokens.has(token));
  }
  return false;
}

function suggestedRatingForCoverage(coverage: number): ReviewRating {
  if (coverage <= 0) return 'again';
  if (coverage <= 0.5) return 'hard';
  if (coverage < 1) return 'good';
  return 'easy';
}

function ratingAtMost(
  rating: ReviewRating,
  maximum: ReviewRating
): ReviewRating {
  return RATING_ORDER[
    Math.min(RATING_ORDER.indexOf(rating), RATING_ORDER.indexOf(maximum))
  ];
}

export function createDeterministicReviewGrade(
  reviewResponse: string,
  reviewCard: ReviewCardPayload,
  locale: CoachLocale = 'zh'
): ReviewGradePayload {
  const sanitized = sanitizeReviewGradingInput(
    reviewResponse,
    reviewCard,
    locale
  );
  const concepts = referenceConcepts(
    sanitized.reviewCard.back,
    sanitized.reviewCard.tags
  ).slice(0, 8);
  const responseTokens = conceptTokens(sanitized.reviewResponse);
  const hitConcepts = sanitized.reviewResponse
    ? concepts.filter((concept) => isConceptHit(responseTokens, concept))
    : [];
  const hitKeys = new Set(hitConcepts.map(normalizedText));
  const missedConcepts = concepts.filter(
    (concept) => !hitKeys.has(normalizedText(concept))
  );
  const coverage = concepts.length ? hitConcepts.length / concepts.length : 0;
  const suggestedRating = suggestedRatingForCoverage(coverage);
  const confidence = sanitized.reviewResponse
    ? Math.min(0.95, 0.7 + concepts.length * 0.04)
    : 0.95;

  return {
    hitConcepts,
    missedConcepts,
    feedback:
      locale === 'zh'
        ? hitConcepts.length
          ? `已命中 ${hitConcepts.length} 个要点，仍需补充 ${missedConcepts.length} 个要点。`
          : '当前回答尚未覆盖复习卡中的关键要点，请先复述核心思路。'
        : hitConcepts.length
          ? `${hitConcepts.length} key point(s) were covered; add ${missedConcepts.length} missing point(s).`
          : 'The response does not yet cover the card’s key points; recall the core idea first.',
    suggestedRating,
    confidence,
  };
}

function suspiciousMarkers(value: string): string[] {
  if (!containsInjectionPattern(value)) return [];
  return Array.from(value.matchAll(INJECTION_MARKER_PATTERN), (match) =>
    match[0].toLowerCase()
  );
}

export function isReviewGradeOutputSafe(
  grade: ReviewGradePayload,
  reviewResponse: string,
  reviewCard: ReviewCardPayload
): boolean {
  const output = JSON.stringify(grade).toLowerCase();
  if (containsInjectionPattern(output)) return false;
  const source = `${reviewResponse}\n${reviewCard.front}\n${reviewCard.back}\n${reviewCard.tags.join('\n')}`;
  return !suspiciousMarkers(source).some((marker) => output.includes(marker));
}

function deduplicatedConcepts(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim())
    .filter((value) => {
      const key = normalizedText(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

export function normalizeReviewGrade(
  grade: ReviewGradePayload,
  reviewResponse: string,
  reviewCard: ReviewCardPayload,
  locale: CoachLocale = 'zh'
): ReviewGradePayload {
  const sanitized = sanitizeReviewGradingInput(
    reviewResponse,
    reviewCard,
    locale
  );
  if (!sanitized.reviewResponse) {
    return createDeterministicReviewGrade(reviewResponse, reviewCard, locale);
  }

  const hitConcepts = deduplicatedConcepts(grade.hitConcepts);
  const hitKeys = new Set(hitConcepts.map(normalizedText));
  const missedConcepts = deduplicatedConcepts(grade.missedConcepts).filter(
    (concept) => !hitKeys.has(normalizedText(concept))
  );
  const evidenceCount = hitConcepts.length + missedConcepts.length;
  const coverage = evidenceCount ? hitConcepts.length / evidenceCount : 0;
  const maximumRating = suggestedRatingForCoverage(coverage);
  const deterministic = createDeterministicReviewGrade(
    reviewResponse,
    reviewCard,
    locale
  );
  const hasTrustedLexicalEvidence = deterministic.hitConcepts.length > 0;
  const providerConfidence = Math.min(1, Math.max(0, grade.confidence));

  return {
    hitConcepts,
    missedConcepts,
    feedback: grade.feedback.trim(),
    suggestedRating: hasTrustedLexicalEvidence
      ? deterministic.suggestedRating
      : ratingAtMost(grade.suggestedRating, maximumRating),
    confidence: hasTrustedLexicalEvidence
      ? Math.max(deterministic.confidence, providerConfidence)
      : providerConfidence,
  };
}
