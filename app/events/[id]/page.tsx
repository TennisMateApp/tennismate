"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  doc,
  onSnapshot,
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
  getDoc,
  runTransaction,
  arrayUnion,
  arrayRemove,
  setDoc,
  deleteDoc,
  updateDoc,   
} from "firebase/firestore";
import { auth, db } from "@/lib/firebaseConfig";
import {
  CalendarDays,
  MapPin,
  Clock,
  ShieldCheck,
  Users as UsersIcon,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ArrowLeft,
} from "lucide-react";
import { ensureEventConversation } from "@/lib/conversations";



/* ----------------------------- Types / helpers ---------------------------- */

type EventDoc = {
  title?: string;
  type?: "singles" | "doubles" | "social";
  location?: string;
  start?: string; // ISO
  end?: string;   // ISO
  durationMins?: number;
  minSkill?: number | null;
  spotsTotal?: number;
  spotsFilled?: number;
  status?: "open" | "full" | "cancelled" | "completed";
  hostId?: string;
  participants?: string[];
  description?: string | null;
};

type UserProfile = {
  name?: string;
  photoURL?: string;
  skillLevel?: number;
  // alternates we normalize:
  skill?: number;
  rating?: number;
  ntrp?: number;
};

type JoinRequest = {
  id: string;
  userId: string;
  status: "pending" | "accepted" | "declined" | "left";
  profile?: UserProfile;
};

function getSkill(profile?: Partial<UserProfile> | null): number | null {
  if (!profile) return null;
  return (
    (profile.skillLevel as number | undefined) ??
    (profile.skill as number | undefined) ??
    (profile.rating as number | undefined) ??
    (profile.ntrp as number | undefined) ??
    null
  );
}

