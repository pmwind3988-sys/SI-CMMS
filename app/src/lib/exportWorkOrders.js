"use client";

/**
 * SI — Service Inside · Work order export
 *
 * The whole record of a work order, from the form that raised it to the moment
 * it closed, as a four-sheet Excel workbook.
 *
 * Shape of this module, and why:
 *
 *   - Everything above `downloadWorkbook()` is PURE. It takes plain data and
 *     returns plain arrays, imports nothing but lib/datetime, and touches no
 *     browser API. That is what makes the column set and the humanising
 *     testable in Node against fixtures, which is the only test this repo can
 *     run — there is no test runner in the browser.
 *   - `write-excel-file` is imported DYNAMICALLY, inside the download function.
 *     It is about 200KB and the overwhelming majority of sessions never press
 *     Export, so a static import would put it in the first chunk every user
 *     downloads on every visit.
 *   - Reference-data lookups arrive as a `labels` argument rather than through
 *     useReferenceData(), so nothing here depends on React. The caller is the
 *     component that already holds the context.
 *
 * On readability, which was the point of the exercise. Nothing in the workbook
 * is a raw enum, a bare boolean or an unlabelled number:
 *
 *   status "on_the_way"                  -> "On The Way"
 *   priority "P1"                        -> "P1 — Critical"
 *   safety_risk {flag: true, severity}   -> "Yes" + "High" in its own column
 *   sla_breached true                    -> "Breached" (not TRUE)
 *   est_downtime_value 2, unit "days"    -> 2 in a number column, "Days" beside it
 *   null                                 -> "—"
 *
 * Timestamps are real Excel date cells rather than strings, so the columns sort
 * and filter as dates — shifted to Kuala Lumpur wall-clock time by
 * toExcelDate(), because an Excel serial carries no timezone and would otherwise
 * display UTC. See lib/datetime.js.
 */

import {
  fmtDateTimeMY,
  toExcelDate,
  isoDateMY,
  describeRange,
  EXCEL_DATETIME_FORMAT,
  MY_TIMEZONE,
} from "./datetime";

const DASH = "—";

/* ------------------------------------------------------------------
   Humanising
-------------------------------------------------------------------*/

const yesNo = (v) => (v ? "Yes" : "No");
const orDash = (v) => (v === null || v === undefined || v === "" ? DASH : v);

/** A real Excel date cell, or an empty one. */
function dateCell(ts) {
  const value = toExcelDate(ts);
  if (!value) return null;
  return { value, type: Date, format: EXCEL_DATETIME_FORMAT };
}

/** A number cell, or an empty one. Never the string "0" for a missing value. */
function numCell(n, decimals = 0) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return null;
  const rounded = Number(Number(n).toFixed(decimals));
  return { value: rounded, type: Number, format: decimals > 0 ? `0.${"0".repeat(decimals)}` : "0" };
}

const textCell = (v) => ({ value: String(orDash(v)), type: String });
const wrapCell = (v) => ({ value: String(orDash(v)), type: String, wrap: true, alignVertical: "top" });

const HEADER_CELL = {
  fontWeight: "bold",
  backgroundColor: "#1E293B",
  textColor: "#FFFFFF",
  align: "left",
  alignVertical: "center",
  wrap: true,
};

/** Minutes between two timestamps, or null if either is missing. */
function minutesBetween(from, to) {
  if (!from || !to) return null;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return (b - a) / 60000;
}

const hours = (mins) => (mins === null ? null : mins / 60);

/* ------------------------------------------------------------------
   The lifecycle, reconstructed from the audit trail
-------------------------------------------------------------------*/

/**
 * The statuses that get a timestamp column, in workflow order.
 *
 * `verified` is included even though it is never a resting state — the flow goes
 * completed -> closed in one move and records `verified` as a via-status (see
 * verifyAndClose in lib/workOrders). The history row is the only place that
 * moment exists, which is exactly why the lifecycle is read from history rather
 * than from the work order's own columns.
 */
