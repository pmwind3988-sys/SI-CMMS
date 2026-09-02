"use client";

/**
 * SI — Service Inside · How full is the Supabase project?
 *
 * The one deliberate exception to the listenX contract in this codebase.
 *
 * Everything else in lib/ is `listenX(args, cb, onError)` returning an
 * unsubscribe, because everything else is a row set that Realtime can tell us
 * has changed. "How large is the database" is not a row set: there is no
 * postgres_changes event for it, so a subscription here would be a listener
 * that never fires once. It is a measurement, taken when asked for — on mount,
 * and again when the Superuser presses Refresh.
 *
 * Read-only. There is no write half of this module, and deliberately no cleanup
 * function: every destructive operation in DATA_AND_STORAGE.md §3 is
 * irreversible and the Free plan has no backups at all, so those stay in the
 * SQL Editor behind a dashboard login.
 */
import { supabase } from "./supabase";
import { PLATFORM_QUOTAS, QUOTA_THRESHOLDS } from "./constants";

/**
 * Superuser only — si_storage_usage() raises for anyone else, and the message it
 * raises is written to be read, so describeError() surfacing it verbatim is the
 * right outcome rather than something to catch here.
 */
export async function fetchStorageUsage() {
  const { data, error } = await supabase.rpc("si_storage_usage");
  if (error) throw error;
  return data;
}

/**
 * bytes -> { used, limit, ratio, level }.
 *
 * `ratio` is uncapped on purpose. Over-quota is a real state — Free's storage
 * limit fails uploads rather than stopping the count — and a bar pinned at 100%
 * would report "completely full" and "half again over" identically. The BAR is
 * clamped for drawing; the number is not.
 */
export function gauge(usedBytes, limitBytes) {
  const used = Number(usedBytes) || 0;
  const limit = Number(limitBytes) || 0;
  const ratio = limit > 0 ? used / limit : 0;
  return {
    used,
    limit,
    ratio,
    level:
      ratio >= QUOTA_THRESHOLDS.critical
        ? "critical"
        : ratio >= QUOTA_THRESHOLDS.warn
          ? "warn"
          : "ok",
  };
}

export function databaseGauge(usage) {
  return gauge(usage?.database_bytes, PLATFORM_QUOTAS.databaseBytes);
}

export function storageGauge(usage) {
  return gauge(usage?.storage_bytes, PLATFORM_QUOTAS.storageBytes);
}

/**
 * Bytes as a person reads them.
 *
 * Binary units, because that is what Supabase's own dashboard counts in, and a
 * panel that disagrees with the dashboard it tells you to go and look at is
 * worse than one that rounds differently. One decimal from MB up: 431.7 MB
 * against a 500 MB ceiling is a different situation from 432 MB, and at GB scale
 * a whole-number reading hides a hundred megabytes of movement.
 */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatPercent(ratio) {
  const pct = (Number(ratio) || 0) * 100;
  // Under a tenth of a percent is not "0%" — that reads as "nothing stored",
  // which on a project holding real work orders is simply wrong.
  if (pct > 0 && pct < 0.1) return "<0.1%";
  return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
}

/**
 * The object key stored in `attachments.file_url` is
 * `work_orders/{uuid}/{timestamp}-{name}`. The uuid is the useful half for
 * finding the work order and the timestamp prefix is noise, so the list shows
 * the filename with its work order beside it.
 */
export function describeObjectKey(key = "") {
  const parts = String(key).split("/");
  const file = parts[parts.length - 1] || key;
  const woId = parts.length >= 2 ? parts[parts.length - 2] : null;
  return {
    file: file.replace(/^\d{10,}-/, ""),
    workOrderId: woId && /^[0-9a-f-]{36}$/i.test(woId) ? woId : null,
  };
}
