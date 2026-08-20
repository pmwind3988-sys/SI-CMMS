"use client";

/**
 * SI — Service Inside · Malaysian dates and times
 *
 * One timezone, stated once. Everything else in this app formats dates with
 * `toLocaleString(undefined, …)` — the *device's* locale and timezone, and with
 * no year at all, so a work order raised on 12 August 2026 renders "8/12, 2:56
 * PM" on a laptop set to US English and "12/08, 14:56" on one set to British.
 * The plant is in Malaysia. A supervisor comparing a printout against the board
 * on the wall, and a manager opening an exported workbook on a machine
 * configured for somewhere else, both have to read plant time.
 *
 * So: Asia/Kuala_Lumpur, pinned, never the device's.
 *
 * Two implementation notes that look like over-engineering and are not.
 *
 * FIRST — the display strings are assembled from `formatToParts`, not handed to
 * `toLocaleString("en-MY")`. The `en-MY` locale is not guaranteed to exist: Node
 * built without full ICU falls back to en-US and silently gives back MM/DD/YYYY,
 * and so do some older Android WebViews, which is the runtime the APK ships. A
 * date that reads 08/12/2026 in one place and 12/08/2026 in another is worse
 * than either, because nothing looks broken. Only the *timezone* is delegated to
 * Intl, which every runtime implements correctly; the field order is ours.
 *
 * SECOND — the range boundaries are computed in Kuala Lumpur, not locally.
 * `new Date().setHours(0, 0, 0, 0)` is the obvious way to get "start of today"
 * and it is wrong here: on a browser set to UTC it lands at 08:00 KL, so a job
 * raised at 7am is filed under yesterday and "Today" quietly under-reports the
 * morning shift. Every boundary below goes through klWallToInstant().
 *
 * Malaysia is UTC+8 and has observed no daylight saving since 1936, so the
 * offset could have been hardcoded. It is derived from Intl anyway — a constant
 * 480 is a fact about the world that this file has no way to notice changing.
 */

export const MY_TIMEZONE = "Asia/Kuala_Lumpur";

/**
 * Numeric field extraction. `hourCycle: "h23"` rather than `hour12: false`,
 * which some implementations render as "24" at midnight.
 */
