"use client";

import { useCallback, useEffect, useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { onAuthStateChanged, type User } from "firebase/auth";

import { auth, db } from "@/lib/firebaseConfig";

const getValidBirthYear = (birthYear: unknown) => {
  if (typeof birthYear !== "number" || !Number.isFinite(birthYear)) return null;

  const currentYear = new Date().getFullYear();
  const age = currentYear - birthYear;

  if (birthYear < 1900 || birthYear > currentYear) return null;
  if (age < 18 || age > 110) return null;

  return birthYear;
};

type RequireBirthYearState = {
  user: User | null;
  isCheckingBirthYear: boolean;
  needsBirthYear: boolean;
};

export function useRequireBirthYear(enabled = true) {
  const [state, setState] = useState<RequireBirthYearState>({
    user: auth.currentUser,
    isCheckingBirthYear: enabled,
    needsBirthYear: false,
  });

  useEffect(() => {
    if (!enabled) {
      setState((prev) => ({
        user: prev.user,
        isCheckingBirthYear: false,
        needsBirthYear: false,
      }));
      return;
    }

    let isActive = true;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!isActive) return;

      if (!user) {
        setState({
          user: null,
          isCheckingBirthYear: false,
          needsBirthYear: false,
        });
        return;
      }

      setState({
        user,
        isCheckingBirthYear: true,
        needsBirthYear: false,
      });

      const [playerSnap, privatePlayerSnap] = await Promise.all([
        getDoc(doc(db, "players", user.uid)),
        getDoc(doc(db, "players_private", user.uid)),
      ]);

      if (!isActive) return;

      const playerData = playerSnap.exists() ? (playerSnap.data() as Record<string, unknown>) : null;
      const privatePlayerData = privatePlayerSnap.exists()
        ? (privatePlayerSnap.data() as Record<string, unknown>)
        : null;

      const birthYear =
        getValidBirthYear(privatePlayerData?.birthYear) ??
        getValidBirthYear(playerData?.birthYear);

      setState({
        user,
        isCheckingBirthYear: false,
        needsBirthYear: birthYear === null,
      });
    });

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [enabled]);

  const saveBirthYear = useCallback(async (birthYear: number) => {
    const user = auth.currentUser;
    if (!user) return;

    await setDoc(
      doc(db, "players_private", user.uid),
      {
        birthYear,
        birthYearUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    setState({
      user,
      isCheckingBirthYear: false,
      needsBirthYear: false,
    });
  }, []);

  return {
    ...state,
    saveBirthYear,
  };
}
