"use client";

/**
 * SI — Service Inside · the dashboard's chart period.
 *
 * Pure: presets in, `{ from, to, bucket }` out. No React, no Supabase, for the
 * same reason exportWorkOrders.js and slaStages.js are shaped this way — it is
 * what lets the bucket rule be exercised in Node, the only place this repo can
 * run a test.
 *
 * THE BUCKET IS DERIVED, NEVER CHOSEN. Two controls where one will do is two
 * ways to produce a chart nobody wants: a day plotted per month is one dot, a
 * year plotted per hour is nine thousand. So the span decides, and the only
 * thing on screen is the period.
 *
 *     a day     -> per hour
 *     a week    -> per day
 *     a month   -> per week
 *     longer    -> per month
 *
 * The four values match si_dashboard_charts_range's `case` exactly. It raises
 * on anything else rather than falling through to a default, so a fifth name
 * invented here is an error the user sees rather than a chart that silently
 * means something other than its label.
 */
import { DATE_PRESETS, dateRangePreset, dateRangeCustom, dateRangeLastMonths, describeRange } from "./datetime";

const DAY_MS = 86400000;

/**
 * The options the dashboard offers, in order. `bucket` is stated for the fixed
 * ones rather than derived, because a named calendar period should keep the
 * granularity its name implies even in the month where the span is unusual —
 * "This month" on the 2nd is two days long and still means weeks, and deriving
 * it would quietly turn it into hours.
 */
export const CHART_PERIODS = [
  { key: "today", label: "Today", bucket: "hour", axis: "hour of the day" },
  { key: "this_week", label: "This week", bucket: "day", axis: "day" },
  { key: "this_month", label: "This month", bucket: "week", axis: "week commencing" },
  { key: "last_month", label: "Last month", bucket: "week", axis: "week commencing" },
  { key: "last_3_months", label: "Last 3 months", bucket: "month", axis: "month" },
  { key: "last_12_months", label: "Last 12 months", bucket: "month", axis: "month" },
  { key: "this_year", label: "This year", bucket: "month", axis: "month" },
  { key: "custom", label: "Custom range…", bucket: null, axis: null },
];

export const DEFAULT_PERIOD = "last_12_months";

/** What a bucket is called where a sentence needs it. */
export const BUCKET_NOUN = {
  hour: "hour",
  day: "day",
  week: "week",
  month: "month",
};

const AXIS_FOR = { hour: "hour of the day", day: "day", week: "week commencing", month: "month" };

/**
 * The bucket a custom range implies.
 *
 * The thresholds are generous on purpose — the boundary case is somebody
 * picking "1 Aug to 31 Aug" by hand and expecting what the "This month" preset
 * gives them, so a month-length custom range has to land on weeks and not on
 * days. 2 days rather than 1 for hours, because an inclusive two-day pick is
 * still a shift-level question; 45 days rather than 31 so a slightly ragged
 * month is not a wall of 40 day-labels.
 */
export function bucketForSpan(fromIso, toIso) {
  const days = (Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS;
  if (!Number.isFinite(days) || days <= 0) return "day";
  if (days <= 2) return "hour";
  if (days <= 16) return "day";
  if (days <= 45) return "week";
  return "month";
}

/**
 * `{ key, label, from, to, bucket, axis, description }` for a chosen period, or
 * null while a custom range is still half-filled.
 *
 * A custom range with only one end open is deliberately refused rather than
 * treated as open-ended: an aggregate needs both edges to bucket between, and
 * "since March" against an unbounded future would generate a spine to the end
 * of time. The work order list's own from-only filter is a different thing —
 * it narrows rows, it does not draw an axis.
 */
export function resolveChartPeriod(key, custom, now = new Date()) {
  const spec = CHART_PERIODS.find((p) => p.key === key) || CHART_PERIODS.find((p) => p.key === DEFAULT_PERIOD);

  let range = null;
  if (spec.key === "custom") {
    range = dateRangeCustom(custom?.from, custom?.to);
    if (!range?.from || !range?.to) return null;
  } else if (spec.key === "last_12_months") {
    range = dateRangeLastMonths(12, now);
  } else if (spec.key === "last_3_months") {
    range = dateRangeLastMonths(3, now);
  } else {
    range = dateRangePreset(spec.key, now);
  }
  if (!range?.from || !range?.to) return null;

  const bucket = spec.bucket || bucketForSpan(range.from, range.to);
  return {
    key: spec.key,
    label: spec.key === "custom" ? describeRange(range) : spec.label,
    from: range.from,
    to: range.to,
    bucket,
    axis: spec.axis || AXIS_FOR[bucket],
    description: describeRange(range),
  };
}

/**
 * The line the TREND card prints under its title — it is the only one of the
 * four that is bucketed, so it is the only one that says "per week".
 */
export function periodSubtitle(period, counted) {
  if (!period) return "";
  return `${counted} · per ${BUCKET_NOUN[period.bucket]} · ${period.description}`;
}

/**
 * The same line for the three rankings, which have no buckets — a top-ten bar
 * chart is an ordering, not a timeline.
 *
 * `counted` is not decoration: the four charts do not all count on the same
 * timestamp. Three count work RAISED in the period and the technician table
 * counts work FINISHED in it, and a league table that silently counted raises
 * would credit people for jobs they have not started. Saying which, on the
 * card, is what stops the two being read as one number.
 */
export function periodScope(period, counted) {
  if (!period) return "";
  return `${counted} · ${period.description}`;
}

export { DATE_PRESETS };
