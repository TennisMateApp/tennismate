"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  runTransaction,
  serverTimestamp,
  increment,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebaseConfig";
import { MapPin } from "lucide-react";

type CoachListItem = {
  id: string;
  name: string;
  avatar: string | null;
  coachingExperience: string;
  courtAddress: string;
  coachingSkillLevels: string[];
  contactFirstForRate: boolean;
};

function dayKeyLocalAU(): string {
  // Melbourne time: use local device time (good enough for MVP)
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`; // e.g. 20260114
}

function isVicPostcode(postcode: unknown): boolean {
  if (typeof postcode !== "string") return false;
  const p = postcode.trim();
  return p.length > 0 && p.startsWith("3");
}

// Converts "5" -> "5 years coaching", "1" -> "1 year coaching"
// Leaves non-numeric strings alone, but still appends "years coaching" when reasonable.
function formatCoachingExperience(raw: unknown): string {
  if (raw == null) return "";
  const s = String(raw).trim();
  if (!s) return "";

  // Try parse number
  const n = Number(s);
  if (!Number.isNaN(n) && Number.isFinite(n)) {
    // show as integer if it is one, else show as-is
    const isInt = Number.isInteger(n);
    const display = isInt ? String(n) : s;
    const label = n === 1 ? "year coaching" : "years coaching";
    return `${display} ${label}`;
  }

  // If they typed "5 years" already, keep it.
  // Otherwise add "years coaching" for clarity.
  const lower = s.toLowerCase();
  if (lower.includes("year")) return s;

  return `${s} years coaching`;
}

async function recordCoachProfileClickUnique(coachId: string) {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  const dayKey = dayKeyLocalAU();

  // Optional snapshot fields to help you analyse later
  const playerSnap = await getDoc(doc(db, "players", uid));
  const player = (playerSnap.data() as any) || {};
  const viewerName = (player.name ?? player.displayName ?? "").toString();
  const viewerPostcode = (player.postcode ?? "").toString();

  const coachRef = doc(db, "coaches", coachId);

  // Lifetime unique viewer doc
  const viewerRef = doc(db, "coaches", coachId, "viewers", uid);

  // Daily unique click doc (one per user per day)
  const uniqueDayId = `${uid}_${dayKey}`;
  const uniqueClickRef = doc(db, "coaches", coachId, "uniqueClicks", uniqueDayId);

  await runTransaction(db, async (tx) => {
    // Always increment total opens
    tx.set(coachRef, { viewCount: increment(1) }, { merge: true });

    // Lifetime unique viewers (increment only if first time ever)
    const viewerSnap = await tx.get(viewerRef);
    if (!viewerSnap.exists()) {
      tx.set(viewerRef, {
        viewerUid: uid,
        viewerName: viewerName || null,
        viewerPostcode: viewerPostcode || null,
        firstViewedAt: serverTimestamp(),
        lastViewedAt: serverTimestamp(),
      });
      tx.set(coachRef, { uniqueViewerCount: increment(1) }, { merge: true });
    } else {
      tx.update(viewerRef, {
        lastViewedAt: serverTimestamp(),
        viewerName: viewerName || null,
        viewerPostcode: viewerPostcode || null,
      });
    }

    // Daily unique clicks (increment only if first click today)
    const uniqueSnap = await tx.get(uniqueClickRef);
    if (!uniqueSnap.exists()) {
      tx.set(uniqueClickRef, {
        viewerUid: uid,
        dayKey,
        createdAt: serverTimestamp(),
      });
      tx.set(coachRef, { uniqueClickCount: increment(1) }, { merge: true });
    }
  });
}


export default function CoachesListPage() {
  const [loading, setLoading] = useState(true);
  const [coaches, setCoaches] = useState<CoachListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // NEW: visibility gate for VIC-only
  const [canSeeCoaches, setCanSeeCoaches] = useState<boolean>(true);

  const coachesCol = useMemo(() => collection(db, "coaches"), []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);

      try {
        const uid = auth.currentUser?.uid;

        // If not signed in, treat as not eligible (you can change this later if desired)
        if (!uid) {
          if (!cancelled) {
            setCanSeeCoaches(false);
            setCoaches([]);
          }
          return;
        }

        // 1) Read viewer postcode from players/{uid}
        const playerSnap = await getDoc(doc(db, "players", uid));
        const viewerPostcode = (playerSnap.data() as any)?.postcode;

        // 2) Simple VIC-only rule
        const allowed = isVicPostcode(viewerPostcode);

        if (!allowed) {
          if (!cancelled) {
            setCanSeeCoaches(false);
            setCoaches([]);
          }
          return;
        }

        if (!cancelled) setCanSeeCoaches(true);

        // 3) Allowed → load coaches
        const q = query(coachesCol, orderBy("name"));
        const snap = await getDocs(q);

        const rows: CoachListItem[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            name: data?.name ?? "",
            avatar: data?.avatar ?? null,
            coachingExperience: data?.coachingExperience ?? "",
            courtAddress: data?.courtAddress ?? "",
            coachingSkillLevels: Array.isArray(data?.coachingSkillLevels)
              ? data.coachingSkillLevels
              : [],
            contactFirstForRate: !!data?.contactFirstForRate,
          };
        });

        // Optional: hide empty stub coaches with no name yet
        const filtered = rows.filter((c) => c.name.trim().length > 0);

        if (!cancelled) setCoaches(filtered);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load coaches");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [coachesCol]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-4">
        <h1 className="text-xl font-semibold">Find a Coach</h1>
        <div className="mt-3 text-sm opacity-70">Loading coaches…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-4">
        <h1 className="text-xl font-semibold">Find a Coach</h1>
        <div className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 pb-24">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Find a Coach</h1>
          <p className="mt-1 text-sm opacity-70">
            Browse local coaches and contact them directly.
          </p>
        </div>
      </div>

      {/* NEW: VIC-only message */}
      {!canSeeCoaches ? (
        <div className="mt-6 rounded-2xl border p-4 bg-white">
          <div className="text-sm text-gray-800 font-medium">
            Coaching is currently available in Victoria only.
          </div>
          <div className="mt-1 text-sm text-gray-600">
            Update your postcode to a Victorian postcode (starting with 3) to view coaches.
          </div>
        </div>
      ) : coaches.length === 0 ? (
        <div className="mt-6 rounded-2xl border p-4">
          <div className="text-sm opacity-80">No coaches published yet.</div>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-3">
          {coaches.map((c) => (
           <Link
  key={c.id}
  href={`/coaches/${c.id}`}
  onClick={() => recordCoachProfileClickUnique(c.id)}
  className="rounded-2xl border p-4 hover:bg-gray-50 transition"
>
              <div className="flex gap-4">
                <div className="h-14 w-14 rounded-full overflow-hidden border bg-white shrink-0">
                  {c.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.avatar} alt={c.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-[10px] opacity-60">
                      No photo
                    </div>
                  )}
                </div>

                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-semibold">{c.name}</div>

                    {c.contactFirstForRate && (
                      <span className="rounded-full border px-2.5 py-1 text-[11px]">
                        Contact for rates
                      </span>
                    )}
                  </div>

                  {/* UPDATED: coaching experience label */}
                  {String(c.coachingExperience || "").trim() && (
                    <div className="mt-1 text-sm opacity-80">
                      {formatCoachingExperience(c.coachingExperience)}
                    </div>
                  )}

                  {c.courtAddress?.trim() && (
                    <div className="mt-2 flex items-center gap-2 text-sm opacity-75">
                      <MapPin size={16} />
                      <span className="line-clamp-1">{c.courtAddress}</span>
                    </div>
                  )}

                  {c.coachingSkillLevels?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {c.coachingSkillLevels.slice(0, 4).map((lvl) => (
                        <span key={lvl} className="rounded-full border px-2.5 py-1 text-[11px]">
                          {lvl}
                        </span>
                      ))}
                      {c.coachingSkillLevels.length > 4 && (
                        <span className="rounded-full border px-2.5 py-1 text-[11px] opacity-70">
                          +{c.coachingSkillLevels.length - 4} more
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
