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

import type {
  EventDoc,
  Player,
  JoinRequest,
} from "@/components/events/DesktopEventDetailsPage";
import { useIsDesktop } from "@/lib/useIsDesktop";
import PlayerProfileView from "@/components/players/PlayerProfileView";
import DesktopEventDetailsPage from "@/components/events/DesktopEventDetailsPage";
import { resolveSmallProfilePhoto } from "@/lib/profilePhoto";


function getSkill(profile?: any | null): number | null {
  if (!profile) return null;

  const v =
    profile.skillLevel ??
    profile.skill ??
    profile.rating ??
    profile.ntrp ??
    profile.utr ??
    profile.skillRating ??
    null;

  return typeof v === "number" ? v : null;
}

function toTitleCase(input: string) {
  return input
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
    .join(" ");
}

function formatSkillRange(event: EventDoc): string {
  const fromRaw = (event.minSkillLabel ?? "").toString().trim();
  const toRaw = (event.maxSkillLabel ?? "").toString().trim();

  const from = fromRaw ? toTitleCase(fromRaw) : "";
  const to = toRaw ? toTitleCase(toRaw) : "";

  // If either label exists, show range
  if (from || to) {
    if (from && to) {
      return from.toLowerCase() === to.toLowerCase() ? from : `${from} to ${to}`;
    }
    return from ? `${from}+` : `Up to ${to}`;
  }

  // Legacy fallback (numeric)
  if (typeof event.minSkill === "number") return `Minimum: ${event.minSkill}`;

  return "All levels welcome";
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
 const [hostProfile, setHostProfile] = useState<Player | null>(null);

const [participantProfiles, setParticipantProfiles] = useState<
  Record<string, Player | undefined>
>({});

  // UI / state
  const [loading, setLoading] = useState(true);
  const [hasPendingRequest, setHasPendingRequest] = useState(false);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [requestsOpen, setRequestsOpen] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [leaving, setLeaving] = useState(false); 
  const [confirmingBooking, setConfirmingBooking] = useState(false);
const isDesktop = useIsDesktop();
const [profileOpenId, setProfileOpenId] = useState<string | null>(null);

  /* ----------------------------- Subscriptions ---------------------------- */

  // Event live updates
  useEffect(() => {
    if (!id) return;
    const unsub = onSnapshot(doc(db, "events", id), (snap) => {
  if (snap.exists()) {
    const data = snap.data() as EventDoc;

    setEvent({
      bookingConfirmed: false, // ✅ default if missing in Firestore
      ...data,
    });
  } else {
    setEvent(null);
  }
  setLoading(false);
});
    return () => unsub();
  }, [id]);

  // Host profile
  useEffect(() => {
    if (!event?.hostId) return;
    const unsub = onSnapshot(doc(db, "players", event.hostId), (snap) => {
      if (snap.exists()) setHostProfile(snap.data() as Player);
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
            return [uid, s.exists() ? (s.data() as Player) : undefined] as const;
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
          let profile: Player | undefined;
          try {
            const profSnap = await getDoc(doc(db, "players", data.userId));
            if (profSnap.exists()) profile = profSnap.data() as Player;
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

// Close profile modal on Escape
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") setProfileOpenId(null);
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}, []);

// Lock scroll when modal open
useEffect(() => {
  if (!profileOpenId) return;

  const prevOverflow = document.body.style.overflow;
  const prevTouch = document.body.style.touchAction;

  document.body.style.overflow = "hidden";
  document.body.style.touchAction = "none";

  return () => {
    document.body.style.overflow = prevOverflow;
    document.body.style.touchAction = prevTouch;
  };
}, [profileOpenId]);


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

async function handleDecline(request: JoinRequest) {
  if (!event || !id) return;
  const u = auth.currentUser;
  if (!u || uid !== event.hostId) return; // host only
  if (request.status !== "pending") return;

  try {
    const requestRef = doc(db, "events", id, "join_requests", request.id);

    await updateDoc(requestRef, {
      status: "declined",
      updatedAt: serverTimestamp(),
    });

    // notify requester
    await addDoc(collection(db, "notifications"), {
      recipientId: request.userId,
      type: "event_join_declined",
      eventId: id,
      fromUserId: event.hostId,
      message: "Your request to join an event was declined.",
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error("Failed to decline request:", err);
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

async function handleConfirmBooking() {
  if (!id || !event || !uid) return;
  if (uid !== event.hostId) return; // host only
  if (event.status === "cancelled" || event.status === "completed") return;
  if (event.bookingConfirmed) return;

  const ok = confirm("Mark this event as Booking Confirmed for all players?");
  if (!ok) return;

  try {
    setConfirmingBooking(true);

    await updateDoc(doc(db, "events", id), {
      bookingConfirmed: true,
      bookingConfirmedAt: serverTimestamp(),
      bookingConfirmedBy: uid,
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    console.error("Failed to confirm booking:", e);
    alert("Could not confirm booking. Check console for details.");
  } finally {
    setConfirmingBooking(false);
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

const status: "open" | "full" | "cancelled" | "completed" =
  event.status === "open" ||
  event.status === "full" ||
  event.status === "cancelled" ||
  event.status === "completed"
    ? event.status
    : "open";
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

const visibleRequests = requests
  .filter(
    (r) => !(r.status === "accepted" && !(event.participants ?? []).includes(r.userId))
  )
  .sort((a, b) => {
    const order = { pending: 0, accepted: 1, left: 2, declined: 3 } as const;
    return order[a.status] - order[b.status];
  });

const pendingRequests = visibleRequests.filter((r) => r.status === "pending");

  // ✅ Desktop UI (render the desktop component instead of the mobile layout)
if (isDesktop) {
  return (
    <DesktopEventDetailsPage
      eventId={id}
      event={event}
      uid={uid}
      hostProfile={hostProfile}
      participantProfiles={participantProfiles}
      conversationId={conversationId}
      onCancelEvent={handleCancelEvent}
      cancelling={cancelling}
      isHost={isHost}
      status={status}
      onConfirmBooking={handleConfirmBooking}
      confirmingBooking={confirmingBooking}

      // ✅ JOIN CTA (NEW)
      canRequest={canRequest}
      hasPendingRequest={hasPendingRequest}
      sendingJoin={sendingJoin}
      onJoinRequest={handleJoinRequest}
      isParticipant={isParticipant}
      isFull={isFull}
      authLoading={authLoading}

       requests={visibleRequests}
      acceptingId={acceptingId}
      onAcceptRequest={handleAccept}
      onDeclineRequest={handleDecline}
    />
  );
}



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
  <main className="mx-auto max-w-3xl px-4 py-4 pb-10">
    {/* Top bar (back + actions) */}
    <div className="mb-3 flex items-center justify-between">
      <Link
        href="/events"
        className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900"
      >
        <ArrowLeft className="h-5 w-5" />
        <span>Event Details</span>
      </Link>

      {/* Keep status pill if you want (subtle, top-right) */}
      <StatusPill status={event.status} />
    </div>

    {/* HERO */}
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="relative h-44 w-full">
        <img
          src="/images/eventspagetile.jpg"
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-black/25" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/50 to-transparent" />

        <div className="absolute left-4 top-4">
          <span className="inline-flex items-center rounded-full bg-lime-300 px-3 py-1 text-[11px] font-extrabold tracking-wide text-green-950">
            TRENDING EVENT
          </span>
        </div>

        <div className="absolute bottom-4 left-4 right-4">
          <h1 className="text-xl font-extrabold leading-tight text-white drop-shadow">
            {event.title || "Tennis Event"}
          </h1>
        </div>
      </div>

      {/* Primary CTA */}
      <div className="px-4 pt-4">
        {/* Join/request state (main CTA) */}
        {hasPendingRequest ? (
          <button
            disabled
            className="w-full rounded-xl bg-gray-200 px-4 py-3 text-sm font-bold text-gray-700"
            title="Your join request is awaiting approval"
          >
            Request Pending
          </button>
        ) : canRequest ? (
          <button
            onClick={handleJoinRequest}
            disabled={sendingJoin}
            className="w-full rounded-xl bg-lime-400 px-4 py-3 text-sm font-extrabold text-green-950 shadow-sm hover:bg-lime-300 active:scale-[0.99] transition disabled:opacity-70"
          >
            {sendingJoin ? "Sending…" : "Request to Join"}
          </button>
        ) : (
          <button
            disabled
            className="w-full rounded-xl bg-gray-200 px-4 py-3 text-sm font-bold text-gray-700"
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

        {/* Host line */}
        <div className="mt-3 flex items-center justify-center gap-2 text-xs text-gray-600">
          <span className="font-semibold">
            Host:{" "}
            <span className="text-green-700">
              {hostProfile?.name || "Unknown"}
            </span>
          </span>
          <span>•</span>
          <span>
            {spotsTotalNum !== null ? (
              <>
                <span className="font-semibold text-gray-900">
                  {Math.max(0, spotsTotalNum - filled)}
                </span>{" "}
                slots remaining
              </>
            ) : (
              "Open spots"
            )}
          </span>
        </div>

        {/* Secondary actions (chat / leave / cancel host) */}
        <div className="mt-4 flex flex-col gap-2">
          {/* Event chat shortcut */}
          {conversationId && (isHost || isParticipant) && status !== "cancelled" && (
            <Link
              href={`/messages/${conversationId}`}
              className="w-full rounded-xl border border-emerald-200 bg-white px-4 py-3 text-center text-sm font-bold text-emerald-700 hover:bg-emerald-50"
            >
              Open Event Chat
            </Link>
          )}

          {/* Leave (participant) */}
          {isParticipant && !isHost && status !== "cancelled" && status !== "completed" && (
            <button
              onClick={handleLeaveEvent}
              disabled={leaving}
              className="w-full rounded-xl border border-red-200 bg-white px-4 py-3 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-70"
            >
              {leaving ? "Leaving…" : "Leave Event"}
            </button>
          )}

   {/* Host actions */}
{/* Host actions */}
{isHost && status !== "cancelled" && status !== "completed" && (
  <>
    {/* Confirm Booking (host only, if not already confirmed) */}
    {!event.bookingConfirmed ? (
      <button
        onClick={handleConfirmBooking}
        disabled={confirmingBooking}
        className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-extrabold text-white hover:bg-emerald-700 disabled:opacity-70"
      >
        {confirmingBooking ? "Confirming…" : "Booking Confirmed"}
      </button>
    ) : (
      <div className="w-full rounded-xl bg-emerald-100 px-4 py-3 text-center text-sm font-extrabold text-emerald-800">
        ✓ Court Booking Confirmed
      </div>
    )}

    <Link
      href={`/events/new?edit=${id}`}
      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-center text-sm font-extrabold text-gray-800 hover:bg-gray-50"
    >
      Edit Event
    </Link>

    <button
      onClick={handleCancelEvent}
      disabled={cancelling}
      className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-extrabold text-white hover:bg-red-700 disabled:opacity-70"
    >
      {cancelling ? "Cancelling…" : "Cancel Event"}
    </button>
  </>
)}

        </div>
      </div>

      <div className="h-4" />
    </section>

    {/* EVENT INFO */}
    <section className="mt-5">
      <h2 className="mb-3 text-sm font-extrabold text-gray-900">Event Info</h2>

      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="space-y-4">
          {/* When */}
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-lime-100 text-green-900">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900">When</p>
              <p className="text-sm text-gray-600">
                {start
                  ? `${start.toLocaleString([], {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })} • ${start.toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}${end ? ` – ${end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}`
                  : "TBA"}
              </p>
            </div>
          </div>

          {/* Location (NO MAP) */}
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-lime-100 text-green-900">
              <MapPin className="h-5 w-5" />
            </div>
            <div className="min-w-0">
<p className="text-sm font-bold text-gray-900">Location</p>

<p className="text-sm text-gray-600">
  {event.location || "TBA"}
</p>

{event.location && (
  <div className="mt-3 w-full overflow-hidden rounded-xl border">
    <iframe
      src={`https://www.google.com/maps?q=${encodeURIComponent(
        event.court?.address || event.location
      )}&output=embed`}
      width="100%"
      height="220"
      style={{ border: 0 }}
      loading="lazy"
      allowFullScreen
      referrerPolicy="no-referrer-when-downgrade"
    />
  </div>
)}
            </div>
          </div>

         {/* Skill Level */}
<div className="flex items-start gap-3">
  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-lime-100 text-green-900">
    <ShieldCheck className="h-5 w-5" />
  </div>
  <div className="min-w-0">
    <p className="text-sm font-bold text-gray-900">Skill Level</p>
    <p className="text-sm text-gray-600">{formatSkillRange(event)}</p>
  </div>
</div>

        </div>
      </div>
    </section>

    {/* PLAYERS (compact row like screenshot) */}
<section className="mt-6">
  <div className="mb-3 flex items-center justify-between">
    <h2 className="text-sm font-extrabold text-gray-900">
      Players{" "}
      <span className="font-semibold text-gray-500">
        ({filled}
        {spotsTotalNum !== null ? `/${spotsTotalNum}` : ""})
      </span>
    </h2>
  </div>

      {/* Host join requests - always visible */}
      {isHost && pendingRequests.length > 0 && (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-emerald-900">
              Join Requests ({pendingRequests.length})
            </h3>
          </div>

          <div className="space-y-3">
            {pendingRequests.map((req) => {
              const canAccept = req.status === "pending" && !isFull;

              return (
                <div
                  key={req.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-white p-3 ring-1 ring-emerald-100"
                >
                  <button
                    type="button"
                    onClick={() => setProfileOpenId(req.userId)}
                    className="flex min-w-0 items-center gap-3 text-left hover:opacity-90"
                  >
                    <img
                      src={resolveSmallProfilePhoto(req.profile) || "/default-avatar.png"}
                      alt={req.profile?.name || "Player"}
                      className="h-10 w-10 rounded-full object-cover"
                    />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-gray-900">
                        {req.profile?.name || "Unknown Player"}
                      </p>
                      {getSkill(req.profile || null) !== null && (
                        <p className="text-sm text-gray-600">
                          Skill Level: {getSkill(req.profile || null)}
                        </p>
                      )}
                      <p className="mt-0.5 text-xs font-semibold text-amber-700">
                        Pending approval
                      </p>
                    </div>
                  </button>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => handleDecline(req)}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      Decline
                    </button>

                    <button
                      onClick={() => handleAccept(req)}
                      disabled={!canAccept || acceptingId === req.id}
                      className={`rounded-lg px-3 py-2 text-sm font-semibold text-white ${
                        canAccept
                          ? "bg-emerald-600 hover:bg-emerald-700"
                          : "bg-gray-300"
                      }`}
                    >
                      {acceptingId === req.id ? "Accepting…" : "Accept"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-start gap-3 overflow-x-auto pb-1">
        {/* Host first */}
        {event.hostId && (
        <button
  type="button"
  onClick={() => setProfileOpenId(event.hostId!)}
  className="shrink-0 w-[72px] text-center"
  title={hostProfile?.name || "Host"}
>
  <img
    src={resolveSmallProfilePhoto(hostProfile) || "/default-avatar.png"}
    className="mx-auto h-14 w-14 rounded-full object-cover ring-2 ring-white"
    alt={hostProfile?.name || "Host"}
  />
  <div className="mt-1 h-[32px]">
    <p className="text-[11px] font-bold leading-tight text-gray-800 line-clamp-2">
      {hostProfile?.name || "Host"}
    </p>
  </div>
  <p className="mt-0.5 text-[10px] font-semibold leading-none text-gray-500">
    (Host)
  </p>
</button>
        )}

        {/* Participants */}
        {Array.from(new Set(event.participants ?? []))
          .filter((pid) => pid && pid !== event.hostId)
          .slice(0, 10)
          .map((pid) => {
            const p = participantProfiles[pid];
            return (
<button
  key={pid}
  type="button"
  onClick={() => setProfileOpenId(pid)}
  className="shrink-0 w-[72px] text-center"
  title={p?.name || "Player"}
>
  <img
    src={resolveSmallProfilePhoto(p) || "/default-avatar.png"}
    className="mx-auto h-14 w-14 rounded-full object-cover ring-2 ring-white"
    alt={p?.name || "Player"}
  />
  <div className="mt-1 h-[32px]">
    <p className="text-[11px] font-bold leading-tight text-gray-800 line-clamp-2">
      {p?.name || "Player"}
    </p>
  </div>
  <p className="mt-0.5 text-[10px] font-semibold leading-none text-transparent select-none">
    (Host)
  </p>
</button>
            );
          })}
      </div>
    </section>

    {/* ABOUT */}
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-extrabold text-gray-900">About the Match</h2>
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        {event.description ? (
          <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700">
            {event.description}
          </p>
        ) : (
          <p className="text-sm text-gray-500 italic">No description provided.</p>
        )}
      </div>
    </section>
    {/* Profile overlay modal */}
{profileOpenId && (
  <div className="fixed inset-0 z-[9999]">
    {/* Backdrop */}
    <div
      className="absolute inset-0 bg-black/60"
      onMouseDown={() => setProfileOpenId(null)}
    />

    {/* Panel */}
    <div className="absolute inset-0 flex items-start justify-center px-3 pt-3 pb-4 sm:items-center sm:p-6">
      <div
        className="w-full max-w-[560px] rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: "#071B15" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            height: "min(88dvh, 820px)",
            maxHeight: "min(88dvh, 820px)",
          }}
        >
          <PlayerProfileView
            playerId={profileOpenId}
            onClose={() => setProfileOpenId(null)}
          />
        </div>
      </div>
    </div>
  </div>
)}
  </main>
);

}
