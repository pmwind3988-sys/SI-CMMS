/**
 * SI — Service Inside · Which phase of the job a file documents
 *
 * `attachments.wo_status` records the work order's status at the moment a file
 * was uploaded (migration 0039), stamped by a trigger rather than sent by the
 * browser. Eleven statuses is too many headings to be useful, so this maps them
 * onto the four moments a photo of a fault is actually taken in: before anyone
 * touched it, while it was being worked on, while it was being tested, and
 * after it was called done.
 *
 * Pure — no React, no Supabase — so it can be read by the panel today and by
 * the export later without either one owning the definition.
 *
 * The map is written against status CODES, which are enum values and therefore
 * fixed, rather than against labels, which an Administrator can rename in
 * Settings at any time.
 */

/**
 * Ordered. `null` is first deliberately: those rows are the oldest in the
 * table, and "we did not record this" belongs above the phases rather than
 * mixed among them.
 *
 * `key: null` is the bucket for a file uploaded before 0039 added the column,
 * and for any attachment on something other than a work order — the trigger
 * leaves wo_status null there rather than inventing a meaning for it.
 */
export const ATTACHMENT_PHASES = [
  {
    key: null,
    label: "Uploaded earlier",
    note: "Added before the app started recording which stage a photo was taken at.",
    statuses: [],
  },
  {
    key: "before",
    label: "Before work",
    note: "Taken while the fault was reported and waiting — nobody had started on it yet.",
    statuses: ["open", "assigned", "accepted"],
  },
  {
    key: "during",
    label: "During repair",
    note: "Taken while the job was being worked on, including any wait for a part.",
    statuses: ["repairing", "waiting_spare_part"],
  },
  {
    key: "testing",
    label: "Testing",
    note: "Taken while the repair was being checked.",
    statuses: ["testing"],
  },
  {
    key: "after",
    label: "After completion",
    note: "Taken once the job was called done.",
    statuses: ["completed", "verified", "closed"],
  },
];

const BY_STATUS = new Map();
for (const phase of ATTACHMENT_PHASES) {
  for (const s of phase.statuses) BY_STATUS.set(s, phase);
}

/**
 * The phase a `wo_status` belongs to. An unrecognised code falls through to the
 * "Uploaded earlier" bucket rather than throwing — the same fail-soft direction
 * every lookup in referenceData.js takes, and the reason it matters here is
 * that a status added by a future migration would otherwise make a photo
 * disappear from a panel rather than merely land under a vague heading.
 */
export function phaseForStatus(woStatus) {
  return BY_STATUS.get(woStatus) ?? ATTACHMENT_PHASES[0];
}

/**
 * Split a list of attachments into the ordered phases, dropping the empties.
 *
 * Returns `[{ phase, items }]`. Callers render the heading from `phase.label`
 * and are expected to render nothing at all when the array is empty, which is
 * what a work order with no photos should look like.
 */
export function groupByPhase(attachments) {
  const buckets = new Map(ATTACHMENT_PHASES.map((p) => [p, []]));
  for (const a of attachments || []) buckets.get(phaseForStatus(a.wo_status)).push(a);
  return ATTACHMENT_PHASES.filter((p) => buckets.get(p).length > 0).map((phase) => ({
    phase,
    items: buckets.get(phase),
  }));
}
