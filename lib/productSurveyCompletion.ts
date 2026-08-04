"use client";

import {useEffect, useState} from "react";
import {doc, getDoc} from "firebase/firestore";

import {db} from "@/lib/firebaseConfig";
import {surveyResponseId} from "@/lib/productSurvey";

export type ProductSurveyCompletionStatus = "idle" | "loading" | "complete" | "incomplete" | "error";

export async function hasCompletedProductSurvey(
  userId: string,
  lookup: (documentId: string) => Promise<boolean> = async (documentId) => {
    const snapshot = await getDoc(doc(db, "surveyResponses", documentId));
    return snapshot.exists();
  },
) {
  return lookup(surveyResponseId(userId));
}

export function useProductSurveyCompletion(userId: string | null, enabled = true) {
  const [status, setStatus] = useState<ProductSurveyCompletionStatus>("idle");

  useEffect(() => {
    let active = true;

    if (!userId || !enabled) {
      setStatus("idle");
      return () => { active = false; };
    }

    setStatus("loading");
    void hasCompletedProductSurvey(userId)
      .then((completed) => {
        if (active) setStatus(completed ? "complete" : "incomplete");
      })
      .catch((error) => {
        console.warn("[Survey] completion check failed", error);
        if (active) setStatus("error");
      });

    return () => { active = false; };
  }, [enabled, userId]);

  return {
    status,
    completed: status === "complete",
    completionKnown: status === "complete" || status === "incomplete",
  };
}
