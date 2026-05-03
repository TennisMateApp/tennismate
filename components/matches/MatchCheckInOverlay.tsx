"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebaseConfig";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  orderBy,
  startAt,
  endAt,
  limit,
  addDoc,
    updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import {
  getPairId,
  upsertCompletedMatchRelationship,
  withRelationshipFields,
} from "@/lib/playerRelationships";

type MatchCheckInOverlayProps = {
  open: boolean;
  conversationId: string | null;
  currentUserId: string | null;
  onClose: () => void;
};

type Step = "question" | "details";

type CourtMatch = {
  id: string;
  name?: string | null;
  address?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  bookingUrl?: string | null;
};

type SetScore = {
  myScore: string;
  theirScore: string;
};

export default function MatchCheckInOverlay({
  open,
  conversationId,
  currentUserId,
  onClose,
}: MatchCheckInOverlayProps) {

  const [step, setStep] = useState<Step>("question");

const [otherPlayerId, setOtherPlayerId] = useState<string | null>(null);
const [otherPlayerName, setOtherPlayerName] = useState("your opponent");
const [otherPlayerPhoto, setOtherPlayerPhoto] = useState<string | null>(null);

  const [playedDate, setPlayedDate] = useState("");
  const [locationInput, setLocationInput] = useState("");
  const [courtMatches, setCourtMatches] = useState<CourtMatch[]>([]);
  const [courtMatchesLoading, setCourtMatchesLoading] = useState(false);
  const [selectedCourt, setSelectedCourt] = useState<CourtMatch | null>(null);
  const [saving, setSaving] = useState(false);

const [setScores, setSetScores] = useState<SetScore[]>([
  { myScore: "", theirScore: "" },
  { myScore: "", theirScore: "" },
]);

  useEffect(() => {
    if (!open) return;

setStep("question");
setOtherPlayerId(null);
setLocationInput("");
setCourtMatches([]);
setSelectedCourt(null);
setSetScores([
  { myScore: "", theirScore: "" },
  { myScore: "", theirScore: "" },
]);

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    setPlayedDate(`${yyyy}-${mm}-${dd}`);
  }, [open]);

  const updateSetScore = (
  index: number,
  field: "myScore" | "theirScore",
  value: string
) => {
  setSetScores((prev) =>
    prev.map((set, i) =>
      i === index ? { ...set, [field]: value } : set
    )
  );
};

const addSet = () => {
  setSetScores((prev) => {
    if (prev.length >= 3) return prev;
    return [...prev, { myScore: "", theirScore: "" }];
  });
};

const removeLastSet = () => {
  setSetScores((prev) => {
    if (prev.length <= 2) return prev;
    return prev.slice(0, -1);
  });
};

  useEffect(() => {
    if (!open || !conversationId || !currentUserId) return;

    let cancelled = false;

    (async () => {
      try {
        const convoSnap = await getDoc(doc(db, "conversations", conversationId));
        const convoData = convoSnap.exists() ? (convoSnap.data() as any) : null;

        const participants: string[] = Array.isArray(convoData?.participants)
          ? convoData.participants
          : [];

        const otherUid =
          participants.find((uid) => uid && uid !== currentUserId) || null;

 if (!otherUid) {
  if (!cancelled) {
    setOtherPlayerId(null);
    setOtherPlayerName("your opponent");
    setOtherPlayerPhoto(null);
  }
  return;
}

        const playerSnap = await getDoc(doc(db, "players", otherUid));
        const playerData = playerSnap.exists() ? (playerSnap.data() as any) : null;

if (!cancelled) {
  setOtherPlayerId(otherUid);
  setOtherPlayerName(playerData?.name || "your opponent");
  setOtherPlayerPhoto(
    playerData?.photoThumbURL ||
      playerData?.photoURL ||
      playerData?.avatar ||
      null
  );
}
      } catch (e) {
        console.error("Failed to load opponent for MatchCheckInOverlay:", e);
        if (!cancelled) {
  setOtherPlayerId(null);
  setOtherPlayerName("your opponent");
  setOtherPlayerPhoto(null);
}
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, conversationId, currentUserId]);

  const canContinueDetails = useMemo(() => {
    return playedDate.trim().length > 0;
  }, [playedDate]);

  const enteredSets = useMemo(() => {
  return setScores
    .filter(
      (set) =>
        set.myScore !== "" &&
        set.theirScore !== "" &&
        !Number.isNaN(Number(set.myScore)) &&
        !Number.isNaN(Number(set.theirScore))
    )
    .map((set) => ({
      A: Number(set.myScore),
      B: Number(set.theirScore),
    }));
}, [setScores]);

const hasScore = enteredSets.length > 0;

const scoreSummary = useMemo(() => {
  return enteredSets.map((set) => `${set.A}-${set.B}`).join(", ");
}, [enteredSets]);

const derivedWinnerId = useMemo(() => {
  if (!hasScore || !currentUserId || !otherPlayerId) return null;

  let mySetsWon = 0;
  let theirSetsWon = 0;

  for (const set of enteredSets) {
    if (set.A > set.B) mySetsWon += 1;
    if (set.B > set.A) theirSetsWon += 1;
  }

  if (mySetsWon === theirSetsWon) return null;

  return mySetsWon > theirSetsWon ? currentUserId : otherPlayerId;
}, [enteredSets, hasScore, currentUserId, otherPlayerId]);


  const searchCourtsPrefix = async (text: string) => {
    const qText = text.trim().toLowerCase();

    if (qText.length < 2) {
      setCourtMatches([]);
      return;
    }

    setCourtMatchesLoading(true);

    try {
      const courtsRef = collection(db, "courts");

      const qs = query(
        courtsRef,
        orderBy("nameLower"),
        startAt(qText),
        endAt(qText + "\uf8ff"),
        limit(8)
      );

      const snap = await getDocs(qs);

      const rows = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      })) as CourtMatch[];

      setCourtMatches(rows);
    } catch (e) {
      console.error("Court search failed:", e);
      setCourtMatches([]);
    } finally {
      setCourtMatchesLoading(false);
    }
  };

const handleSaveMatch = async () => {
  if (!currentUserId || !conversationId || !otherPlayerId) {
    alert("Missing match details. Please try again.");
    return;
  }

  if (!playedDate) {
    alert("Please enter the date played.");
    return;
  }

  setSaving(true);

  try {
    const [currentPlayerSnap, otherPlayerSnap] = await Promise.all([
      getDoc(doc(db, "players", currentUserId)),
      getDoc(doc(db, "players", otherPlayerId)),
    ]);

    const currentPlayer = currentPlayerSnap.exists()
      ? (currentPlayerSnap.data() as any)
      : {};
    const otherPlayer = otherPlayerSnap.exists()
      ? (otherPlayerSnap.data() as any)
      : {};

    let relationshipPairId: string | null = null;
    try {
      relationshipPairId = getPairId(currentUserId, otherPlayerId);
    } catch {
      relationshipPairId = null;
    }

    const locationName =
      selectedCourt?.name ||
      locationInput.trim() ||
      "";

    const locationPayload = selectedCourt
      ? {
          id: selectedCourt.id || null,
          name: selectedCourt.name || "",
          address: selectedCourt.address || "",
          suburb: selectedCourt.suburb || "",
          state: selectedCourt.state || "",
          postcode: selectedCourt.postcode || "",
          bookingUrl: selectedCourt.bookingUrl || "",
        }
      : locationInput.trim()
      ? {
          name: locationInput.trim(),
        }
      : null;

    const historyPayload: Record<string, any> = {
      completed: true,
      completedAt: serverTimestamp(),
      completedFrom: "chat_check_in",
      outcome: "played",
      fromUserId: currentUserId,
      toUserId: otherPlayerId,
      fromName: currentPlayer?.name || "Player",
      toName: otherPlayer?.name || "Player",
      fromPhotoURL:
        currentPlayer?.photoThumbURL ||
        currentPlayer?.photoURL ||
        currentPlayer?.avatar ||
        "",
      toPhotoURL:
        otherPlayer?.photoThumbURL ||
        otherPlayer?.photoURL ||
        otherPlayer?.avatar ||
        "",
      inviteId: "",
      matchRequestId: "",
      players: [currentUserId, otherPlayerId],
      status: "completed",
      updatedAt: serverTimestamp(),
      livePoints: "",
      matchComments: "",
      matchType: null,
      tiebreakMode: false,
      location: locationName,
      court: locationPayload,
      conversationId,
      playedDate,
    };

    if (hasScore) {
      historyPayload.score = scoreSummary;
      historyPayload.sets = enteredSets;
      historyPayload.winnerId = derivedWinnerId || null;
    } else {
      historyPayload.score = "";
      historyPayload.sets = [];
      historyPayload.winnerId = null;
    }

    const historyDoc = relationshipPairId
      ? withRelationshipFields(currentUserId, otherPlayerId, historyPayload)
      : historyPayload;
    const historyRef = await addDoc(collection(db, "match_history"), historyDoc);

    if (relationshipPairId) {
      try {
        await upsertCompletedMatchRelationship(
          db,
          currentUserId,
          otherPlayerId,
          historyRef.id,
          currentUserId,
          "match_history",
          { latestHistoryId: historyRef.id }
        );
      } catch (error) {
        console.error("[player_relationships:stage3] match_history relationship upsert failed", {
          historyId: historyRef.id,
          pairId: relationshipPairId,
          players: [currentUserId, otherPlayerId],
          error,
        });
      }
    }

    await updateDoc(doc(db, "conversations", String(conversationId)), {
  matchCheckInResolved: true,
  updatedAt: serverTimestamp(),
});

    if (hasScore) {
      const scorePayload: Record<string, any> = {
        players: [currentUserId, otherPlayerId],
        sets: enteredSets,
        updatedAt: serverTimestamp(),
      };
      const scoreDocRef = await addDoc(
        collection(db, "match_scores"),
        relationshipPairId
          ? withRelationshipFields(currentUserId, otherPlayerId, scorePayload)
          : scorePayload
      );

      if (relationshipPairId) {
        try {
          await upsertCompletedMatchRelationship(
            db,
            currentUserId,
            otherPlayerId,
            scoreDocRef.id,
            currentUserId,
            "match_scores",
            {
              latestHistoryId: historyRef.id,
              latestScoreId: scoreDocRef.id,
            }
          );
        } catch (error) {
          console.error("[player_relationships:stage3] match_scores relationship upsert failed", {
            scoreId: scoreDocRef.id,
            historyId: historyRef.id,
            pairId: relationshipPairId,
            players: [currentUserId, otherPlayerId],
            error,
          });
        }
      }

      const completedMatchPayload: Record<string, any> = {
        fromUserId: currentUserId,
        toUserId: otherPlayerId,
        matchId: scoreDocRef.id,
        winnerId: derivedWinnerId || null,
        timestamp: serverTimestamp(),
      };
      const completedMatchRef = await addDoc(
        collection(db, "completed_matches"),
        relationshipPairId
          ? withRelationshipFields(currentUserId, otherPlayerId, completedMatchPayload)
          : completedMatchPayload
      );

      if (relationshipPairId) {
        try {
          await upsertCompletedMatchRelationship(
            db,
            currentUserId,
            otherPlayerId,
            completedMatchRef.id,
            currentUserId,
            "completed_matches",
            {
              latestHistoryId: historyRef.id,
              latestScoreId: scoreDocRef.id,
              latestCompletedMatchId: completedMatchRef.id,
            }
          );
        } catch (error) {
          console.error("[player_relationships:stage3] completed_matches relationship upsert failed", {
            completedMatchId: completedMatchRef.id,
            scoreId: scoreDocRef.id,
            historyId: historyRef.id,
            pairId: relationshipPairId,
            players: [currentUserId, otherPlayerId],
            error,
          });
        }
      }
    }

    onClose();
  } catch (error) {
    console.error("Failed to save checked-in match:", error);
    alert("Could not save match. Please try again.");
  } finally {
    setSaving(false);
  }
};

const handleSaveNoMatch = async () => {
  if (!currentUserId || !conversationId || !otherPlayerId) {
    alert("Missing match details. Please try again.");
    return;
  }

  setSaving(true);

  try {
    const [currentPlayerSnap, otherPlayerSnap] = await Promise.all([
      getDoc(doc(db, "players", currentUserId)),
      getDoc(doc(db, "players", otherPlayerId)),
    ]);

    const currentPlayer = currentPlayerSnap.exists()
      ? (currentPlayerSnap.data() as any)
      : {};
    const otherPlayer = otherPlayerSnap.exists()
      ? (otherPlayerSnap.data() as any)
      : {};

    let relationshipPairId: string | null = null;
    try {
      relationshipPairId = getPairId(currentUserId, otherPlayerId);
    } catch {
      relationshipPairId = null;
    }

    const historyPayload: Record<string, any> = {
      completed: false,
      completedAt: null,
      completedFrom: "chat_check_in",
      outcome: "not_played",
      fromUserId: currentUserId,
      toUserId: otherPlayerId,
      fromName: currentPlayer?.name || "Player",
      toName: otherPlayer?.name || "Player",
      fromPhotoURL:
        currentPlayer?.photoThumbURL ||
        currentPlayer?.photoURL ||
        currentPlayer?.avatar ||
        "",
      toPhotoURL:
        otherPlayer?.photoThumbURL ||
        otherPlayer?.photoURL ||
        otherPlayer?.avatar ||
        "",
      inviteId: "",
      matchRequestId: "",
      players: [currentUserId, otherPlayerId],
      status: "not_played",
      updatedAt: serverTimestamp(),
      livePoints: "",
      matchComments: "",
      matchType: null,
      tiebreakMode: false,
      location: "",
      court: null,
      conversationId,
      playedDate: "",
      score: "",
      sets: [],
      winnerId: null,
    };

    const historyDoc = relationshipPairId
      ? withRelationshipFields(currentUserId, otherPlayerId, historyPayload)
      : historyPayload;
    const historyRef = await addDoc(collection(db, "match_history"), historyDoc);

    if (relationshipPairId) {
      try {
        await upsertCompletedMatchRelationship(
          db,
          currentUserId,
          otherPlayerId,
          historyRef.id,
          currentUserId,
          "match_history",
          { latestHistoryId: historyRef.id }
        );
      } catch (error) {
        console.error("[player_relationships:stage3] not-played match_history relationship upsert failed", {
          historyId: historyRef.id,
          pairId: relationshipPairId,
          players: [currentUserId, otherPlayerId],
          error,
        });
      }
    }

    await updateDoc(doc(db, "conversations", String(conversationId)), {
  matchCheckInResolved: true,
  updatedAt: serverTimestamp(),
});

    onClose();
  } catch (error) {
    console.error("Failed to save not-played check-in:", error);
    alert("Could not save response. Please try again.");
  } finally {
    setSaving(false);
  }
};

  useEffect(() => {
    if (step !== "details") return;
    if (selectedCourt) return;

    const timer = setTimeout(() => {
      void searchCourtsPrefix(locationInput);
    }, 250);

    return () => clearTimeout(timer);
  }, [locationInput, step, selectedCourt]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-[#39FF14]/20 text-sm font-black text-[#0B3D2E]">
              🎾
            </div>
            <div className="text-[16px] font-extrabold text-[#0B3D2E]">
              Match check-in
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full hover:bg-black/5"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[85vh] overflow-y-auto px-5 py-6">
          {step === "question" && (
            <>
              <div className="text-[20px] font-black text-slate-900">
                Did you and {otherPlayerName} play your match yet?
              </div>

              <div className="mt-2 text-sm text-slate-600">
                Let TennisMate know if your game happened.
              </div>

              <div
                className="mt-4 rounded-2xl border p-3"
                style={{
                  borderColor: "rgba(15,23,42,0.10)",
                  background: "rgba(11,61,46,0.03)",
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-gray-100">
                    {otherPlayerPhoto ? (
                      <img
                        src={otherPlayerPhoto}
                        alt={otherPlayerName}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-sm font-extrabold text-gray-500">
                        {(otherPlayerName || "P").trim().charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                      You matched with
                    </div>
                    <div className="truncate text-[16px] font-extrabold text-gray-900">
                      {otherPlayerName}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-3">
               <button
  type="button"
  onClick={() => {
    setStep("details");
  }}
                  className="w-full rounded-2xl px-4 py-3 font-extrabold"
                  style={{
                    background: "#39FF14",
                    color: "#0B3D2E",
                    boxShadow: "0 8px 18px rgba(57,255,20,0.22)",
                  }}
                >
                  Yes, we played
                </button>

                <button
  type="button"
  onClick={handleSaveNoMatch}
  disabled={saving}
  className="w-full rounded-2xl border px-4 py-3 font-extrabold text-slate-900 disabled:opacity-50"
  style={{ borderColor: "rgba(15,23,42,0.12)" }}
>
  {saving ? "Saving..." : "No, it didn’t happen"}
</button>
              </div>
            </>
          )}

          {step === "details" && (
            <>
              <div className="text-[20px] font-black text-slate-900">
                Add your match details
              </div>

              <div className="mt-2 text-sm text-slate-600">
                Enter date of game. Location and score are optional.
              </div>

              <div
                className="mt-4 rounded-2xl border p-3"
                style={{
                  borderColor: "rgba(15,23,42,0.10)",
                  background: "rgba(11,61,46,0.03)",
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-gray-100">
                    {otherPlayerPhoto ? (
                      <img
                        src={otherPlayerPhoto}
                        alt={otherPlayerName}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-sm font-extrabold text-gray-500">
                        {(otherPlayerName || "P").trim().charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                      Match with
                    </div>
                    <div className="truncate text-[16px] font-extrabold text-gray-900">
                      {otherPlayerName}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-4">
                <div>
                  <label className="mb-1 block text-[12px] font-bold text-gray-700">
                    Date played
                  </label>
                  <input
                    type="date"
                    value={playedDate}
                    onChange={(e) => setPlayedDate(e.target.value)}
                    className="w-full rounded-2xl border px-4 py-3 text-[14px] outline-none"
                    style={{ borderColor: "rgba(15,23,42,0.12)" }}
                  />
                </div>

                <div className="relative">
                  <label className="mb-1 block text-[12px] font-bold text-gray-700">
                    Location <span className="font-normal">(optional)</span>
                  </label>

                  <input
                    type="text"
                    value={selectedCourt ? selectedCourt.name || locationInput : locationInput}
                    onChange={(e) => {
                      setSelectedCourt(null);
                      setLocationInput(e.target.value);
                    }}
                    placeholder="Start typing a court name..."
                    className="w-full rounded-2xl border px-4 py-3 text-[14px] outline-none"
                    style={{ borderColor: "rgba(15,23,42,0.12)" }}
                  />

                  {selectedCourt && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCourt(null);
                        setLocationInput("");
                        setCourtMatches([]);
                      }}
                      className="mt-2 text-[12px] font-bold underline"
                      style={{ color: "#0B3D2E" }}
                    >
                      Clear selected court
                    </button>
                  )}

                  {!selectedCourt && (courtMatchesLoading || courtMatches.length > 0) && (
                    <div
                      className="absolute left-0 right-0 top-full z-20 mt-2 max-h-60 overflow-y-auto rounded-2xl border bg-white shadow-lg"
                      style={{ borderColor: "rgba(15,23,42,0.12)" }}
                    >
                      {courtMatchesLoading && (
                        <div className="px-3 py-2 text-[12px] text-gray-600">
                          Searching courts…
                        </div>
                      )}

                      {!courtMatchesLoading &&
                        courtMatches.map((court) => (
                          <button
                            key={court.id}
                            type="button"
                            onClick={() => {
                              setSelectedCourt(court);
                              setLocationInput(court.name || "");
                              setCourtMatches([]);
                            }}
                            className="w-full px-3 py-2 text-left hover:bg-black/5"
                          >
                            <div className="text-[13px] font-bold text-gray-900">
                              {court.name || "Court"}
                            </div>
                            <div className="text-[12px] text-gray-600">
                              {[court.suburb, court.state, court.postcode]
                                .filter(Boolean)
                                .join(" ")}
                            </div>
                          </button>
                        ))}
                    </div>
                  )}

                  {!selectedCourt &&
                    !courtMatchesLoading &&
                    locationInput.trim().length >= 2 &&
                    courtMatches.length === 0 && (
                      <div className="mt-2 text-[12px] text-gray-500">
                        No court found. You can still use the location you entered.
                      </div>
                    )}
                </div>

           <div>
  <label className="mb-1 block text-[12px] font-bold text-gray-700">
    Score by set <span className="font-normal">(optional)</span>
  </label>

  <div className="grid gap-3">
    {setScores.map((set, index) => (
      <div
        key={index}
        className="rounded-2xl border p-3"
        style={{ borderColor: "rgba(15,23,42,0.12)" }}
      >
        <div className="mb-2 text-[12px] font-bold text-gray-700">
          Set {index + 1}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <input
            type="number"
            inputMode="numeric"
            min="0"
            value={set.myScore}
            onChange={(e) =>
              updateSetScore(index, "myScore", e.target.value)
            }
            placeholder="Your games"
            className="w-full rounded-2xl border px-4 py-3 text-[14px] outline-none"
            style={{ borderColor: "rgba(15,23,42,0.12)" }}
          />

          <input
            type="number"
            inputMode="numeric"
            min="0"
            value={set.theirScore}
            onChange={(e) =>
              updateSetScore(index, "theirScore", e.target.value)
            }
            placeholder={`${otherPlayerName}'s games`}
            className="w-full rounded-2xl border px-4 py-3 text-[14px] outline-none"
            style={{ borderColor: "rgba(15,23,42,0.12)" }}
          />
        </div>
      </div>
    ))}

    <div className="flex gap-3">
      {setScores.length < 3 && (
        <button
          type="button"
          onClick={addSet}
          className="rounded-2xl border px-4 py-2 text-[13px] font-extrabold"
          style={{ borderColor: "rgba(15,23,42,0.12)" }}
        >
          + Add third set
        </button>
      )}

      {setScores.length > 2 && (
        <button
          type="button"
          onClick={removeLastSet}
          className="rounded-2xl border px-4 py-2 text-[13px] font-extrabold"
          style={{ borderColor: "rgba(15,23,42,0.12)" }}
        >
          Remove third set
        </button>
      )}
    </div>
  </div>
</div>
              </div>

            <div className="mt-6 grid gap-3">
  <button
    type="button"
    onClick={handleSaveMatch}
    disabled={!canContinueDetails || saving}
    className="w-full rounded-2xl px-4 py-3 font-extrabold disabled:opacity-50"
    style={{
      background: "#39FF14",
      color: "#0B3D2E",
      boxShadow: "0 8px 18px rgba(57,255,20,0.22)",
    }}
  >
    {saving ? "Saving..." : "Save match"}
  </button>

  <button
    type="button"
    onClick={() => setStep("question")}
    className="w-full rounded-2xl border px-4 py-3 font-extrabold text-slate-900"
    style={{ borderColor: "rgba(15,23,42,0.12)" }}
  >
    Back
  </button>
</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