/** Upserts a personal calendar entry for current user; best-effort for others */
async function upsertCalendarEntriesForEvent(updated: EventDoc, eventId: string) {
  const allIds = Array.from(
    new Set([updated.hostId, ...(updated.participants ?? [])].filter(Boolean) as string[])
  );
  const me = auth.currentUser?.uid || null;

  // Current user (should pass rules)
  if (me) {
    await setDoc(
      doc(db, "calendar_events", `${eventId}_${me}`),
      {
        eventId,
        ownerId: me,
        title: updated.title ?? "Tennis Event",
        start: updated.start ?? null,
        end: updated.end ?? null,
        participants: allIds,
        status: "accepted",
        visibility: "private",
        courtName: updated.location ?? null,
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  // Others (may be blocked by rules → non-fatal)
  await Promise.all(
    allIds
      .filter((uid) => uid !== me)
      .map(async (uid) => {
        try {
          await setDoc(
            doc(db, "calendar_events", `${eventId}_${uid}`),
            {
              eventId,
              ownerId: uid,
              title: updated.title ?? "Tennis Event",
              start: updated.start ?? null,
              end: updated.end ?? null,
              participants: allIds,
              status: "accepted",
              visibility: "private",
              courtName: updated.location ?? null,
              createdAt: serverTimestamp(),
            },
            { merge: true }
          );
        } catch {
          /* ignore */
        }
      })
  );
}

/* -------------------------------- Component ------------------------------- */

export default function EventDetailsPage() {
  const p = useParams<{ id: string | string[] }>();
const id = Array.isArray(p.id) ? p.id[0] : p.id;

// Auth state with explicit loading
const [uid, setUid] = useState<string | null>(null);
const [authLoading, setAuthLoading] = useState(true);
useEffect(() => {
  const off = auth.onAuthStateChanged(u => {
    setUid(u ? u.uid : null);
    setAuthLoading(false);
  });
  return () => off();
}, []);

  const [sendingJoin, setSendingJoin] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // Data
  const [event, setEvent] = useState<EventDoc | null>(null);
  const [hostProfile, setHostProfile] = useState<UserProfile | null>(null);
  const [participantProfiles, setParticipantProfiles] = useState<
    Record<string, UserProfile | undefined>
  >({});

  // UI / state
  const [loading, setLoading] = useState(true);
  const [hasPendingRequest, setHasPendingRequest] = useState(false);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [requestsOpen, setRequestsOpen] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [leaving, setLeaving] = useState(false); 
  const [activeTab, setActiveTab] = useState<"about" | "players">("about");


  /* ----------------------------- Subscriptions ---------------------------- */

  // Event live updates
  useEffect(() => {
    if (!id) return;
    const unsub = onSnapshot(doc(db, "events", id), (snap) => {
      if (snap.exists()) setEvent(snap.data() as EventDoc);
      else setEvent(null);
      setLoading(false);
    });
    return () => unsub();
  }, [id]);

  // Host profile
  useEffect(() => {
    if (!event?.hostId) return;
    const unsub = onSnapshot(doc(db, "players", event.hostId), (snap) => {
      if (snap.exists()) setHostProfile(snap.data() as UserProfile);
      else setHostProfile(null);
    });
    return () => unsub();
  }, [event?.hostId]);

  // Participant mini-profiles (best-effort)
  useEffect(() => {
    const ids = Array.from(
  new Set((event?.participants ?? []).filter((uid) => uid && uid !== event?.hostId))
);

    if (!ids.length) {
      setParticipantProfiles({});
      return;
    }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        ids.map(async (uid) => {
          try {
            const s = await getDoc(doc(db, "players", uid));
            return [uid, s.exists() ? (s.data() as UserProfile) : undefined] as const;
          } catch {
            return [uid, undefined] as const;
          }
        })
      );
      if (!cancelled) {
        setParticipantProfiles(Object.fromEntries(entries));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [event?.participants, event?.hostId]);

// Has current user already requested? (uses uid state)
useEffect(() => {
  if (!id || !uid) return; // wait until we know the uid
  (async () => {
    const qRef = query(
      collection(db, "events", id, "join_requests"),
      where("userId", "==", uid),
      where("status", "==", "pending")
    );
    const snap = await getDocs(qRef);
    setHasPendingRequest(!snap.empty);
  })();
}, [id, uid]);

  // Join requests (host-only)
  useEffect(() => {
    if (!id || !event?.hostId) return;
    const u = auth.currentUser;
    if (!u || uid !== event.hostId) return;

    const unsub = onSnapshot(collection(db, "events", id, "join_requests"), async (snap) => {
      const items = await Promise.all(
        snap.docs.map(async (d) => {
          const data = d.data() as {
  userId: string;
  status: "pending" | "accepted" | "declined" | "left";
};
          let profile: UserProfile | undefined;
          try {
            const profSnap = await getDoc(doc(db, "players", data.userId));
            if (profSnap.exists()) profile = profSnap.data() as UserProfile;
          } catch {}
          return { id: d.id, userId: data.userId, status: data.status, profile };
        })
      );
      items.sort((a, b) => {
        const order = { pending: 0, accepted: 1, left: 2, declined: 3 } as const;

        return order[a.status] - order[b.status];
      });
      setRequests(items);
    });
    return () => unsub();
  }, [id, event?.hostId, uid]);

useEffect(() => {
  if (!id || !event || !uid) return;

  // ⬇️ Add this line so we don't touch chat after cancel
  if (event.status === "cancelled") { setConversationId(null); return; }

  const attendees = Array.from(
    new Set([event.hostId, ...(event.participants ?? [])].filter(Boolean) as string[])
  );
  if (attendees.length === 0) return;

  const iAmHost = uid === event.hostId;
  const iAmParticipant = attendees.includes(uid);

  if (!iAmHost && !iAmParticipant) {
    setConversationId(null);
    return;
  }

  let cancelled = false;
  (async () => {
    try {
      const convId = await ensureEventConversation(id, attendees, event.title);
      if (!cancelled) setConversationId(convId);
    } catch (e) {
      console.error("ensureEventConversation failed", e);
    }
  })();

  return () => { cancelled = true; };
}, [id, uid, event?.hostId, event?.participants, event?.title, event?.status]);


  

  // Auto-sync my calendar when I'm the host or I've been accepted
const [autoSynced, setAutoSynced] = useState(false);

useEffect(() => {
  if (!id || !uid || !event) return;
  if (autoSynced) return;

  if (event.status === "cancelled" || event.status === "completed") return;

  const iAmHost = uid === event.hostId;
  const iAmParticipant = (event.participants ?? []).includes(uid);

  // Only sync if I'm the host or I'm in the participants list
  if (!iAmHost && !iAmParticipant) return;

  let cancelled = false;
  (async () => {
    try {
      // Avoid repeated writes: only write if my personal calendar doc doesn't exist yet
      const myCalRef = doc(db, "calendar_events", `${id}_${uid}`);
      const myCalSnap = await getDoc(myCalRef);
      if (!myCalSnap.exists()) {
        await upsertCalendarEntriesForEvent(event, id);
      }
      if (!cancelled) setAutoSynced(true);
    } catch (e) {
      console.error("[calendar] auto-sync failed", e);
    }
  })();

  return () => {
    cancelled = true;
  };
  // Re-run if these change (e.g., I get accepted and appear in participants)
}, [
  id,
  uid,
  event,                 // ok to depend on the object; or expand to event.hostId, event.participants, etc.
]);

// If the event becomes cancelled (from anywhere), remove MY calendar doc only.
// Each user deletes their own copy; avoids cross-user rule failures.
useEffect(() => {
  if (!id || !event || event.status !== "cancelled" || !uid) return;

  (async () => {
    try {
      await deleteDoc(doc(db, "calendar_events", `${id}_${uid}`));
    } catch {
      /* ignore */
    }
  })();
}, [id, uid, event?.status]);


  /* ------------------------------- Actions -------------------------------- */

async function handleJoinRequest() {
  if (!uid || !event || !id) return;

  try {
    setSendingJoin(true);
    const jrCol = collection(db, "events", id, "join_requests");

    // Reuse existing request (any status) instead of creating a new one
    const existingSnap = await getDocs(query(jrCol, where("userId", "==", uid)));
    const existing = existingSnap.docs[0];

    if (existing) {
      await updateDoc(existing.ref, {
        status: "pending",
        updatedAt: serverTimestamp(),
      });
    } else {
      await addDoc(jrCol, {
        userId: uid,
        status: "pending",
        createdAt: serverTimestamp(),
      });
    }

    if (event.hostId) {
      await addDoc(collection(db, "notifications"), {
        recipientId: event.hostId,
        type: "event_join_request",
        eventId: id,
        fromUserId: uid,
        message: "A player has requested to join your event.",
        read: false,
        createdAt: serverTimestamp(),
      });
    }

    setHasPendingRequest(true);
  } catch (err) {
    console.error("Failed to send join request:", err);
  } finally {
    setSendingJoin(false);
  }
}


async function handleAccept(request: JoinRequest) {
  if (!event || !id) return;
  const u = auth.currentUser;
  if (!u || uid !== event.hostId) return; // host only
  if (request.status !== "pending") return;

  setAcceptingId(request.id);
  try {
    const eventRef = doc(db, "events", id);
    const requestRef = doc(db, "events", id, "join_requests", request.id);

    await runTransaction(db, async (tx) => {
      const eventSnap = await tx.get(eventRef);
      if (!eventSnap.exists()) throw new Error("Event no longer exists");

      const data = eventSnap.data() as EventDoc;
      const total = data.spotsTotal ?? 0;
      const currentFilled =
        (typeof data.spotsFilled === "number"
          ? data.spotsFilled
          : (data.participants?.length ?? 0)) || 0;

      if (total && currentFilled >= total) throw new Error("Event is already full");

    const existing = Array.from(new Set(data.participants ?? []));
const alreadyIn = existing.includes(request.userId);
const nextParticipants = alreadyIn ? existing : [...existing, request.userId];
const nextFilled = nextParticipants.length;
const nextStatus = total && nextFilled >= total ? "full" : (data.status ?? "open");

tx.update(eventRef, {
  participants: nextParticipants,
  spotsFilled: nextFilled,
  status: nextStatus,
  updatedAt: serverTimestamp(),
});


      tx.update(requestRef, {
        status: "accepted",
        updatedAt: serverTimestamp(),
      });
    });

    await addDoc(collection(db, "notifications"), {
      recipientId: request.userId,
      type: "event_join_accepted",
      eventId: id,
      fromUserId: event.hostId,
      message: "Your request to join an event was accepted!",
      read: false,
      createdAt: serverTimestamp(),
    });

    const updatedSnap = await getDoc(doc(db, "events", id));
    if (updatedSnap.exists()) {
      const updated = updatedSnap.data() as EventDoc;
      await upsertCalendarEntriesForEvent(updated, id);
    }
  } catch (err) {
    console.error("Failed to accept request:", err);
  } finally {
    setAcceptingId(null);
  }
}

async function handleLeaveEvent() {
  if (!id || !event || !uid) return;
  if (uid === event.hostId) return; // host can't leave
  if (!event.participants?.includes(uid)) return;
  if (event.status === "cancelled" || event.status === "completed") return;

  const ok = confirm("Leave this event? The host will be notified and your spot will open up.");
  if (!ok) return;

  try {
    setLeaving(true);

    const eventRef = doc(db, "events", id);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(eventRef);
      if (!snap.exists()) throw new Error("Event no longer exists");

      const data = snap.data() as EventDoc;
      if (uid === data.hostId) throw new Error("Host cannot leave");

      const existing = Array.from(new Set(data.participants ?? []));
      if (!existing.includes(uid)) return;

      const nextParticipants = existing.filter(p => p !== uid);
      const nextFilled = nextParticipants.length;
      const total = data.spotsTotal ?? 0;
      const nextStatus = total && nextFilled < total && data.status === "full" ? "open" : data.status;

      tx.update(eventRef, {
        participants: nextParticipants,
        spotsFilled: nextFilled,
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
    });

    // ⬇️ Mark any accepted join_request from me as "left" (AFTER the tx)
    try {
      const jrSnap = await getDocs(
        query(
          collection(db, "events", id, "join_requests"),
          where("userId", "==", uid),
          where("status", "==", "accepted")
        )
      );
      await Promise.all(
        jrSnap.docs.map((d) =>
          updateDoc(d.ref, { status: "left", updatedAt: serverTimestamp() })
        )
      );
    } catch {}

    // notify host (best-effort)
    if (event.hostId) {
      await addDoc(collection(db, "notifications"), {
        recipientId: event.hostId,
        type: "event_left",
        eventId: id,
        fromUserId: uid,
        message: "A participant left your event.",
        read: false,
        createdAt: serverTimestamp(),
      });
    }

    // remove my calendar copy (best-effort)
    try { await deleteDoc(doc(db, "calendar_events", `${id}_${uid}`)); } catch {}

    // leave event conversation (best-effort)
    try {
      if (conversationId) {
        const cRef = doc(db, "conversations", conversationId);
        await runTransaction(db, async (tx) => {
          const cSnap = await tx.get(cRef);
          if (!cSnap.exists()) return;
          tx.update(cRef, { participants: arrayRemove(uid) });
        });
      }
    } catch {}
  } catch (e) {
    console.error("Failed to leave event:", e);
    alert("Could not leave the event. Please try again.");
  } finally {
    setLeaving(false);
  }
}




async function handleCancelEvent() {
  if (!id || !event || !uid) return;
  if (uid !== event.hostId) return; // host only
  if (event.status === "cancelled" || event.status === "completed") return;

  const confirmed = confirm(
    "Cancel this event? All participants will be notified and the event will be marked as Cancelled."
  );
  if (!confirmed) return;

  try {
    setCancelling(true);
    const eventRef = doc(db, "events", id);

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(eventRef);
      if (!snap.exists()) throw new Error("Event no longer exists");
      const data = snap.data() as EventDoc;
      if (uid !== data.hostId) throw new Error("Only the host can cancel");
      if (data.status === "cancelled" || data.status === "completed") return;

      tx.update(eventRef, { status: "cancelled", updatedAt: serverTimestamp() });
    });

    const participantIds = (event.participants ?? []).filter(p => p && p !== event.hostId);
    await Promise.all(
      participantIds.map((pid) =>
        addDoc(collection(db, "notifications"), {
          recipientId: pid,
          type: "event_cancelled",
          eventId: id,
          fromUserId: event.hostId,
          message: "The host cancelled the event.",
          read: false,
          createdAt: serverTimestamp(),
        })
      )
    );

    // calendar cleanup
    try { await deleteDoc(doc(db, "calendar_events", `${id}_${uid}`)); } catch {}
    await Promise.all(
      participantIds.map(async (pid) => {
        try { await deleteDoc(doc(db, "calendar_events", `${id}_${pid}`)); } catch {}
      })
    );
  } catch (e) {
    console.error("Failed to cancel event:", e);
    alert("Could not cancel the event. Check console for details.");
  } finally {
    setCancelling(false);
  }
}

/* ------------------------------ Derivatives ------------------------------ */


  if (loading) {
    return <p className="p-6 text-sm text-muted-foreground">Loading event…</p>;
  }
  if (!event) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <div className="mb-4">
          <Link href="/events" className="text-blue-600 hover:underline text-sm">
            ← Back to Events
          </Link>
        </div>
        <p className="text-red-600">Event not found.</p>
      </main>
    );
  }

const start = event.start ? new Date(event.start) : null;
const end = event.end ? new Date(event.end) : null;

const status = event.status ?? "open";
const spotsTotalNum =
  typeof event.spotsTotal === "number" && event.spotsTotal > 0 ? event.spotsTotal : null;
const filled =
  typeof event.spotsFilled === "number"
    ? event.spotsFilled
    : (event.participants?.length ?? 0);

const isHost = uid != null && uid === event.hostId;
const isParticipant = uid != null && !!event.participants?.includes(uid);
const isFull = spotsTotalNum !== null ? filled >= spotsTotalNum : false;

const canRequest =
  !authLoading &&
  uid !== null &&
  !isHost &&
  !isParticipant &&
  status !== "cancelled" &&
  status !== "completed" &&
  !isFull;

  const visibleRequests = requests.filter(
  (r) => !(r.status === "accepted" && !(event.participants ?? []).includes(r.userId))
);


  function StatusPill({ status }: { status?: EventDoc["status"] }) {
    const base = "rounded-full px-2 py-0.5 text-xs font-medium";
    switch (status) {
      case "open":
        return <span className={`${base} bg-emerald-100 text-emerald-800`}>OPEN</span>;
      case "full":
        return <span className={`${base} bg-amber-100 text-amber-800`}>FULL</span>;
      case "cancelled":
        return <span className={`${base} bg-red-100 text-red-800`}>CANCELLED</span>;
      case "completed":
        return <span className={`${base} bg-gray-200 text-gray-700`}>COMPLETED</span>;
      default:
        return null;
    }
  }

  /* --------------------------------- UI ----------------------------------- */

  return (
    <>
      <main className="mx-auto max-w-3xl px-4 py-6 space-y-6">
        {/* Back + Status */}
<div className="flex items-center justify-between">
  <Link
    href="/events"
    className="
      inline-flex items-center gap-2
      rounded-full border border-primary/20
      bg-white text-primary
      px-3 py-1.5 text-sm font-medium
      shadow-sm
      hover:bg-primary/10
      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30
      transition
    "
  >
    <ArrowLeft className="h-4 w-4" aria-hidden />
    <span>Back to Events</span>
  </Link>

  <StatusPill status={event.status} />
</div>


{/* HERO HEADER (with background image) */}
<section className="relative overflow-hidden rounded-2xl border p-5 shadow-sm">
  {/* background image layer */}
  <div className="absolute inset-0 z-0">
    <img
      src="/images/eventspagetile.jpg"
      alt=""
      className="h-full w-full object-cover"
      loading="lazy"
      fetchPriority="low"
    />
    <div className="absolute inset-0 bg-black/30" />
    <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/35 to-transparent" />
  </div>

  {/* content layer */}
  <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]">
    <div>
      <h1 className="text-2xl font-bold leading-tight">
        {event.title || "Tennis Event"}
      </h1>
      <p className="mt-1 text-sm capitalize opacity-95">
        {event.type || "Event"}
      </p>
    </div>

    {typeof event.spotsTotal === "number" && (
      <div className="min-w-[160px]">
        <div className="flex items-center justify-between text-xs opacity-95">
          <span>Spots</span>
          <span className="font-medium">
            {(event.spotsFilled ?? 0)}/{event.spotsTotal}
          </span>
        </div>
        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-white/30">
          <div
            className="h-2 bg-emerald-400 transition-[width] duration-300"
            style={{
              width: `${
                event.spotsTotal && event.spotsTotal > 0
                  ? Math.min(
                      100,
                      Math.max(
                        0,
                        Math.round(((event.spotsFilled ?? 0) / event.spotsTotal) * 100)
                      )
                    )
                  : 0
              }%`,
            }}
          />
        </div>
      </div>
    )}
  </div>

  {/* meta chips */}
  <div className="relative z-10 mt-4 flex flex-wrap items-center gap-2 text-sm">
    {event.location && (
      <span className="inline-flex items-center gap-1 rounded-full border border-white/30 bg-white/15 px-2 py-1 text-white backdrop-blur-sm">
        <MapPin className="h-4 w-4" aria-hidden />
        {event.location}
      </span>
    )}
    {start && (
      <span className="inline-flex items-center gap-1 rounded-full border border-white/30 bg-white/15 px-2 py-1 text-white backdrop-blur-sm">
        <CalendarDays className="h-4 w-4" aria-hidden />
        {start.toLocaleString()} {end ? `– ${end.toLocaleTimeString()}` : ""}
      </span>
    )}
    {typeof event.durationMins === "number" && (
      <span className="inline-flex items-center gap-1 rounded-full border border-white/30 bg-white/15 px-2 py-1 text-white backdrop-blur-sm">
        <Clock className="h-4 w-4" aria-hidden />
        {event.durationMins} mins
      </span>
    )}
    {typeof event.minSkill === "number" && (
      <span className="inline-flex items-center gap-1 rounded-full border border-white/30 bg-white/15 px-2 py-1 text-white backdrop-blur-sm">
        <ShieldCheck className="h-4 w-4" aria-hidden />
        Min Skill {event.minSkill}
      </span>
    )}
    {typeof event.spotsTotal === "number" && (
      <span className="inline-flex items-center gap-1 rounded-full border border-white/30 bg-white/15 px-2 py-1 text-white backdrop-blur-sm">
        <UsersIcon className="h-4 w-4" aria-hidden />
        {(event.spotsFilled ?? 0)}/{event.spotsTotal}
      </span>
    )}
  </div>
</section>

{/* 🔹 Tab Switcher */}
<div className="mt-4 flex gap-2 border-b">
  {[
    { key: "about", label: "About" },
    { key: "players", label: "Players" },
  ].map((t) => (
    <button
      key={t.key}
      onClick={() => setActiveTab(t.key as any)}
      className={`px-3 py-2 text-sm -mb-px border-b-2 transition ${
        activeTab === t.key
          ? "border-emerald-600 text-emerald-700 font-medium"
          : "border-transparent text-gray-600 hover:text-gray-900"
      }`}
    >
      {t.label}
    </button>
  ))}
</div>




{/* 🔹 ABOUT TAB */}
{activeTab === "about" && (
  <section className="rounded-2xl border bg-white p-5 shadow-sm">
    {/* header row with CTA on the right */}
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold">About this event</h2>

      <div className="flex items-center gap-2">
  {/* Join/request state */}
  {hasPendingRequest ? (
    <button
      disabled
      className="rounded-lg bg-gray-300 px-3 py-2 text-sm font-medium text-gray-700"
      title="Your join request is awaiting approval"
    >
      Request Pending
    </button>
    
  ) : canRequest ? (
    <button
      onClick={handleJoinRequest}
      disabled={sendingJoin}
      className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 active:scale-[0.98] transition disabled:opacity-70"
    >
      {sendingJoin ? "Sending…" : "Request to Join"}
    </button>
  ) : (
    <button
      disabled
      className="rounded-lg bg-gray-300 px-3 py-2 text-sm font-medium text-gray-700"
      title={
        isHost
          ? "You are the host"
          : isParticipant
          ? "You’ve already joined"
          : isFull
          ? "Event is full"
          : status === "cancelled"
          ? "Event was cancelled"
          : status === "completed"
          ? "Event has finished"
          : "Join unavailable"
      }
    >
      {isHost
        ? "You’re the Host"
        : isParticipant
        ? "You’ve Joined"
        : isFull
        ? "Full"
        : status === "cancelled"
        ? "Cancelled"
        : status === "completed"
        ? "Completed"
        : "Unavailable"}
    </button>
  )}
  {isParticipant && !isHost && status !== "cancelled" && status !== "completed" && (
  <button
    onClick={handleLeaveEvent}
    disabled={leaving}
    className="rounded-lg border border-red-300 text-red-700 px-3 py-2 text-sm font-medium hover:bg-red-50 active:scale-[0.98] transition disabled:opacity-70"
    title="Leave this event"
  >
    {leaving ? "Leaving…" : "Leave Event"}
  </button>
)}


  {/* 🔹 Host-only Cancel (duplicate of sticky bar, but visible here too) */}
  {isHost && status !== "cancelled" && status !== "completed" && (
    <button
      onClick={handleCancelEvent}
      disabled={cancelling}
      className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 active:scale-[0.98] transition disabled:opacity-70"
      title="Cancel this event"
    >
      {cancelling ? "Cancelling…" : "Cancel Event"}
    </button>
  )}

  {/* Event chat shortcut */}
  {conversationId && (isHost || isParticipant) && status !== "cancelled" && (
    <Link
      href={`/messages/${conversationId}`}
      className="rounded-lg border border-emerald-300 text-emerald-700 px-3 py-2 text-sm font-medium hover:bg-emerald-50"
      title="Open event conversation"
    >
      Event Chat
    </Link>
  )}
</div>
</div>

    {/* description */}
    {event.description ? (
      <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700">{event.description}</p>
    ) : (
      <p className="text-sm text-muted-foreground italic">No description provided.</p>
    )}
  </section>
)}

{/* 🔹 PLAYERS TAB */}
{activeTab === "players" && (
  <>
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-base font-semibold">Players</h2>

      {/* Host */}
      {event.hostId && hostProfile && (
        <Link
          href={`/players/${event.hostId}`}
          className="flex items-center gap-3 rounded-xl border p-3 hover:bg-gray-50 transition"
        >
          <img
            src={hostProfile.photoURL || "/default-avatar.png"}
            alt={hostProfile.name || "Host"}
            className="h-12 w-12 rounded-full object-cover"
          />
          <div>
            <p className="font-medium">Host · {hostProfile.name || "Unknown Player"}</p>
            {getSkill(hostProfile) !== null && (
              <p className="text-sm text-muted-foreground">
                Skill Level: {getSkill(hostProfile)}
              </p>
            )}
          </div>
        </Link>
      )}

      {/* Participants */}
      {(event.participants?.length ?? 0) > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Accepted Participants
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {Array.from(new Set(event.participants ?? []))
              .filter((uid) => uid !== event.hostId)
              .map((uid) => {
                const p = participantProfiles[uid];
                return (
                  <Link
                    key={uid}
                    href={`/players/${uid}`}
                    className="group relative inline-flex items-center"
                    title={p?.name || uid}
                  >
                    <img
                      src={p?.photoURL || "/default-avatar.png"}
                      className="h-9 w-9 rounded-full ring-2 ring-white object-cover transition-transform group-hover:scale-105"
                      alt={p?.name || "Player"}
                    />
                  </Link>
                );
              })}
          </div>
        </div>
      )}
    </section>


    {/* Join Requests only visible to host */}
    {isHost && visibleRequests.length > 0 && (
      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <button
          onClick={() => setRequestsOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left"
        >
          <h2 className="text-base font-semibold">
            Join Requests{" "}
            <span className="text-muted-foreground">({visibleRequests.length})</span>
          </h2>
          <ChevronDown
            className={`h-5 w-5 transition-transform ${
              requestsOpen ? "rotate-180" : ""
            }`}
          />
        </button>

        {requestsOpen && (
          <div className="mt-3 space-y-3">
            {visibleRequests.map((req) => {

              const skill = getSkill(req.profile || null);
              const canAccept = req.status === "pending" && !isFull;

              return (
                <div
                  key={req.id}
                  className="flex items-center justify-between gap-3 rounded-xl border p-3"
                >
                  <Link
                    href={`/players/${req.userId}`}
                    className="flex items-center gap-3 hover:opacity-90"
                  >
                    <img
                      src={req.profile?.photoURL || "/default-avatar.png"}
                      alt={req.profile?.name || "Player"}
                      className="h-10 w-10 rounded-full object-cover"
                    />
                    <div>
                      <p className="font-medium">
                        {req.profile?.name || "Unknown Player"}
                      </p>
                      {skill !== null && (
                        <p className="text-sm text-muted-foreground">
                          Skill Level: {skill}
                        </p>
                      )}
                      <p
                        className={`mt-0.5 inline-flex items-center gap-1 text-xs ${
  req.status === "pending"
    ? "text-amber-700"
    : req.status === "accepted"
    ? "text-emerald-700"
    : req.status === "left"
    ? "text-gray-700"
    : "text-gray-600"
}`}

                      >
                        {req.status === "pending" && (
                          <Clock className="h-3.5 w-3.5" />
                        )}
                        {req.status === "accepted" && (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        {req.status === "declined" && (
                          <XCircle className="h-3.5 w-3.5" />
                        )}{req.status === "left" && <XCircle className="h-3.5 w-3.5" />}

                        {req.status.charAt(0).toUpperCase() +
                          req.status.slice(1)}
                      </p>
                    </div>
                  </Link>

                  <button
                    onClick={() => handleAccept(req)}
                    disabled={!canAccept || acceptingId === req.id}
                    className={`rounded-lg px-3 py-2 text-sm font-medium text-white ${
                      canAccept
                        ? "bg-emerald-600 hover:bg-emerald-700"
                        : "bg-gray-300"
                    }`}
                  >
                    {acceptingId === req.id ? "Accepting…" : "Accept"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    )}
  </>
)}

 
      </main>

       
    </>
  );
}
