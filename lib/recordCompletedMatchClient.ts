import {httpsCallable} from "firebase/functions";
import {getFunctionsClient} from "@/lib/getFunctionsClient";

export type TrustedSetResult = {A: number; B: number; tieBreakA?: number; tieBreakB?: number};
export type TrustedMatchResult = {
  outcome: "played" | "not_played";
  playedDate?: string;
  score?: string;
  sets?: TrustedSetResult[];
  winnerId?: string | null;
  location?: string | null;
  courtId?: string | null;
  matchType?: string | null;
  livePoints?: string | null;
  matchComments?: string | null;
  tiebreakMode?: boolean;
};
export type RecordCompletedMatchRequest =
  | {mode: "invite"; sourceId: string; sourceType: "match_request" | "match_invite"; result: TrustedMatchResult}
  | {mode: "chat_check_in"; conversationId: string; result: TrustedMatchResult};
export type RecordCompletedMatchResponse = {
  recorded: boolean;
  alreadyRecorded: boolean;
  historyId: string;
  outcome: "played" | "not_played";
};

export async function recordCompletedMatch(input: RecordCompletedMatchRequest): Promise<RecordCompletedMatchResponse> {
  const callable = httpsCallable<RecordCompletedMatchRequest, RecordCompletedMatchResponse>(getFunctionsClient(), "recordCompletedMatch");
  const response = await callable(input);
  return response.data;
}
