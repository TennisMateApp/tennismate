import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "@/lib/firebase"; // your initialized client app

const functions = getFunctions(app, "australia-southeast1");

export const cfProposeEvent = httpsCallable(functions, "proposeEvent");
export const cfUpdateEvent  = httpsCallable(functions, "updateEvent");
