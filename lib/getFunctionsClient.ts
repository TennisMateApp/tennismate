"use client";

import { getFunctions } from "firebase/functions";
import { app } from "./firebaseConfig";

export function getFunctionsClient() {
  return getFunctions(app, "australia-southeast2");
}
