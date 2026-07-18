import { describe, expect, it } from 'vitest';

import {
  acknowledgeGuestCoachClaim,
  COACH_GUEST_CLAIM_KEY,
  createCoachStorageScope,
  createInitialCoachState,
  loadCoachState,
  loadPendingGuestCoachClaim,
  prepareGuestCoachClaim,
  saveCoachState,
} from './storage';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

describe('durable guest learning-data claims', () => {
  it('keeps the guest namespace and stable envelope until matching ACK', () => {
    const storage = memoryStorage();
    const guest = createInitialCoachState();
    guest.profile = {
      goal: 'interview',
      preferredLanguage: 'javascript',
      weeklyTarget: 5,
      onboardedAt: '2026-07-18T00:00:00.000Z',
      timeZone: 'Pacific/Auckland',
    };
    saveCoachState(guest, storage);
    const scope = createCoachStorageScope('user-1');

    const envelope = prepareGuestCoachClaim('user-1', scope, storage);
    expect(envelope?.status).toBe('pending');
    expect(envelope?.snapshot.state.profile?.goal).toBe('interview');
    expect(storage.getItem(COACH_GUEST_CLAIM_KEY)).toBe(scope);
    expect(loadCoachState(storage).profile?.goal).toBe('interview');
    expect(loadCoachState(storage, scope).profile).toBeNull();
    expect(loadPendingGuestCoachClaim(scope, storage)?.claimId).toBe(
      envelope?.claimId
    );
    expect(prepareGuestCoachClaim('user-1', scope, storage)?.claimId).toBe(
      envelope?.claimId
    );

    expect(
      acknowledgeGuestCoachClaim(
        scope,
        {
          claimId: 'wrong-claim',
          status: 'acknowledged',
          revision: 2,
          replayed: false,
        },
        storage
      )
    ).toBe(false);
    expect(loadCoachState(storage).profile).not.toBeNull();

    expect(
      acknowledgeGuestCoachClaim(
        scope,
        {
          claimId: envelope?.claimId ?? '',
          status: 'acknowledged',
          revision: 3,
          replayed: false,
        },
        storage
      )
    ).toBe(true);
    expect(loadCoachState(storage).profile).toBeNull();
    expect(loadCoachState(storage, scope).profile).toBeNull();
    expect(loadPendingGuestCoachClaim(scope, storage)).toBeNull();

    const laterGuest = createInitialCoachState();
    laterGuest.completedProblemIds = ['dependency-cycle'];
    saveCoachState(laterGuest, storage);
    expect(prepareGuestCoachClaim('user-1', scope, storage)).not.toBeNull();
  });

  it('reserves guest ownership for the first authenticated account', () => {
    const storage = memoryStorage();
    const guest = createInitialCoachState();
    guest.completedProblemIds = ['two-value-target'];
    saveCoachState(guest, storage);

    expect(
      prepareGuestCoachClaim(
        'first-user',
        createCoachStorageScope('first-user'),
        storage
      )
    ).not.toBeNull();
    expect(
      prepareGuestCoachClaim(
        'second-user',
        createCoachStorageScope('second-user'),
        storage
      )
    ).toBeNull();
  });
});
