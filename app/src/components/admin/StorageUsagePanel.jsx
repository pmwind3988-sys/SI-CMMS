"use client";

/**
 * SI — Service Inside · Administration · Settings · Storage
 *
 * How full the Supabase project is, for the Superuser alone (migration 0053).
 *
 * DATA_AND_STORAGE.md already had the SQL for all of this and told you to run it
 * in the Supabase SQL Editor. That is the right home for the destructive half,
 * and the wrong home for the question that comes first — is anything nearly
 * full? — because answering it needed a dashboard login, so in practice nobody
 * asked until an upload failed.
 *
 * Three decisions here are worth not undoing:
 *
 *   READ-ONLY, with no cleanup buttons. Every clearing operation in §3 is
 *   irreversible, and the Free plan has no backups at all — §1 calls that the
 *   most important line on the page. So this reports and links; the deletions
 *   stay behind a dashboard login where taking a backup first is a deliberate
 *   step.
 *
 *   THE TWO GAUGES ARE NOT EQUIVALENT, and are labelled so. A full database puts
 *   the whole project into read-only mode and every write in the app starts
 *   failing; a full bucket fails new uploads and nothing else. Drawing them as
 *   two identical bars would imply the same urgency.
 *
 *   EGRESS IS NAMED, NOT SHOWN. It is the quota this app spends fastest (§2 —
 *   signed URLs are minted per read, so viewing a work order re-downloads its
 *   photos), and it cannot be read from here at all: it lives in Supabase's
 *   billing API, which needs a personal access token, and this app is a static
 *   export that would ship any token it held to every browser. Two green gauges
 *   and silence would read as "everything is fine" while the one quota most
 *   likely to bite is off-screen.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Database,
  HardDrive,
  RefreshCw,
  Info,
  ShieldAlert,
  ExternalLink,
  Loader2,
} from "lucide-react";
import {
  fetchStorageUsage,
  databaseGauge,
  storageGauge,
  formatBytes,
  formatPercent,
  describeObjectKey,
} from "../../lib/platformUsage";
import { PLATFORM_QUOTAS, QUOTA_CONSEQUENCE } from "../../lib/constants";
import { describeError } from "../../lib/errors";
import { fmtDateTimeMY } from "../../lib/datetime";
import Button from "../ui/Button";
import { Card, ErrorBanner } from "../ui/Surfaces";

/* The project's own usage page, which is where every action this panel might
   prompt actually happens — upgrade, backup, egress. Derived from the Supabase
   URL rather than hardcoded, so it points at whichever project this build is
   configured against (there are two — see TEST_ENVIRONMENT.md) instead of
   sending someone to production's dashboard to read test's numbers. */
function usageUrl() {
  const m = /https:\/\/([a-z0-9]+)\.supabase\./i.exec(
    process.env.NEXT_PUBLIC_SUPABASE_URL || ""
  );
  return m ? `https://supabase.com/dashboard/project/${m[1]}/settings/usage` : null;
}

const LEVEL = {
  ok: { bar: "bg-[#0B6B48]", text: "text-good-text", ring: "border-[#D8DEE4]" },
  warn: { bar: "bg-accent", text: "text-[#92400E]", ring: "border-[#F59E0B66]" },
  critical: { bar: "bg-[#C62828]", text: "text-danger-text", ring: "border-[#EF444455]" },
};

