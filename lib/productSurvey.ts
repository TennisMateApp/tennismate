export const PRODUCT_SURVEY_ID = "product-survey-2026-08";
export const PRODUCT_SURVEY_STEPS = 3;
export const SURVEY_TEXT_LIMIT = 500;
export const SURVEY_OTHER_TEXT_LIMIT = 200;
export const SURVEY_USER_NAME_LIMIT = 100;
export const SURVEY_PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export type SurveyPromptDismissalState = {
  dismissalCount: 0 | 1 | 2;
  hiddenUntil: number | null;
  permanentlyDismissed: boolean;
};

export const EMPTY_SURVEY_PROMPT_DISMISSAL: SurveyPromptDismissalState = {
  dismissalCount: 0,
  hiddenUntil: null,
  permanentlyDismissed: false,
};

export const PLAY_FREQUENCY_OPTIONS = [
  ["less_than_monthly", "Less than once a month"],
  ["1_3_per_month", "1–3 times a month"],
  ["once_per_week", "Once a week"],
  ["2_3_per_week", "2–3 times a week"],
  ["4_plus_per_week", "4+ times a week"],
] as const;

export const REASON_OPTIONS = [
  ["new_people", "Find new people to play with"],
  ["similar_skill", "Find players around my skill level"],
  ["nearby_players", "Find players nearby"],
  ["play_more_often", "Play tennis more often"],
  ["regular_partners_unavailable", "Find people when my regular partners aren't available"],
  ["social_connections", "Meet other tennis players socially"],
  ["events_activities", "Find tennis events or activities"],
  ["other", "Other"],
] as const;

export const PLAYED_OPTIONS = [
  ["yes_once", "Yes, once"],
  ["yes_2_5", "Yes, 2–5 times"],
  ["yes_more_than_5", "Yes, more than 5 times"],
  ["not_yet", "Not yet"],
] as const;

export const MATCH_BARRIER_OPTIONS = [
  ["no_response", "Players don't respond"],
  ["requests_not_accepted", "Match requests aren't accepted"],
  ["skill_level", "Difficult to find players at my level"],
  ["nearby_players", "Difficult to find players nearby"],
  ["availability_mismatch", "Our availability doesn't match"],
  ["conversation_stalls", "Conversation doesn't lead to organising a match"],
  ["unsure_who_to_contact", "I'm not sure who to contact"],
  ["not_tried", "I haven't tried to organise a match yet"],
  ["no_difficulty", "I haven't had any difficulty"],
  ["other", "Other"],
] as const;

export const FAVOURITE_FEATURE_OPTIONS = [
  ["match_me", "Match Me / player discovery"],
  ["match_requests", "Match requests"],
  ["chat", "Chat"],
  ["match_scheduling", "Match scheduling / invites"],
  ["courts", "Courts"],
  ["clubs", "Clubs"],
  ["events", "Events"],
  ["activity_leaderboard", "Activity leaderboard"],
  ["other", "Other"],
] as const;

export const DESIRED_FEATURE_OPTIONS = [
  ["better_recommendations", "Better player recommendations"],
  ["accurate_skill_levels", "More accurate skill levels"],
  ["player_stats", "Player stats (matches, hours played, opponents, etc.)"],
  ["match_history", "Match history and head-to-head records"],
  ["achievements", "Achievements, badges and activity levels"],
  ["easier_scheduling", "Easier match scheduling"],
  ["more_local_players", "More players in my area"],
  ["social_events", "Social tennis / events"],
  ["club_features", "Club features"],
  ["other", "Other"],
] as const;

export const EVENT_INTEREST_OPTIONS = [["yes", "Yes"], ["maybe", "Maybe"], ["no", "No"]] as const;

export const PREMIUM_PRICE_OPTIONS = [
  ["would_not_pay", "I wouldn't pay for Premium"],
  ["1_2_aud", "$1–$2/month"],
  ["3_5_aud", "$3–$5/month"],
  ["6_8_aud", "$6–$8/month"],
  ["9_plus_aud", "$9+/month"],
  ["not_sure", "Not sure"],
] as const;

export const PREMIUM_FEATURE_OPTIONS = [
  ["advanced_filters", "Advanced player filters"],
  ["better_recommendations", "Better player recommendations"],
  ["advanced_stats", "Advanced player stats"],
  ["performance_insights", "Skill rating and performance insights"],
  ["unlimited_requests", "Unlimited match requests"],
  ["premium_profile", "Premium profile features"],
  ["partner_benefits", "Discounts or benefits from tennis partners"],
  ["other", "Other"],
  ["none", "None of these"],
] as const;

export type SurveyAnswers = {
  playFrequency: string;
  reasons: string[];
  reasonsOther: string;
  playedThroughTennisMate: string;
  matchBarriers: string[];
  matchBarriersOther: string;
  favouriteFeature: string;
  favouriteFeatureOther: string;
  desiredFeatures: string[];
  desiredFeaturesOther: string;
  eventInterest: string;
  premiumPrice: string;
  premiumFeatures: string[];
  premiumFeaturesOther: string;
  oneThingChange: string;
  oneThingWell: string;
};

export const EMPTY_SURVEY_ANSWERS: SurveyAnswers = {
  playFrequency: "", reasons: [], reasonsOther: "", playedThroughTennisMate: "",
  matchBarriers: [], matchBarriersOther: "", favouriteFeature: "", favouriteFeatureOther: "",
  desiredFeatures: [], desiredFeaturesOther: "", eventInterest: "", premiumPrice: "",
  premiumFeatures: [], premiumFeaturesOther: "", oneThingChange: "", oneThingWell: "",
};

