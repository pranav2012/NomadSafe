export interface LandingState {
  /** Open the app on Money (only while there's no active trip). */
  landOnMoney: boolean;
  /** Sessions in a row pointing the other way. */
  streak: number;
}

export interface LandingSession {
  hadTrip: boolean;
  visitedMoney: boolean;
  landedOnMoney: boolean;
  /** Landed on Money and left it within a few seconds without using it. */
  leftMoneyQuickly: boolean;
}

export const INITIAL_LANDING: LandingState = { landOnMoney: false, streak: 0 };
const SESSIONS_TO_SWITCH = 2;

/**
 * Learns where the app should open from the last session. With no trip: 2 sessions in a row that
 * visit Money switch to opening on Money; 2 in a row that leave it straight away switch back to
 * Home. A session with an active trip resets everything (trips always open on Home).
 */
export function nextLanding(state: LandingState, session: LandingSession): LandingState {
  if (session.hadTrip) return INITIAL_LANDING;
  const pointsAway = state.landOnMoney ? session.landedOnMoney && session.leftMoneyQuickly : session.visitedMoney;
  const streak = pointsAway ? state.streak + 1 : 0;
  if (streak >= SESSIONS_TO_SWITCH) return { landOnMoney: !state.landOnMoney, streak: 0 };
  return { landOnMoney: state.landOnMoney, streak };
}
