"use client";

/**
 * SI — Service Inside · Dashboard Module
 * Reads only two small, precomputed documents — never scans work_orders
 * directly from the client. See functions/index.js's computeDashboardStats
 * for what maintains them and why this shape was chosen.
 */
import { doc, onSnapshot } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db, app } from "./firebase";

export function listenDashboardCards(cb, onError) {
  return onSnapshot(doc(db, "stats", "dashboard_cards"), (snap) => cb(snap.exists() ? snap.data() : null), onError);
}

export function listenDashboardCharts(cb, onError) {
  return onSnapshot(doc(db, "stats", "dashboard_charts"), (snap) => cb(snap.exists() ? snap.data() : null), onError);
}

/** Manager/Admin-only — see the matching onCall rule in functions/index.js. */
export async function refreshDashboardStatsNow() {
  const functions = getFunctions(app);
  const call = httpsCallable(functions, "refreshDashboardStats");
  await call();
}