function Gauge({ icon: Icon, title, g, consequence }) {
  const tone = LEVEL[g.level];
  return (
    <Card className={`border p-4 ${tone.ring}`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[13.5px] font-bold text-ink">
          <Icon size={15} />
          {title}
        </div>
        <div className={`text-[15px] font-bold ${tone.text}`}>{formatPercent(g.ratio)}</div>
      </div>

      {/* The bar is clamped to 100% for drawing; the percentage above it is not.
          Over-quota is a real state and a bar cannot show it, so the number is
          what has to stay honest. The 1.5% floor is so a bucket holding
          something never draws as a bucket holding nothing. */}
      <div className="h-2.5 overflow-hidden rounded-full bg-canvas" role="presentation">
        <div
          className={`h-full rounded-full ${tone.bar}`}
          style={{ width: `${Math.min(100, Math.max(g.ratio * 100, g.used > 0 ? 1.5 : 0))}%` }}
        />
      </div>

      <div className="mt-2 text-[12.5px] text-ink-soft">
        <span className="font-semibold text-ink">{formatBytes(g.used)}</span> of{" "}
        {formatBytes(g.limit)} used
      </div>
      <p className="mt-1.5 text-[12px] leading-snug text-ink-soft">{consequence}</p>
    </Card>
  );
}

export default function StorageUsagePanel() {
  const [usage, setUsage] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setUsage(await fetchStorageUsage());
    } catch (e) {
      // si_storage_usage() raises sentences written to be read, and
      // describeError() surfaces server messages verbatim — so a refusal
      // explains itself rather than becoming "try again".
      setError(describeError(e, "Couldn't read the project's storage usage."));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const db = databaseGauge(usage);
  const st = storageGauge(usage);
  const dashboard = usageUrl();
  const worst =
    db.level === "critical" || st.level === "critical"
      ? "critical"
      : db.level === "warn" || st.level === "warn"
        ? "warn"
        : "ok";

  return (
    <>
      <div className="mb-3 flex items-start gap-2 rounded bg-canvas px-3.5 py-2.5 text-[12.5px] text-ink-soft">
        <Info size={14} className="mt-0.5 flex-shrink-0" />
        <span>
          Measured against the <span className="font-semibold">{PLATFORM_QUOTAS.plan}</span> plan.
          Those limits belong to the plan rather than to the database, so they are set in the app
          code — if this project is ever upgraded, they need changing there before these gauges mean
          anything. Nothing on this tab changes any data.
        </span>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {busy && !usage && (
        <div className="flex items-center gap-2 text-[13px] text-ink-soft">
          <Loader2 size={14} className="animate-spin" />
          Measuring…
        </div>
      )}

      {usage && (
        <>
          {worst !== "ok" && (
            <div
              className={`mb-3 flex items-start gap-2 rounded border px-3.5 py-2.5 text-[12.5px] ${
                worst === "critical"
                  ? "border-[#EF444455] bg-[#FCE9E9] text-danger-text"
                  : "border-[#F59E0B66] bg-[#FFFBEB] text-[#92400E]"
              }`}
            >
              <ShieldAlert size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                {worst === "critical"
                  ? "One of these is nearly full. Take a backup before clearing anything — the Free plan keeps none of its own."
                  : "One of these is past 70%. Neither is fixed by a click: upgrading the plan and taking a backup both happen in the Supabase dashboard, so allow lead time."}
              </span>
            </div>
          )}

          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <Gauge
              icon={Database}
              title="Database"
              g={db}
              consequence={QUOTA_CONSEQUENCE.database}
            />
            <Gauge
              icon={HardDrive}
              title="File storage"
              g={st}
              consequence={QUOTA_CONSEQUENCE.storage}
            />
          </div>

          {/* Egress. Named because it cannot be shown — see this file's header. */}
          <Card className="mb-4 p-4">
            <div className="text-[13.5px] font-bold text-ink">Egress</div>
            <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">
              Not shown here, and it is the quota this app spends fastest — photos are served
              through one-hour signed links, so every time someone opens a work order its pictures
              are downloaded again. The figure exists only in Supabase&apos;s billing data, which
              this app has no safe way to read. Worth checking monthly.
            </p>
            {dashboard && (
              <a
                href={dashboard}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex min-h-[40px] items-center gap-1.5 text-[12.5px] font-semibold text-ink underline"
              >
                Open Settings → Usage
                <ExternalLink size={13} />
              </a>
            )}
          </Card>

          <Contributors usage={usage} />

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="ghost" size="sm" icon={RefreshCw} onClick={load} disabled={busy}>
              {busy ? "Measuring…" : "Refresh"}
            </Button>
            <span className="text-[12px] text-ink-soft">
              Measured {fmtDateTimeMY(usage.measured_at)}
            </span>
          </div>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------
   Where it went.

   A gauge says there is a problem; this says where. Both halves are here
   because the answer is usually in a different place from where people look —
   §2's point is that attachments dominate storage by two orders of magnitude,
   so if the bucket is filling and you are reading table sizes, you are in the
   wrong list.
-------------------------------------------------------------------*/
function Contributors({ usage }) {
  const tables = usage.tables || [];
  const objects = usage.largest_objects || [];
  const cron = usage.cron_log;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card className="overflow-hidden">
        <div className="border-b border-[#EDF1F6] px-4 py-2.5 text-[11.5px] font-bold uppercase tracking-wide text-ink-soft">
          Largest tables
        </div>
        <div className="divide-y divide-[#EDF1F6]">
          {tables.map((t) => (
            <div key={t.name} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
              <span className="truncate font-mono text-[12.5px] text-ink">{t.name}</span>
              <span className="flex-shrink-0 text-[12.5px] text-ink-soft">
                {formatBytes(t.total_bytes)}
                <span className="ml-2 text-[11.5px]">
                  {Number(t.live_rows).toLocaleString()} rows
                </span>
              </span>
            </div>
          ))}

          {/* pg_cron's log sits outside `public`, so it is invisible to the query
              above while accruing roughly 670 rows a day from the three sweeps
              whether or not anything happened. §2 says to check it before
              blaming an application table — which is only possible if it is on
              the screen. */}
          {cron && (
            <div className="flex items-baseline justify-between gap-3 bg-canvas px-4 py-2.5">
              <span className="min-w-0 truncate font-mono text-[12.5px] text-ink">
                {cron.name}
                <span className="ml-1.5 font-sans text-[11px] font-semibold text-ink-soft">
                  scheduled-job log
                </span>
              </span>
              <span className="flex-shrink-0 text-[12.5px] text-ink-soft">
                {formatBytes(cron.total_bytes)}
                <span className="ml-2 text-[11.5px]">
                  {Number(cron.rows).toLocaleString()} rows
                </span>
              </span>
            </div>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-[#EDF1F6] px-4 py-2.5 text-[11.5px] font-bold uppercase tracking-wide text-ink-soft">
          Largest files
          <span className="ml-2 font-sans normal-case tracking-normal">
            {Number(usage.storage_objects).toLocaleString()} in the bucket
          </span>
        </div>
        <div className="divide-y divide-[#EDF1F6]">
          {objects.length === 0 && (
            <div className="px-4 py-3 text-[12.5px] text-ink-soft">
              Nothing has been uploaded yet.
            </div>
          )}
          {objects.map((o) => {
            const { file, workOrderId } = describeObjectKey(o.name);
            return (
              <div key={o.name} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] text-ink">{file}</span>
                  {workOrderId && (
                    <a
                      href={`/work-orders/${workOrderId}/`}
                      className="text-[11.5px] text-ink-soft underline"
                    >
                      Open the work order
                    </a>
                  )}
                </span>
                <span className="flex-shrink-0 text-[12.5px] text-ink-soft">
                  {formatBytes(o.bytes)}
                </span>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
