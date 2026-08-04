"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {useEffect, useState, type ReactNode} from "react";
import {ChevronRight, FileText, HelpCircle, ListChecks, LogOut, ShieldCheck, UserRound, X} from "lucide-react";
import {signOut} from "firebase/auth";

import {auth} from "@/lib/firebaseConfig";
import {useProductSurveyCompletion} from "@/lib/productSurveyCompletion";

type ProfileSettingsMenuProps = {
  open: boolean;
  onClose: () => void;
  uid: string | null;
};

function SettingsLink({href, label, icon, onSelect}: {
  href: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onSelect}
      className="flex min-h-14 items-center gap-3 px-4 py-3 text-left text-sm font-bold text-[#0B3D2E] transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0B3D2E]"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-50 text-[#0B3D2E]" aria-hidden="true">
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      <ChevronRight className="h-5 w-5 text-emerald-950/35" aria-hidden="true" />
    </Link>
  );
}

export default function ProfileSettingsMenu({open, onClose, uid}: ProfileSettingsMenuProps) {
  const router = useRouter();
  const {status: surveyCompletionStatus} = useProductSurveyCompletion(uid, open);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  useEffect(() => {
    if (!open) {
      setConfirmLogout(false);
      setLogoutError("");
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || loggingOut) return;
      if (confirmLogout) setConfirmLogout(false);
      else onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [confirmLogout, loggingOut, onClose, open]);

  if (!open) return null;

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError("");
    try {
      await signOut(auth);
      onClose();
      router.replace("/login");
    } catch {
      setLogoutError("We couldn’t log you out. Please try again.");
      setLoggingOut(false);
    }
  };

  if (confirmLogout) {
    return (
      <div className="fixed inset-0 z-[10010] grid place-items-center bg-black/50 px-4" role="presentation">
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="logout-dialog-title"
          aria-describedby="logout-dialog-description"
          className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl"
        >
          <h2 id="logout-dialog-title" className="text-xl font-black text-[#0B3D2E]">Log out?</h2>
          <p id="logout-dialog-description" className="mt-2 text-sm leading-6 text-slate-600">
            Are you sure you want to log out of TennisMate?
          </p>
          {logoutError ? <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{logoutError}</p> : null}
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              autoFocus
              disabled={loggingOut}
              onClick={() => setConfirmLogout(false)}
              className="min-h-11 flex-1 rounded-xl border border-emerald-950/15 bg-white px-4 py-2 text-sm font-bold text-[#0B3D2E] hover:bg-emerald-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={loggingOut}
              onClick={() => void handleLogout()}
              className="min-h-11 flex-1 rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {loggingOut ? "Logging Out…" : "Log Out"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/45 sm:items-center sm:px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-settings-title"
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-[#F5F5F0] shadow-2xl sm:rounded-3xl"
        style={{paddingBottom: "env(safe-area-inset-bottom)"}}
      >
        <div className="flex items-center justify-between px-5 pb-3 pt-5">
          <h2 id="profile-settings-title" className="text-xl font-black text-[#0B3D2E]">Settings</h2>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            aria-label="Close settings"
            className="grid h-11 w-11 place-items-center rounded-full bg-white text-[#0B3D2E] shadow-sm"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-5 px-4 pb-5">
          <section aria-labelledby="settings-account-heading">
            <h3 id="settings-account-heading" className="mb-2 px-2 text-xs font-black uppercase tracking-wider text-emerald-950/55">Account</h3>
            <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
              <SettingsLink href="/profile?edit=true" label="Edit Profile" icon={<UserRound className="h-5 w-5" />} onSelect={onClose} />
            </div>
          </section>

          <section aria-labelledby="settings-support-heading">
            <h3 id="settings-support-heading" className="mb-2 px-2 text-xs font-black uppercase tracking-wider text-emerald-950/55">Support</h3>
            <div className="divide-y divide-emerald-950/10 overflow-hidden rounded-2xl bg-white shadow-sm">
              <SettingsLink href="/support" label="Help & Feedback" icon={<HelpCircle className="h-5 w-5" />} onSelect={onClose} />
              {surveyCompletionStatus === "incomplete" || surveyCompletionStatus === "error" ? (
                <SettingsLink href="/survey" label="Product Survey" icon={<ListChecks className="h-5 w-5" />} onSelect={onClose} />
              ) : null}
            </div>
          </section>

          <section aria-labelledby="settings-legal-heading">
            <h3 id="settings-legal-heading" className="mb-2 px-2 text-xs font-black uppercase tracking-wider text-emerald-950/55">Legal</h3>
            <div className="divide-y divide-emerald-950/10 overflow-hidden rounded-2xl bg-white shadow-sm">
              <SettingsLink href="/terms" label="Terms of Use" icon={<FileText className="h-5 w-5" />} onSelect={onClose} />
              <SettingsLink href="/privacy" label="Privacy Policy" icon={<ShieldCheck className="h-5 w-5" />} onSelect={onClose} />
            </div>
          </section>

          <div className="border-t border-emerald-950/15 pt-5">
            <button
              type="button"
              onClick={() => setConfirmLogout(true)}
              className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-white px-4 py-3 text-left text-sm font-black text-red-700 shadow-sm hover:bg-red-50"
            >
              <span className="grid h-9 w-9 place-items-center rounded-full bg-red-50" aria-hidden="true"><LogOut className="h-5 w-5" /></span>
              Log Out
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