export function toggleSurveyChoice(current: string[], value: string, options?: {
  exclusive?: string[];
  max?: number;
}): string[] {
  if (current.includes(value)) return current.filter((item) => item !== value);
  const exclusive = options?.exclusive ?? [];
  if (exclusive.includes(value)) return [value];
  const withoutExclusive = current.filter((item) => !exclusive.includes(item));
  if (options?.max && withoutExclusive.length >= options.max) return current;
  return [...withoutExclusive, value];
}

export function validateSurveyStep(step: number, answers: SurveyAnswers): Record<string, string> {
  const errors: Record<string, string> = {};
  if (step === 1) {
    if (!answers.playFrequency) errors.playFrequency = "Choose how often you play.";
    if (!answers.reasons.length) errors.reasons = "Choose at least one reason.";
    if (!answers.playedThroughTennisMate) errors.playedThroughTennisMate = "Choose one answer.";
    if (!answers.matchBarriers.length) errors.matchBarriers = "Choose at least one answer.";
  }
  if (step === 2) {
    if (!answers.favouriteFeature) errors.favouriteFeature = "Choose your favourite feature.";
    if (!answers.desiredFeatures.length) errors.desiredFeatures = "Choose at least one feature.";
    if (answers.desiredFeatures.length > 3) errors.desiredFeatures = "Choose up to 3 features.";
    if (!answers.eventInterest) errors.eventInterest = "Choose one answer.";
  }
  if (step === 3) {
    if (!answers.premiumPrice) errors.premiumPrice = "Choose one answer.";
    if (!answers.premiumFeatures.length) errors.premiumFeatures = "Choose at least one answer.";
    if (!answers.oneThingChange.trim()) errors.oneThingChange = "Tell us one thing you would change.";
    if (!answers.oneThingWell.trim()) errors.oneThingWell = "Tell us one thing we do well.";
  }
  return errors;
}

export function surveyResponseId(uid: string) {
  return `${PRODUCT_SURVEY_ID}_${uid}`;
}

export function canonicalSurveyUserName(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, SURVEY_USER_NAME_LIMIT) : "";
}

export function buildSurveyPayload(uid: string, userName: string, answers: SurveyAnswers, submittedAt: unknown) {
  return {
    surveyId: PRODUCT_SURVEY_ID,
    userId: uid,
    userName: canonicalSurveyUserName(userName),
    submittedAt,
    ...answers,
    reasonsOther: answers.reasonsOther.trim(),
    matchBarriersOther: answers.matchBarriersOther.trim(),
    favouriteFeatureOther: answers.favouriteFeatureOther.trim(),
    desiredFeaturesOther: answers.desiredFeaturesOther.trim(),
    premiumFeaturesOther: answers.premiumFeaturesOther.trim(),
    oneThingChange: answers.oneThingChange.trim(),
    oneThingWell: answers.oneThingWell.trim(),
  };
}

export async function submitSurveyResponse(input: {
  uid: string;
  userName: string;
  answers: SurveyAnswers;
  submittedAt: unknown;
  create: (documentId: string, payload: ReturnType<typeof buildSurveyPayload>) => Promise<void>;
}) {
  const payload = buildSurveyPayload(input.uid, input.userName, input.answers, input.submittedAt);
  await input.create(surveyResponseId(input.uid), payload);
  return payload;
}

export function surveyDismissalKey(uid: string) {
  return `tm_survey_dismissed_${PRODUCT_SURVEY_ID}_${uid}`;
}

export function parseSurveyPromptDismissal(raw: string | null, now = Date.now()): SurveyPromptDismissalState {
  if (!raw) return EMPTY_SURVEY_PROMPT_DISMISSAL;

  // Migrate the original one-flag dismissal to a first, seven-day dismissal.
  if (raw === "1") {
    return {dismissalCount: 1, hiddenUntil: now + SURVEY_PROMPT_SNOOZE_MS, permanentlyDismissed: false};
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SurveyPromptDismissalState>;
    if (parsed.permanentlyDismissed === true || parsed.dismissalCount === 2) {
      return {dismissalCount: 2, hiddenUntil: null, permanentlyDismissed: true};
    }
    if (parsed.dismissalCount === 1 && typeof parsed.hiddenUntil === "number" && Number.isFinite(parsed.hiddenUntil)) {
      return {dismissalCount: 1, hiddenUntil: parsed.hiddenUntil, permanentlyDismissed: false};
    }
  } catch {
    // Invalid client-side preference data should never break Home.
  }

  return EMPTY_SURVEY_PROMPT_DISMISSAL;
}

export function isSurveyPromptDismissed(state: SurveyPromptDismissalState, now = Date.now()) {
  return state.permanentlyDismissed || (state.hiddenUntil !== null && state.hiddenUntil > now);
}

export function nextSurveyPromptDismissal(
  current: SurveyPromptDismissalState,
  now = Date.now(),
): SurveyPromptDismissalState {
  if (current.dismissalCount >= 1) {
    return {dismissalCount: 2, hiddenUntil: null, permanentlyDismissed: true};
  }
  return {dismissalCount: 1, hiddenUntil: now + SURVEY_PROMPT_SNOOZE_MS, permanentlyDismissed: false};
}

export function getSurveyPromptVisibility(input: {
  uid: string | null;
  completionKnown: boolean;
  completed: boolean;
  dismissed: boolean;
}) {
  return Boolean(input.uid && input.completionKnown && !input.completed && !input.dismissed);
}
