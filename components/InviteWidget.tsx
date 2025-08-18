"use client";

import { useEffect, useMemo, useState } from "react";
import { auth, db } from "@/lib/firebaseConfig";
import { doc, getDoc, onSnapshot } from "firebase/firestore";

type RefStats = { entries?: number; qualifiedCount?: number };

export default function InviteWidget() {
  const [uid, setUid] = useState<string | null>(null);
  const [code, setCode] = useState<string>("");
  const [stats, setStats] = useState<RefStats>({});
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const unsubAuth = auth.onAuthStateChanged(async (u) => {
      if (!u) { setUid(null); setLoading(false); return; }
      setUid(u.uid);

      const userRef = doc(db, "users", u.uid);
      const unsubUser = onSnapshot(userRef, (snap) => {
        setCode((snap.data()?.referralCode || "") as string);
        setLoading(false);
      });

      const statsRef = doc(db, "referral_stats", u.uid);
      const unsubStats = onSnapshot(statsRef, (snap) => {
        setStats((snap.data() || {}) as RefStats);
      });

      return () => { unsubUser(); unsubStats(); };
    });
    return () => unsubAuth();
  }, []);

  const link = useMemo(
    () => (code ? `https://tennismate-s7vk.vercel.app/r/${code}` : ""),
    [code]
  );

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  }

  async function share() {
    if (!link) return;
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Join me on TennisMate",
          text: "Find local hitting partners:",
          url: link,
        });
      } else {
        await copy();
      }
    } catch {}
  }

  if (!uid) return null;

  return (
    <div className="rounded-2xl border p-4 sm:p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-lg">Invite friends</h3>
        <span className="text-sm text-neutral-500">
          Entries: <b>{Number(stats.entries ?? 0)}</b>
        </span>
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-neutral-500">Loading your invite link…</p>
      ) : code ? (
        <>
          <p className="mt-2 text-sm text-neutral-600">
            Your code: <span className="font-mono font-semibold">{code}</span>
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              readOnly
              value={link}
              className="w-full border rounded-xl px-3 py-2 text-sm font-mono bg-neutral-50"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button onClick={copy} className="px-3 py-2 rounded-xl border text-sm">
              {copied ? "Copied!" : "Copy"}
            </button>
            <button onClick={share} className="px-3 py-2 rounded-xl border text-sm">
              Share
            </button>
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            Each qualified friend = 1 entry into the prize draw.
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-neutral-600">
          Your invite code is being generated… try again shortly.
        </p>
      )}
    </div>
  );
}