const LIFECYCLE = [
  ["assigned", "Assigned At"],
  ["accepted", "Accepted At"],
  ["on_the_way", "En Route At"],
  ["on_site", "On Site At"],
  ["repairing", "Repair Started At"],
  ["waiting_spare_part", "Waiting Spare Part At"],
  ["testing", "Testing At"],
  ["completed", "Completed At"],
  ["verified", "Verified At"],
  ["closed", "Closed At"],
];

/**
 * work order id -> what its trail says.
 *
 * FIRST occurrence of each status, deliberately. A real trail is not monotonic:
 * WO-2026-000003 in this project carries six `assigned` rows from repeated
 * reassignment and one `accepted -> assigned` step going backwards. "When did
 * this work order first reach this stage" is the question a lifecycle column
 * answers; "who holds it now" is what assigned_to_name is for.
 */
export function indexHistory(historyRows) {
  const byWo = new Map();
  // Ascending, so the first row seen for a status IS the first occurrence.
  const sorted = [...(historyRows || [])].sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at)
  );

  for (const row of sorted) {
    let entry = byWo.get(row.work_order_id);
    if (!entry) {
      entry = { firstAt: {}, actorFor: {}, assignedCount: 0, rows: [] };
      byWo.set(row.work_order_id, entry);
    }
    if (!(row.to_status in entry.firstAt)) {
      entry.firstAt[row.to_status] = row.created_at;
      entry.actorFor[row.to_status] = row.actor_name;
    }
    if (row.to_status === "assigned") entry.assignedCount += 1;
    entry.rows.push(row);
  }
  return byWo;
}

