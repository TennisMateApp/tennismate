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
  addDoc,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebaseConfig";
import { MapPin, Search, ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";

// ✅ ADD: desktop component
import { TMDesktopCoachDirectory } from "@/components/coachdirectory/TMDesktopCoachDirectory";

import TMDesktopSidebar from "@/components/desktop_layout/TMDesktopSidebar";



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
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function isVicPostcode(postcode: unknown): boolean {
  if (typeof postcode !== "string") return false;
  const p = postcode.trim();
  return p.length > 0 && p.startsWith("3");
}

function formatCoachingExperience(raw: unknown): string {
  if (raw == null) return "";
  const s = String(raw).trim();
  if (!s) return "";

  const n = Number(s);
  if (!Number.isNaN(n) && Number.isFinite(n)) {
    const isInt = Number.isInteger(n);
    const display = isInt ? String(n) : s;
    const label = n === 1 ? "year coaching" : "years coaching";
    return `${display} ${label}`;
  }

  const lower = s.toLowerCase();
  if (lower.includes("year")) return s;

  return `${s} years coaching`;
}

// ✅ ADD: desktop detection hook
function useIsDesktop(breakpointPx = 1024) {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${breakpointPx}px)`);

    const apply = () => setIsDesktop(mq.matches);
    apply();

    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    } else {
      // Safari fallback
      // @ts-ignore
      mq.addListener(apply);
      // @ts-ignore
      return () => mq.removeListener(apply);
    }
  }, [breakpointPx]);

  return isDesktop;
}

async function recordCoachProfileClickUnique(coachId: string) {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  const dayKey = dayKeyLocalAU();

  const playerSnap = await getDoc(doc(db, "players", uid));
  const player = (playerSnap.data() as any) || {};
  const viewerName = (player.name ?? player.displayName ?? "").toString();
  const viewerPostcode = (player.postcode ?? "").toString();

  const coachRef = doc(db, "coaches", coachId);
  const viewerRef = doc(db, "coaches", coachId, "viewers", uid);

  const uniqueDayId = `${uid}_${dayKey}`;
  const uniqueClickRef = doc(db, "coaches", coachId, "uniqueClicks", uniqueDayId);

  await runTransaction(db, async (tx) => {
    // ✅ READS FIRST
    const viewerSnap = await tx.get(viewerRef);
    const uniqueSnap = await tx.get(uniqueClickRef);

    // ✅ WRITES AFTER READS
    tx.set(coachRef, { viewCount: increment(1) }, { merge: true });

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

function normalizePhone(raw: unknown): string {
  if (raw == null) return "";
  return String(raw).replace(/[^\d+]/g, "").trim();
}

async function recordCoachContactEvent(args: {
  action: "call" | "text";
  coachId: string;
  phoneProvided: boolean;
}) {
  const viewerUid = auth.currentUser?.uid || null;

  await addDoc(collection(db, "coach_contact_events"), {
    action: args.action,
    coachId: args.coachId,
    viewerUid,
    phoneProvided: args.phoneProvided,
    createdAt: serverTimestamp(),
    source: "coach_directory",
  });
}

async function handleContactCoach(coachId: string) {
  const coachSnap = await getDoc(doc(db, "coaches", coachId));
  const coach = (coachSnap.data() as any) || {};

  // ⚠️ keep the right one and delete the rest once confirmed
  const phoneRaw =
    coach.mobileNumber ||
    coach.mobile ||
    coach.phone ||
    coach.phoneNumber ||
    "";

  const phone = normalizePhone(phoneRaw);
  const hasPhone = !!phone;

  await recordCoachContactEvent({
    action: "call",
    coachId,
    phoneProvided: hasPhone,
  });

  if (hasPhone) {
    window.location.href = `tel:${phone}`;
  } else {
    alert("This coach hasn’t provided a mobile number yet.");
  }
}

export default function CoachesListPage() {
  const router = useRouter();
  const isDesktop = useIsDesktop(1024);

  const [loading, setLoading] = useState(true);
  const [coaches, setCoaches] = useState<CoachListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [canSeeCoaches, setCanSeeCoaches] = useState<boolean>(true);
  const [search, setSearch] = useState("");

  // ✅ MUST be here (top-level hook)
  const [sidebarPlayer, setSidebarPlayer] = useState<{
    name: string;
    skillLevel: string;
    avatarUrl: string | null;
  }>({
    name: "Player",
    skillLevel: "",
    avatarUrl: null,
  });

  const coachesCol = useMemo(() => collection(db, "coaches"), []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);

      try {
        const uid = auth.currentUser?.uid;

        if (!uid) {
          if (!cancelled) {
            setCanSeeCoaches(false);
            setCoaches([]);
          }
          return;
        }

        const playerSnap = await getDoc(doc(db, "players", uid));
        const p = (playerSnap.data() as any) || {};
        const viewerPostcode = p?.postcode;

        // ✅ sidebar info
        if (!cancelled) {
          setSidebarPlayer({
            name: (p.name ?? p.displayName ?? "Player").toString(),
            skillLevel: (p.skillLevel ?? p.skillBandLabel ?? "").toString(),
            avatarUrl: (p.photoThumbURL ?? p.photoURL ?? p.avatar ?? null) as string | null,
          });
        }

        const allowed = isVicPostcode(viewerPostcode);

        if (!allowed) {
          if (!cancelled) {
            setCanSeeCoaches(false);
            setCoaches([]);
          }
          return;
        }

        if (!cancelled) setCanSeeCoaches(true);

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
            coachingSkillLevels: Array.isArray(data?.coachingSkillLevels) ? data.coachingSkillLevels : [],
            contactFirstForRate: !!data?.contactFirstForRate,
          };
        });

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


  const visibleCoaches = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return coaches;

    return coaches.filter((c) => {
      const name = (c.name || "").toLowerCase();
      const addr = (c.courtAddress || "").toLowerCase();
      const skills = (c.coachingSkillLevels || []).join(" ").toLowerCase();
      const exp = (c.coachingExperience || "").toLowerCase();
      return (
        name.includes(s) ||
        addr.includes(s) ||
        skills.includes(s) ||
        exp.includes(s)
      );
    });
  }, [coaches, search]);

 if (!loading && !error && canSeeCoaches && isDesktop) {
  return (
    <div className="min-h-screen" style={{ background: "#F7FAF8" }}>
      <div className="w-full px-8 2xl:px-12 py-8">
        <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
          {/* Sidebar */}
          <TMDesktopSidebar
            active="Search"  // or "Home" if your sidebar doesn’t support Coaches yet
            player={{
              name: sidebarPlayer.name,
              skillLevel: sidebarPlayer.skillLevel,
              photoURL: sidebarPlayer.avatarUrl,
              photoThumbURL: sidebarPlayer.avatarUrl,
              avatar: sidebarPlayer.avatarUrl,
            }}
          />

          {/* Main */}
          <main className="min-w-0">
            <div className="mx-auto max-w-6xl">
            <TMDesktopCoachDirectory
  loading={loading}
  coaches={visibleCoaches}
  totalCoaches={coaches.length} // or null if you don’t want it
  search={search}
  setSearch={setSearch}
  onViewProfile={(coachId) => recordCoachProfileClickUnique(coachId)}
  onContactCoach={(coachId) => handleContactCoach(coachId)}
/>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}


  // ----- Existing Loading / Error / Mobile UI below -----

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F7FAF8]">
        <div className="mx-auto max-w-4xl px-4 pb-24">
          <div className="sticky top-0 z-10 bg-[#F7FAF8] pt-4 pb-3">
            <div className="flex items-center justify-center relative">
              <button
                type="button"
                onClick={() => router.back()}
                className="absolute left-0 inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-black/5"
                aria-label="Back"
              >
                <ChevronLeft size={20} />
              </button>
              <div className="text-base font-semibold">Coach Directory</div>
            </div>
            <div className="mt-3">
              <div className="flex items-center gap-2 rounded-2xl border bg-white px-3 py-2">
                <Search size={18} className="opacity-60" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Find a coach near you…"
                  className="w-full bg-transparent text-sm outline-none"
                />
              </div>
            </div>
          </div>

          <div className="mt-3 text-sm opacity-70">Loading coaches…</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#F7FAF8]">
        <div className="mx-auto max-w-4xl px-4 pb-24">
          <div className="sticky top-0 z-10 bg-[#F7FAF8] pt-4 pb-3">
            <div className="flex items-center justify-center relative">
              <button
                type="button"
                onClick={() => router.back()}
                className="absolute left-0 inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-black/5"
                aria-label="Back"
              >
                <ChevronLeft size={20} />
              </button>
              <div className="text-base font-semibold">Coach Directory</div>
            </div>
          </div>

          <div className="mt-3 rounded-2xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7FAF8]">
      <div className="mx-auto max-w-4xl px-4 pb-24">
        <div className="sticky top-0 z-10 bg-[#F7FAF8] pt-4 pb-3">
          <div className="flex items-center justify-center relative">
            <button
              type="button"
              onClick={() => router.back()}
              className="absolute left-0 inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-black/5"
              aria-label="Back"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="text-base font-semibold">Coach Directory</div>
          </div>

          <div className="mt-3">
            <div className="flex items-center gap-2 rounded-2xl border bg-white px-3 py-2 shadow-sm">
              <Search size={18} className="opacity-60" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find a coach near you…"
                className="w-full bg-transparent text-sm outline-none"
              />
            </div>
          </div>
        </div>

        {!canSeeCoaches ? (
          <div className="mt-6 rounded-2xl border bg-white p-4 shadow-sm">
            <div className="text-sm font-medium text-gray-800">
              Coaching is currently available in Victoria only.
            </div>
            <div className="mt-1 text-sm text-gray-600">
              Update your postcode to a Victorian postcode (starting with 3) to view coaches.
            </div>
          </div>
        ) : visibleCoaches.length === 0 ? (
          <div className="mt-6 rounded-2xl border bg-white p-4 shadow-sm">
            <div className="text-sm text-gray-700">
              {coaches.length === 0
                ? "No coaches published yet."
                : "No coaches match your search."}
            </div>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3">
            {visibleCoaches.map((c) => {
              const exp = String(c.coachingExperience || "").trim()
                ? formatCoachingExperience(c.coachingExperience)
                : "";

              return (
                <div
                  key={c.id}
                  className="overflow-hidden rounded-2xl border bg-white shadow-sm"
                >
                  <div className="p-4">
                    <div className="flex gap-4">
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full border bg-white">
                        {c.avatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={c.avatar}
                            alt={c.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] opacity-60">
                            No photo
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-[15px] font-semibold text-gray-900">
                            {c.name}
                          </div>

                          {c.contactFirstForRate && (
                            <span className="rounded-full bg-black/5 px-2.5 py-1 text-[11px] text-gray-700">
                              Contact for rates
                            </span>
                          )}
                        </div>

                        {exp && (
                          <div className="mt-1 text-sm text-gray-700">{exp}</div>
                        )}

                        {c.coachingSkillLevels?.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {c.coachingSkillLevels.slice(0, 3).map((lvl) => (
                              <span
                                key={lvl}
                                className="rounded-full bg-[#EAF7F0] px-2.5 py-1 text-[11px] text-gray-800"
                              >
                                {lvl}
                              </span>
                            ))}
                            {c.coachingSkillLevels.length > 3 && (
                              <span className="rounded-full bg-black/5 px-2.5 py-1 text-[11px] text-gray-700">
                                +{c.coachingSkillLevels.length - 3} more
                              </span>
                            )}
                          </div>
                        )}

                        {c.courtAddress?.trim() && (
                          <div className="mt-2 flex items-center gap-2 text-sm text-gray-600">
                            <MapPin size={16} className="shrink-0" />
                            <span className="line-clamp-1">{c.courtAddress}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 border-t">
                    <Link
                      href={`/coaches/${c.id}`}
                      onClick={() => recordCoachProfileClickUnique(c.id)}
                      className="flex items-center justify-center px-3 py-3 text-sm font-semibold text-gray-900 hover:bg-black/5"
                    >
                      View Profile
                    </Link>

                    <button
                      type="button"
                      onClick={() => handleContactCoach(c.id)}
                      className="flex items-center justify-center bg-[#39FF14] px-3 py-3 text-sm font-semibold text-[#0B3D2E] hover:brightness-95"
                    >
                      Contact Coach
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
