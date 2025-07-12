// app/page.tsx
import { auth } from "@/lib/firebaseConfig"; // may not work server-side
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { redirect } from "next/navigation";

export default async function HomePage() {
  // 👇 Disable this in server components
  // const user = await getCurrentUser(); ❌ not valid in client-side setup

  // Instead:
  redirect("/directory"); // or redirect("/login") if you want default landing
}
