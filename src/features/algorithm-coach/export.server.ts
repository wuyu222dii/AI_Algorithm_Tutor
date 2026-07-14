import 'server-only';

import { and, asc, eq, inArray } from 'drizzle-orm';

import { dbPostgres } from '@/core/db';
import {
  coachAssessment,
  coachCodeRun,
  coachImportedTestCase,
  coachLearningArtifact,
  coachLearningProfile,
  coachPracticeSession,
  coachProblem,
  coachProductEvent,
  coachReviewItem,
  coachSyncMutation,
  coachSyncState,
} from '@/config/db/schema.postgres';

export const COACH_ACCOUNT_EXPORT_VERSION = 3;

export async function exportCoachLearningData(userId: string) {
  const database = dbPostgres();
  return database.transaction(async (tx) => {
    const [
      profiles,
      practiceSessions,
      learningArtifacts,
      assessments,
      productEvents,
      reviewItems,
      ownedProblems,
      syncStates,
      syncMutations,
    ] = await Promise.all([
      tx
        .select()
        .from(coachLearningProfile)
        .where(eq(coachLearningProfile.userId, userId)),
      tx
        .select()
        .from(coachPracticeSession)
        .where(eq(coachPracticeSession.userId, userId))
        .orderBy(asc(coachPracticeSession.startedAt)),
      tx
        .select()
        .from(coachLearningArtifact)
        .where(eq(coachLearningArtifact.userId, userId))
        .orderBy(asc(coachLearningArtifact.createdAt)),
      tx
        .select()
        .from(coachAssessment)
        .where(eq(coachAssessment.userId, userId))
        .orderBy(asc(coachAssessment.startedAt)),
      tx
        .select()
        .from(coachProductEvent)
        .where(eq(coachProductEvent.userId, userId))
        .orderBy(asc(coachProductEvent.occurredAt)),
      tx
        .select()
        .from(coachReviewItem)
        .where(eq(coachReviewItem.userId, userId))
        .orderBy(asc(coachReviewItem.problemSlug)),
      tx
        .select()
        .from(coachProblem)
        .where(eq(coachProblem.ownerUserId, userId))
        .orderBy(asc(coachProblem.createdAt)),
      tx.select().from(coachSyncState).where(eq(coachSyncState.userId, userId)),
      tx
        .select()
        .from(coachSyncMutation)
        .where(eq(coachSyncMutation.userId, userId))
        .orderBy(asc(coachSyncMutation.createdAt)),
    ]);

    const sessionIds = practiceSessions.map((session) => session.id);
    const ownedProblemIds = ownedProblems.map((problem) => problem.id);
    const [codeRuns, draftTestCases] = await Promise.all([
      sessionIds.length
        ? tx
            .select()
            .from(coachCodeRun)
            .where(inArray(coachCodeRun.sessionId, sessionIds))
            .orderBy(asc(coachCodeRun.executedAt))
        : Promise.resolve([]),
      ownedProblemIds.length
        ? tx
            .select()
            .from(coachImportedTestCase)
            .where(
              and(
                eq(coachImportedTestCase.ownerUserId, userId),
                inArray(coachImportedTestCase.problemId, ownedProblemIds)
              )
            )
            .orderBy(
              asc(coachImportedTestCase.problemId),
              asc(coachImportedTestCase.ordinal)
            )
        : Promise.resolve([]),
    ]);

    return {
      exportVersion: COACH_ACCOUNT_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      accountId: userId,
      learningData: {
        profiles,
        practiceSessions,
        codeRuns,
        learningArtifacts,
        assessments,
        productEvents,
        reviewItems,
        privateProblems: ownedProblems,
        privateProblemTestCases: draftTestCases,
        syncStates,
        syncMutations,
      },
      counts: {
        profiles: profiles.length,
        practiceSessions: practiceSessions.length,
        codeRuns: codeRuns.length,
        learningArtifacts: learningArtifacts.length,
        assessments: assessments.length,
        productEvents: productEvents.length,
        reviewItems: reviewItems.length,
        privateProblems: ownedProblems.length,
        privateProblemTestCases: draftTestCases.length,
        syncStates: syncStates.length,
        syncMutations: syncMutations.length,
      },
    };
  });
}