const PART_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: MY_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Anything a date can arrive as, to a Date, or null. */
function toDate(value) {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The wall-clock fields this instant shows in Kuala Lumpur. */
function klParts(date) {
  const parts = {};
  for (const { type, value } of PART_FORMAT.formatToParts(date)) {
    if (type !== "literal") parts[type] = Number(value);
  }
  return parts;
}

/**
 * How far ahead of UTC Kuala Lumpur is at this instant, in ms.
 *
 * Both sides are floored to whole seconds because formatToParts has no
 * millisecond field — without that the difference carries the instant's own
 * sub-second remainder and the offset comes out 8h minus a few hundred ms.
 */
function klOffsetMs(date) {
  const p = klParts(date);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The instant at which Kuala Lumpur's clock reads these fields.
 *
 * One correction step is enough for a zone with a fixed offset, which this one
 * has. Month is 1-based, matching every other function here.
 */
function klWallToInstant(year, month, day, hour = 0, minute = 0, second = 0) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  return new Date(guess - klOffsetMs(new Date(guess)));
}

const pad2 = (n) => String(n).padStart(2, "0");

/* ------------------------------------------------------------------
   Display
-------------------------------------------------------------------*/

/** `20/08/2026` */
export function fmtDateMY(value) {
  const d = toDate(value);
  if (!d) return "—";
  const p = klParts(d);
  return `${pad2(p.day)}/${pad2(p.month)}/${p.year}`;
}

/** `3:45 PM` — 12-hour, which is what Malaysian business writing uses. */
export function fmtTimeMY(value) {
  const d = toDate(value);
  if (!d) return "—";
  const p = klParts(d);
  const suffix = p.hour < 12 ? "AM" : "PM";
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${hour12}:${pad2(p.minute)} ${suffix}`;
}

/** `20/08/2026 3:45 PM` — the one the export and the detail views use. */
export function fmtDateTimeMY(value) {
  const d = toDate(value);
  if (!d) return "—";
  return `${fmtDateMY(d)} ${fmtTimeMY(d)}`;
}

/** `20 Aug 2026` — for headings, where slashes read as noise. */
export function fmtDateLongMY(value) {
  const d = toDate(value);
  if (!d) return "—";
  const p = klParts(d);
  return `${p.day} ${MONTHS_SHORT[p.month - 1]} ${p.year}`;
}

/** `2026-08-20`, Kuala Lumpur's calendar day. For filenames and date inputs. */
export function isoDateMY(value) {
  const d = toDate(value ?? new Date());
  if (!d) return "";
  const p = klParts(d);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/**
 * A duration in minutes, as hours and minutes.
 *
 * Distinct from fmtDue() in constants.js, which formats an SLA countdown and
 * says "overdue". This one is neutral: it labels an elapsed measurement.
 */
export function fmtMinutes(mins) {
  if (mins == null || Number.isNaN(Number(mins))) return "—";
  const total = Math.round(Number(mins));
  const sign = total < 0 ? "-" : "";
  const abs = Math.abs(total);
  const d = Math.floor(abs / 1440);
  const h = Math.floor((abs % 1440) / 60);
  const m = abs % 60;
  if (d > 0) return `${sign}${d}d ${h}h`;
  if (h > 0) return `${sign}${h}h ${m}m`;
  return `${sign}${m}m`;
}

/* ------------------------------------------------------------------
   Excel
-------------------------------------------------------------------*/

/**
 * A Date that Excel will *display* as the Kuala Lumpur wall-clock time.
 *
 * An Excel serial number carries no timezone — it is a wall-clock reading and
 * nothing else. write-excel-file converts a JS Date by way of its UTC fields, so
 * handing it the raw instant makes every cell show UTC: a work order raised at
 * 14:56 in Shah Alam appears as 06:56, eight hours adrift, on a column that
 * still sorts correctly and therefore never looks wrong.
 *
 * Shifting the instant so its UTC fields hold the KL reading is the fix. The
 * value is deliberately not an instant any more — it is only ever handed to the
 * spreadsheet writer, never compared against a real time.
 */
export function toExcelDate(value) {
  const d = toDate(value);
  if (!d) return null;
  return new Date(d.getTime() + klOffsetMs(d));
}

/** The number format that pairs with it. */
export const EXCEL_DATETIME_FORMAT = "dd/mm/yyyy hh:mm AM/PM";
export const EXCEL_DATE_FORMAT = "dd/mm/yyyy";

/* ------------------------------------------------------------------
   Ranges
-------------------------------------------------------------------*/

/**
 * The presets the work order list offers, in the order it offers them.
 *
 * `all` carries no range at all rather than a very wide one, so the query it
 * builds is the unfiltered query it always was.
 */
export const DATE_PRESETS = [
  { key: "all", label: "All dates" },
  { key: "today", label: "Today" },
  { key: "this_week", label: "This week" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_year", label: "This year" },
  { key: "custom", label: "Custom range…" },
];

/**
 * `{ from, to }` as ISO strings, or null for "no range".
 *
 * **`to` is EXCLUSIVE.** Every caller pairs it with `.lt()`, never `.lte()`.
 * The alternative is an inclusive end at 23:59:59, which silently drops anything
 * raised in that last second — and, worse, drops rows whose timestamp carries
 * milliseconds, which every `now()` default does. An exclusive upper bound has
 * no such edge.
 *
 * Weeks start Monday, which is the Malaysian working week.
 */
export function dateRangePreset(key, now = new Date()) {
  const p = klParts(now);

  switch (key) {
    case "today": {
      const from = klWallToInstant(p.year, p.month, p.day);
      return isoRange(from, addDays(from, 1));
    }
    case "this_week": {
      // getUTCDay() on the shifted instant reads the KL weekday: Sunday is 0,
      // so Monday-start needs Sunday treated as day 7.
      const midnight = klWallToInstant(p.year, p.month, p.day);
      const dow = new Date(midnight.getTime() + klOffsetMs(midnight)).getUTCDay();
      const from = addDays(midnight, -((dow + 6) % 7));
      return isoRange(from, addDays(from, 7));
    }
    case "this_month": {
      const from = klWallToInstant(p.year, p.month, 1);
      const to = klWallToInstant(p.month === 12 ? p.year + 1 : p.year, p.month === 12 ? 1 : p.month + 1, 1);
      return isoRange(from, to);
    }
    case "last_month": {
      const from = klWallToInstant(p.month === 1 ? p.year - 1 : p.year, p.month === 1 ? 12 : p.month - 1, 1);
      const to = klWallToInstant(p.year, p.month, 1);
      return isoRange(from, to);
    }
    case "this_year": {
      const from = klWallToInstant(p.year, 1, 1);
      return isoRange(from, klWallToInstant(p.year + 1, 1, 1));
    }
    default:
      return null;
  }
}

/**
 * A range from two `<input type="date">` values, both treated as Kuala Lumpur
 * calendar days and both INCLUSIVE to the user — so `to` is pushed to the
 * following midnight to stay exclusive internally. Picking the same day twice
 * means that whole day, which is what anyone would expect.
 *
 * Either end may be blank: from-only is "since", to-only is "up to and
 * including". Both blank is no range.
 */
export function dateRangeCustom(fromDay, toDay) {
  const from = parseDayInput(fromDay);
  const to = parseDayInput(toDay);
  if (!from && !to) return null;
  return {
    from: from ? klWallToInstant(from.y, from.m, from.d).toISOString() : null,
    to: to ? addDays(klWallToInstant(to.y, to.m, to.d), 1).toISOString() : null,
  };
}

function parseDayInput(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function addDays(date, n) {
  return new Date(date.getTime() + n * 86400000);
}

function isoRange(from, to) {
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Human summary of an applied range, for the export sheet and the toolbar. */
export function describeRange(range) {
  if (!range || (!range.from && !range.to)) return "All dates";
  const start = range.from ? fmtDateMY(range.from) : null;
  // `to` is exclusive; the last day a user would call included is the day before.
  const end = range.to ? fmtDateMY(addDays(new Date(range.to), -1)) : null;
  if (start && end) return start === end ? start : `${start} – ${end}`;
  if (start) return `From ${start}`;
  return `Up to ${end}`;
}