/** work order id -> count, for the polymorphic child tables. */
export function countByEntity(rows) {
  const counts = new Map();
  for (const r of rows || []) {
    const key = r.entity_id ?? r.work_order_id;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/* ------------------------------------------------------------------
   Sheet 1 — Work Orders
-------------------------------------------------------------------*/

/**
 * One column definition per spreadsheet column: header, width, and how to get
 * the cell. Declarative so the header and the value can never drift apart, which
 * is the usual way a wide export starts reporting the wrong field under the
 * right title.
 */
function workOrderColumns(labels, ctx) {
  const L = labels || {};
  const label = (fn, v, fallback = DASH) => (typeof L[fn] === "function" ? L[fn](v) : v ?? fallback);

  /** "P1 — Critical", falling back to whatever half is available. */
  const priorityText = (w) => {
    if (!w.priority) return DASH;
    const name = label("priorityLabel", w.priority, null);
    return name && name !== w.priority ? `${w.priority} — ${name}` : w.priority;
  };

  const severityText = (w) => {
    const code = w.safety_risk?.severity;
    if (!code) return DASH;
    const row = typeof L.severityByCode === "function" ? L.severityByCode(code) : null;
    return row?.label || code;
  };

  const assetCode = (w) => {
    const asset = typeof L.assetById === "function" ? L.assetById(w.asset_id) : null;
    return asset?.asset_code || w.asset_id || DASH;
  };

  const trail = (w) => ctx.history.get(w.id);
  const firstAt = (w, status) => trail(w)?.firstAt?.[status] ?? null;

  const cols = [
    // ---- Identity ----
    { header: "WO Number", width: 18, cell: (w) => ({ ...textCell(w.wo_number || "Pending…"), fontWeight: "bold" }) },
    { header: "Status", width: 16, cell: (w) => textCell(label("statusLabel", w.status)) },
    { header: "Priority", width: 18, cell: (w) => textCell(priorityText(w)) },
    // A fixture's work order is still in the file, flagged rather than dropped:
    // an export is a record, and silently omitting rows from a record is worse
    // than a column Excel's autofilter clears in one click. See migration 0034.
    { header: "Test Data", width: 11, cell: (w) => textCell(yesNo(w.is_test_data)) },

    // ---- What the form captured ----
    { header: "Date Raised", width: 21, cell: (w) => dateCell(w.created_at) },
    { header: "Raised By", width: 18, cell: (w) => textCell(w.requester_name) },
    { header: "Contact Phone", width: 16, cell: (w) => textCell(w.requester_phone) },
    { header: "Department", width: 18, cell: (w) => textCell(label("departmentName", w.department_id)) },
    { header: "Equipment", width: 24, cell: (w) => textCell(w.asset_name || label("assetName", w.asset_id)) },
    { header: "Equipment Code", width: 16, cell: (w) => textCell(assetCode(w)) },
    { header: "Area / Location", width: 20, cell: (w) => textCell(w.area) },
    { header: "Work Order Type", width: 16, cell: (w) => textCell(label("typeLabel", w.type)) },
    { header: "Description", width: 50, cell: (w) => wrapCell(w.description) },
    { header: "Production Impact", width: 20, cell: (w) => textCell(label("impactLabel", w.impact)) },
    { header: "Est. Downtime", width: 14, cell: (w) => numCell(w.est_downtime_value, 2) },
    { header: "Downtime Unit", width: 14, cell: (w) => textCell(titleCase(w.est_downtime_unit)) },
    { header: "Safety Risk", width: 12, cell: (w) => textCell(yesNo(w.safety_risk?.flag)) },
    { header: "Safety Severity", width: 16, cell: (w) => textCell(severityText(w)) },
    { header: "Permit Required", width: 15, cell: (w) => textCell(yesNo(w.permit_required)) },
    { header: "Environmental Risk", width: 17, cell: (w) => textCell(yesNo(w.environmental_risk?.flag)) },
    { header: "Priority Overridden", width: 17, cell: (w) => textCell(yesNo(w.priority_touched)) },

    // ---- Assignment ----
    { header: "Assigned To", width: 18, cell: (w) => textCell(w.assigned_to_name || "Unassigned") },
    { header: "Times Assigned", width: 14, cell: (w) => numCell(trail(w)?.assignedCount ?? 0) },
    { header: "Times Declined", width: 14, cell: (w) => numCell(w.decline_count ?? 0) },
    { header: "Decline Reason", width: 34, cell: (w) => wrapCell(w.decline_reason) },

    // ---- SLA ----
    { header: "Ack Due", width: 21, cell: (w) => dateCell(w.sla_ack_due_at) },
    { header: "Resolution Due", width: 21, cell: (w) => dateCell(w.sla_resolution_due_at) },
    { header: "SLA Status", width: 16, cell: (w) => textCell(w.sla_breached ? "Breached" : "Within target") },
    { header: "SLA Warning Sent", width: 16, cell: (w) => textCell(yesNo(w.sla_warning_sent)) },
  ];

  // ---- Lifecycle, from the audit trail ----
  for (const [status, header] of LIFECYCLE) {
    cols.push({ header, width: 21, cell: (w) => dateCell(firstAt(w, status)) });
  }

  cols.push(
    // ---- Resolution ----
    { header: "Spare Part Reason", width: 34, cell: (w) => wrapCell(w.spare_part_reason) },
    { header: "Test Failure Reason", width: 34, cell: (w) => wrapCell(w.test_fail_reason) },
    { header: "Resolution Notes", width: 50, cell: (w) => wrapCell(w.resolution_notes) },
    { header: "Reopen Reason", width: 34, cell: (w) => wrapCell(w.reopen_reason) },
    // verified_by is a uuid, and the name is not on the work order. The trail
    // has it: whoever performed the `verified` step.
    { header: "Verified By", width: 18, cell: (w) => textCell(trail(w)?.actorFor?.verified) },

    // ---- Derived durations. Hours as numbers, unit in the header, so they
    //      pivot and average instead of being text that looks like a number. ----
    {
      header: "Response (hours)",
      width: 15,
      cell: (w) => numCell(hours(minutesBetween(w.created_at, firstAt(w, "accepted"))), 1),
    },
    {
      header: "Repair (hours)",
      width: 15,
      cell: (w) => numCell(hours(minutesBetween(firstAt(w, "repairing"), firstAt(w, "completed"))), 1),
    },
    {
      header: "Total Resolution (hours)",
      width: 18,
      cell: (w) => numCell(hours(minutesBetween(w.created_at, w.closed_at ?? firstAt(w, "closed"))), 1),
    },

    // ---- Meta ----
    { header: "Comments", width: 11, cell: (w) => numCell(ctx.commentCounts.get(w.id) ?? 0) },
    // A count rather than a sheet of links: attachments live in a private bucket
    // behind one-hour signed URLs (migration 0005), so any URL written into a
    // saved workbook is dead by the time anyone opens it. The count says "go
    // look in the app", which is the only truthful thing a file can say.
    { header: "Attachments", width: 12, cell: (w) => numCell(ctx.attachmentCounts.get(w.id) ?? 0) },
    { header: "Last Updated", width: 21, cell: (w) => dateCell(w.updated_at) }
  );

  return cols;
}

function titleCase(v) {
  if (!v) return DASH;
  return String(v)
    .split(/[\s_]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

/* ------------------------------------------------------------------
   Sheets 2 and 3 — the trail and the conversation
-------------------------------------------------------------------*/

function historyColumns(labels, woNumberOf) {
  const L = labels || {};
  const statusText = (code) =>
    code ? (typeof L.statusLabel === "function" ? L.statusLabel(code) : code) : DASH;
  return [
    { header: "WO Number", width: 18, cell: (h) => textCell(woNumberOf(h.work_order_id)) },
    { header: "When", width: 21, cell: (h) => dateCell(h.created_at) },
    { header: "From Status", width: 18, cell: (h) => textCell(statusText(h.from_status)) },
    { header: "To Status", width: 18, cell: (h) => textCell(statusText(h.to_status)) },
    { header: "By", width: 18, cell: (h) => textCell(h.actor_name) },
    // actor_role is "the role acted under", not the account's identity — a
    // Supervisor+Technician acting on someone else's job records `supervisor`
    // (migration 0020).
    { header: "Acting As", width: 14, cell: (h) => textCell(titleCase(h.actor_role)) },
    { header: "Remarks", width: 56, cell: (h) => wrapCell(h.remarks) },
  ];
}

function commentColumns(woNumberOf) {
  return [
    { header: "WO Number", width: 18, cell: (c) => textCell(woNumberOf(c.entity_id)) },
    { header: "When", width: 21, cell: (c) => dateCell(c.created_at) },
    { header: "Author", width: 18, cell: (c) => textCell(c.author_name) },
    { header: "Acting As", width: 14, cell: (c) => textCell(titleCase(c.author_role)) },
    { header: "Comment", width: 64, cell: (c) => wrapCell(c.text) },
    { header: "Edited At", width: 21, cell: (c) => dateCell(c.edited_at) },
  ];
}

/* ------------------------------------------------------------------
   Assembly
-------------------------------------------------------------------*/

function rowsFromColumns(objects, columns) {
  const header = columns.map((c) => ({ value: c.header, type: String, ...HEADER_CELL }));
  return [header, ...objects.map((o, i) => columns.map((c) => c.cell(o, i)))];
}

const widths = (columns) => columns.map((c) => ({ width: c.width }));

/**
 * The whole workbook, as the array write-excel-file's multi-sheet form takes.
 *
 * Pure: no browser API, no React, no network. `generatedAt` is a parameter
 * rather than `new Date()` so a test can pin it.
 */
export function buildWorkbook({
  workOrders = [],
  history = [],
  comments = [],
  attachments = [],
  labels = {},
  range = null,
  filterSummary = null,
  generatedAt = new Date(),
  scopeNote = null,
} = {}) {
  const ctx = {
    history: indexHistory(history),
    commentCounts: countByEntity(comments),
    attachmentCounts: countByEntity(attachments),
  };

  const woNumberById = new Map(workOrders.map((w) => [w.id, w.wo_number || "Pending…"]));
  const woNumberOf = (id) => woNumberById.get(id) || DASH;

  const woCols = workOrderColumns(labels, ctx);
  const hCols = historyColumns(labels, woNumberOf);
  const cCols = commentColumns(woNumberOf);

  // Newest first, matching the list the export was taken from.
  const orderedWos = [...workOrders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const orderedHistory = [...history].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const orderedComments = [...comments].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const info = [
    ["SI — Service Inside · Work Order Export", ""],
    ["", ""],
    ["Generated", fmtDateTimeMY(generatedAt)],
    ["Time zone", `${MY_TIMEZONE} (all dates and times in this file)`],
    ["Date range (raised)", describeRange(range)],
    ["Filters", filterSummary || "None"],
    ["Work orders", workOrders.length],
    ["Status history rows", history.length],
    ["Comments", comments.length],
    ["", ""],
    ["Scope", scopeNote || "Only work orders your role is permitted to see are included."],
    [
      "Test data",
      "Rows raised by a test fixture are included and marked Yes in the Test Data column. " +
        "They are excluded from the dashboard statistics.",
    ],
  ].map(([k, v]) => [
    { value: String(k), type: String, fontWeight: "bold" },
    typeof v === "number" ? { value: v, type: Number, format: "0" } : { value: String(v), type: String, wrap: true },
  ]);

  return [
    {
      sheet: "Work Orders",
      data: rowsFromColumns(orderedWos, woCols),
      columns: widths(woCols),
      stickyRowsCount: 1,
      // The first four columns identify the row; keeping them in view is what
      // makes a fifty-column sheet navigable.
      stickyColumnsCount: 1,
    },
    {
      sheet: "Status History",
      data: rowsFromColumns(orderedHistory, hCols),
      columns: widths(hCols),
      stickyRowsCount: 1,
    },
    {
      sheet: "Comments",
      data: rowsFromColumns(orderedComments, cCols),
      columns: widths(cCols),
      stickyRowsCount: 1,
    },
    {
      sheet: "Export Info",
      data: info,
      columns: [{ width: 24 }, { width: 82 }],
    },
  ];
}

/** `SI-Work-Orders_2026-08-01_to_2026-08-31.xlsx` */
export function exportFileName(range, generatedAt = new Date()) {
  if (range?.from && range?.to) {
    // `to` is exclusive; name the file after the last day actually included.
    const lastDay = new Date(new Date(range.to).getTime() - 86400000);
    const from = isoDateMY(range.from);
    const to = isoDateMY(lastDay);
    return from === to ? `SI-Work-Orders_${from}.xlsx` : `SI-Work-Orders_${from}_to_${to}.xlsx`;
  }
  return `SI-Work-Orders_${isoDateMY(generatedAt)}.xlsx`;
}

/* ------------------------------------------------------------------
   The browser half
-------------------------------------------------------------------*/

/**
 * Build and hand the file to the browser.
 *
 * The import is dynamic for weight (see the module header). Everything it needs
 * has already been computed by buildWorkbook, so a failure here is a failure to
 * load a chunk, not a failure to shape the data.
 *
 * `.toFile(name)` is write-excel-file v4's API and it is what triggers the save
 * dialog. v3 took `{ fileName }` as an option instead and returned nothing; that
 * call still "succeeds" against v4 and writes no file at all, silently, which is
 * how this was written the first time.
 */
export async function downloadWorkOrderExport(args) {
  const sheets = buildWorkbook(args);
  const fileName = exportFileName(args?.range, args?.generatedAt ?? new Date());
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  await writeXlsxFile(sheets).toFile(fileName);
  return { fileName, rows: args?.workOrders?.length ?? 0 };
}
