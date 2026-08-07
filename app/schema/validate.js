/**
 * SI — Service Inside · Schema validation
 * ============================================================================
 * Checks a plain object against a collection definition in schema.js.
 *
 * Deliberately NOT a general-purpose validator. It answers one question:
 * "would this document be wrong in a way the app or the security rules would
 * later trip over?" Unknown fields are reported as warnings rather than
 * errors, because Firestore is schemaless and a document carrying an extra
 * field is legal — just usually a typo.
 * ============================================================================
 */
const { COLLECTIONS, STATUS_TRANSITIONS, STATUS_FLOW, REASSIGNABLE_STATUSES } = require("./schema");

/** Timestamp-ish: an Admin SDK Timestamp, a Date, or a server-timestamp sentinel. */
function isTimestampLike(v) {
  if (v == null) return false;
  if (v instanceof Date) return true;
  if (typeof v.toMillis === "function") return true;
  if (typeof v.toDate === "function") return true;
  // FieldValue.serverTimestamp() sentinel — no public shape, so identify it
  // structurally rather than by instanceof (which crosses a module boundary).
  const c = v.constructor && v.constructor.name;
  return c === "FieldValue" || c === "ServerTimestampTransform" || c === "Timestamp";
}

function typeMatches(type, v) {
  switch (type) {
    case "string":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "boolean":
      return typeof v === "boolean";
    case "timestamp":
      return isTimestampLike(v);
    case "map":
      return typeof v === "object" && v !== null && !Array.isArray(v) && !isTimestampLike(v);
    case "array<string>":
      return Array.isArray(v) && v.every((x) => typeof x === "string");
    case "array<map>":
      return Array.isArray(v) && v.every((x) => typeof x === "object" && x !== null);
    default:
      return true; // unknown declared type — don't invent a failure
  }
}

/**
 * @param {string} collection
 * @param {object} data
 * @param {{ partial?: boolean }} [opts] partial:true skips required-field
 *        checks, for validating an update rather than a whole document.
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
function validateDoc(collection, data, opts = {}) {
  const errors = [];
  const warnings = [];
  const def = COLLECTIONS[collection];

  if (!def) {
    return { ok: false, errors: [`Unknown collection "${collection}". Known: ${Object.keys(COLLECTIONS).join(", ")}`], warnings };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, errors: ["Document must be a plain object."], warnings };
  }

  const fields = def.fields || {};
  const known = Object.keys(fields);

  // stats has no per-field schema — its two documents are described by shape,
  // not by a field table. Skip field checking rather than reporting every key.
  if (known.length === 0) {
    return { ok: true, errors, warnings };
  }

  for (const [name, spec] of Object.entries(fields)) {
    const present = Object.prototype.hasOwnProperty.call(data, name);
    const v = data[name];

    if (!present) {
      if (spec.required && !opts.partial) errors.push(`Missing required field "${name}" (${spec.type}).`);
      continue;
    }
    if (v === null) {
      if (!spec.nullable) errors.push(`Field "${name}" is null but is not declared nullable.`);
      continue;
    }
    if (!typeMatches(spec.type, v)) {
      errors.push(`Field "${name}" should be ${spec.type}, got ${Array.isArray(v) ? "array" : typeof v}.`);
      continue;
    }
    if (spec.enum && !spec.enum.includes(v)) {
      errors.push(`Field "${name}" = ${JSON.stringify(v)} is not one of: ${spec.enum.join(", ")}.`);
    }
  }

  for (const name of Object.keys(data)) {
    if (!known.includes(name)) warnings.push(`Field "${name}" is not in the schema for ${collection} — typo, or schema.js needs updating.`);
  }

  // ---- collection-specific invariants the rules will otherwise enforce for us,
  // ---- painfully, at write time.
  if (collection === "work_orders" && !opts.partial) {
    if (data.status === "open" && data.assigned_to_id != null) {
      errors.push('A work order with status "open" must have assigned_to_id === null — firestore.rules rejects the create otherwise.');
    }
  }

  if (collection === "apk_builds") {
    const { APP } = require("./schema");
    if (data.application_id != null && data.application_id !== APP.application_id) {
      errors.push(`application_id "${data.application_id}" does not match the built app id "${APP.application_id}".`);
    }
    if (typeof data.version_code === "number" && !Number.isInteger(data.version_code)) {
      errors.push("version_code must be an integer — Android requires it.");
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Is (from → to) a transition this role is allowed to perform?
 * Mirrors firestore.rules. admin bypasses the matrix entirely.
 *
 * @returns {{ allowed: boolean, reason: string, requires: string[] }}
 */
function checkTransition(fromStatus, toStatus, role) {
  if (role === "admin") {
    return { allowed: true, reason: "admin bypasses the transition matrix (break-glass; use sparingly).", requires: [] };
  }
  if (!STATUS_FLOW.includes(fromStatus)) {
    return { allowed: false, reason: `"${fromStatus}" is not a known status.`, requires: [] };
  }
  if (!STATUS_FLOW.includes(toStatus)) {
    return { allowed: false, reason: `"${toStatus}" is not a known status.`, requires: [] };
  }

  if (fromStatus === toStatus) {
    if (REASSIGNABLE_STATUSES.includes(fromStatus) && ["supervisor", "manager"].includes(role)) {
      return {
        allowed: true,
        reason: `Reassignment in place: status stays "${fromStatus}", only assigned_to_id changes (and it must differ from the current value).`,
        requires: ["assigned_to_id"],
      };
    }
    return { allowed: false, reason: `No-op transition on "${fromStatus}" is not permitted for role "${role}".`, requires: [] };
  }

  const match = STATUS_TRANSITIONS.find((t) => t.from === fromStatus && t.to === toStatus);
  if (!match) {
    const legal = STATUS_TRANSITIONS.filter((t) => t.from === fromStatus).map((t) => t.to);
    return {
      allowed: false,
      reason: `${fromStatus} → ${toStatus} is not in the transition matrix. From "${fromStatus}" the only legal next statuses are: ${legal.join(", ") || "(none)"}.`,
      requires: [],
    };
  }
  if (!match.roles.includes(role)) {
    return {
      allowed: false,
      reason: `${fromStatus} → ${toStatus} is legal, but only for: ${match.roles.join(", ")}. Role "${role}" cannot perform it.`,
      requires: match.requires,
    };
  }
  return {
    allowed: true,
    reason: match.requires.length
      ? `Allowed. The rules also require these fields to be set and non-empty on the same update: ${match.requires.join(", ")}.`
      : "Allowed.",
    requires: match.requires,
  };
}

module.exports = { validateDoc, checkTransition, isTimestampLike };
