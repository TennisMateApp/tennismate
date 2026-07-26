"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebaseConfig";
import ClubMembershipSelector from "@/components/clubs/ClubMembershipSelector";
import type { ClubSelection } from "@/lib/clubs";
import type {ClubMembershipPromptVisibilityController} from "@/lib/useClubMembershipPromptVisibility";

export default function ClubMembershipPrompt({
  uid,
  visibility,
}: {
  uid: string;
  visibility: ClubMembershipPromptVisibilityController;
}) {
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const persist = async (selection: ClubSelection) => {
    setSaving(true);
    setError("");
    try {
      await updateDoc(doc(db, "players", uid), selection);
      visibility.resolve();
      setSelectorOpen(false);
    } catch (cause) {
      console.error("[ClubMembershipPrompt] failed to save", cause);
      setError("Unable to save your club membership. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!visibility.ready || !visibility.visible) return null;

  return (
    <>
      <section className="relative rounded-3xl border border-black/10 bg-white p-5 shadow-sm">
        <button type="button" onClick={visibility.dismiss} aria-label="Dismiss club membership prompt" className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-xl text-emerald-950/50 hover:bg-emerald-950/[0.05]"><X size={18} /></button>
        <div className="pr-10 text-sm font-black text-emerald-950">🏟 Club Membership</div>
        <p className="mt-2 text-sm font-semibold text-emerald-950/65">Are you a member of a tennis club?</p>
        {error ? <p className="mt-2 text-xs font-semibold text-red-700" role="alert">{error}</p> : null}
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={() => setSelectorOpen(true)} disabled={saving} className="rounded-2xl bg-[#39FF14] px-4 py-2.5 text-sm font-extrabold text-emerald-950 disabled:opacity-50">Select Club</button>
          <button type="button" onClick={() => void persist({ clubId: null, clubName: null, clubStatus: "none" })} disabled={saving} className="rounded-2xl border border-emerald-950/15 bg-white px-4 py-2.5 text-sm font-extrabold text-emerald-950 disabled:opacity-50">{saving ? "Saving..." : "I'm not a club member"}</button>
        </div>
      </section>

      {selectorOpen ? (
        <div className="fixed inset-0 z-[190] grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="select-club-title" onMouseDown={(event) => event.target === event.currentTarget && !saving && setSelectorOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div id="select-club-title" className="text-lg font-black text-emerald-950">Club Membership</div>
                <p className="mt-1 text-sm font-semibold text-emerald-950/55">Select a club from TennisMate courts.</p>
              </div>
              <button type="button" onClick={() => setSelectorOpen(false)} disabled={saving} aria-label="Close club selector" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-950/[0.05] text-emerald-950"><X size={18} /></button>
            </div>
            <div className="mt-5">
              <ClubMembershipSelector value={{ clubId: null, clubName: null, clubStatus: null }} onChange={(selection) => void persist(selection)} submittedBy={uid} disabled={saving} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
