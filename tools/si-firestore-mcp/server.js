#!/usr/bin/env node
/**
 * SI — Service Inside · Firestore MCP server
 * ============================================================================
 * Gives Claude Code direct, structured access to this project's database and
 * its schema, so it stops guessing at collection and field names.
 *
 * TWO KINDS OF TOOLS:
 *
 *   Schema tools    work with no database at all. They read schema/schema.js,
 *                   which was derived from the codebase. Always available.
 *
 *   Data tools      talk to Firestore. Emulator by default; the live project
 *                   only when SI_TARGET=live plus real credentials.
 *
 * READ-ONLY BY DESIGN. There is no write tool. Seeding goes through
 * scripts/seedDatabase.js and scripts/recordApkBuild.js, which validate first
 * and print what they will do — an agent should not be able to mutate the
 * database as a side effect of answering a question about it.
 *
 * Transport: stdio, newline-delimited JSON-RPC 2.0. Implemented directly
 * rather than via @modelcontextprotocol/sdk because that package is only
 * present here as a transitive dependency of firebase-tools, and depending on
 * someone else's transitive dep is how a tool breaks on an unrelated upgrade.
 * ============================================================================
 */
const path = require("path");

const APP_DIR = path.resolve(__dirname, "..", "..", "app");
const schema = require(path.join(APP_DIR, "schema", "schema.js"));
const { validateDoc, checkTransition } = require(path.join(APP_DIR, "schema", "validate.js"));

const SERVER_NAME = "si-firestore";
const SERVER_VERSION = "1.0.0";
const DEFAULT_PROTOCOL = "2025-06-18";

/* ---------------------------------------------------------------------------
   Lazy Firestore. Schema tools must work even with no emulator running, so
   nothing connects until a data tool is actually called.
---------------------------------------------------------------------------- */
let _db = null;
function db() {
  if (_db) return _db;
  const { connect } = require(path.join(APP_DIR, "scripts", "_firebaseAdmin.js"));
  _db = connect().db;
  return _db;
}
function targetLabel() {
  const { targetLabel } = require(path.join(APP_DIR, "scripts", "_firebaseAdmin.js"));
  return targetLabel();
}

/* ---------------------------------------------------------------------------
   Firestore values → JSON. Timestamps and refs have no useful default
   serialization, and a silent [object Object] in a tool result is worse than
   a slightly verbose one.
---------------------------------------------------------------------------- */
function toJSON(v, depth = 0) {
  if (v == null) return v;
  if (depth > 12) return "<max depth>";
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  if (typeof v._latitude === "number" && typeof v._longitude === "number") {
    return { _geopoint: [v._latitude, v._longitude] };
  }
  if (v._path && typeof v.path === "string") return { _ref: v.path };
  if (Buffer.isBuffer(v)) return `<bytes:${v.length}>`;
  if (Array.isArray(v)) return v.map((x) => toJSON(x, depth + 1));
  if (typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = toJSON(val, depth + 1);
    return out;
  }
  return v;
}

/* ---------------------------------------------------------------------------
   TOOLS
---------------------------------------------------------------------------- */

const TOOLS = [
  {
    name: "si_schema_overview",
    description:
      "List every Firestore collection in the SI CMMS database with its document-ID strategy, purpose, and who may read and write it. Start here before writing any query or any document. Needs no database connection.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => {
      const lines = Object.entries(schema.COLLECTIONS).map(([name, def]) => {
        const w = def.writable || {};
        return [
          `## ${name}`,
          `${def.description}`,
          `- doc ID: ${def.docId}`,
          `- read: ${def.readable}`,
          `- create: ${(w.create || []).join(", ") || "—"} | update: ${(w.update || []).join(", ") || "—"} | delete: ${(w.delete || []).join(", ") || "—"}`,
          `- fields: ${Object.keys(def.fields || {}).length || "(shape-described, see si_describe_collection)"}`,
        ].join("\n");
      });
      return [
        `SI CMMS Firestore — ${Object.keys(schema.COLLECTIONS).length} collections.`,
        `Roles: ${schema.ROLES.join(" · ")}`,
        `Status flow: ${schema.STATUS_FLOW.join(" → ")}`,
        "",
        lines.join("\n\n"),
        "",
        "Call si_divergences before trusting any field name that appears in the docs but not in the code.",
      ].join("\n");
    },
  },

  {
    name: "si_describe_collection",
    description:
      "Full field-by-field schema for one collection: types, required/nullable, enum values, and cross-collection references. Use this before constructing a document or a query so field names and enum literals are exact.",
    inputSchema: {
      type: "object",
      properties: {
        collection: { type: "string", description: `One of: ${Object.keys(schema.COLLECTIONS).join(", ")}` },
      },
      required: ["collection"],
      additionalProperties: false,
    },
    handler: ({ collection }) => {
      const def = schema.COLLECTIONS[collection];
      if (!def) throw new Error(`Unknown collection "${collection}". Known: ${Object.keys(schema.COLLECTIONS).join(", ")}`);

      const out = [
        `# ${collection}`,
        def.description,
        "",
        `**Document ID:** ${def.docId}`,
        `**Read:** ${def.readable}`,
        `**Write:** create=${(def.writable.create || []).join(", ")} · update=${(def.writable.update || []).join(", ")} · delete=${(def.writable.delete || []).join(", ")}`,
        "",
      ];

      const fields = Object.entries(def.fields || {});
      if (fields.length) {
        out.push("| Field | Type | Required | Nullable | Enum / Ref | Note |");
        out.push("|---|---|---|---|---|---|");
        for (const [name, s] of fields) {
          const constraint = s.enum ? s.enum.join(" \\| ") : s.ref ? `→ ${s.ref}` : "";
          out.push(
            `| ${name} | ${s.type} | ${s.required ? "yes" : ""} | ${s.nullable ? "yes" : ""} | ${constraint} | ${s.note || ""} |`
          );
        }
      }
      if (def.documents) {
        out.push("", "**Fixed documents:**");
        for (const [id, shape] of Object.entries(def.documents)) {
          out.push("", `### ${collection}/${id}`, "```", JSON.stringify(shape, null, 2), "```");
        }
      }
      return out.join("\n");
    },
  },

  {
    name: "si_check_transition",
    description:
      "Answer whether a work-order status change (from → to) is permitted for a given role, and which extra fields firestore.rules requires on that same update. Use this before writing any code that changes work_orders.status — the rules reject anything outside the matrix, and the failure surfaces as an opaque permission-denied.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: `Current status. One of: ${schema.STATUS_FLOW.join(", ")}` },
        to: { type: "string", description: "Target status." },
        role: { type: "string", description: `One of: ${schema.ROLES.join(", ")}` },
      },
      required: ["from", "to", "role"],
      additionalProperties: false,
    },
    handler: ({ from, to, role }) => {
      if (!schema.ROLES.includes(role)) throw new Error(`Unknown role "${role}". Known: ${schema.ROLES.join(", ")}`);
      const r = checkTransition(from, to, role);
      return [
        `${from} → ${to} as "${role}": ${r.allowed ? "ALLOWED" : "REJECTED"}`,
        r.reason,
        r.requires.length ? `Required fields on the update: ${r.requires.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    },
  },

  {
    name: "si_validate_document",
    description:
      "Check a candidate document against the schema before writing it: missing required fields, wrong types, invalid enum literals, unknown field names, and the create-time invariants firestore.rules enforces. Returns errors and warnings. Writes nothing.",
    inputSchema: {
      type: "object",
      properties: {
        collection: { type: "string" },
        document: { type: "object", description: "The document as a plain JSON object. Timestamps as ISO strings are fine — they are checked structurally, not for exact SDK type." },
        partial: { type: "boolean", description: "True when validating an update rather than a whole new document; skips required-field checks." },
      },
      required: ["collection", "document"],
      additionalProperties: false,
    },
    handler: ({ collection, document, partial }) => {
      // ISO strings stand in for Timestamps at validation time — the caller is
      // checking field names and enums, not SDK object identity.
      const coerced = {};
      const fields = (schema.COLLECTIONS[collection] || {}).fields || {};
      for (const [k, v] of Object.entries(document)) {
        if (fields[k] && fields[k].type === "timestamp" && typeof v === "string" && !Number.isNaN(Date.parse(v))) {
          coerced[k] = new Date(v);
        } else {
          coerced[k] = v;
        }
      }
      const r = validateDoc(collection, coerced, { partial: !!partial });
      return [
        r.ok ? `VALID for ${collection}.` : `INVALID for ${collection} — ${r.errors.length} error(s).`,
        ...r.errors.map((e) => `  ✗ ${e}`),
        ...r.warnings.map((w) => `  ! ${w}`),
      ].join("\n");
    },
  },

  {
    name: "si_divergences",
    description:
      "List every place the codebase and the design docs disagree about the database — which one this schema follows, and why. Read this before 'correcting' a field name that looks wrong; several apparent bugs are deliberate, recorded decisions.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () =>
      Object.entries(schema.DIVERGENCES)
        .map(([key, d]) =>
          [`## ${key}`, `- code: ${d.code}`, `- doc:  ${d.doc}`, `- **follows: ${d.followed}**`, `- why: ${d.why}`].join("\n")
        )
        .join("\n\n"),
  },

  {
    name: "si_query",
    description:
      "Run a read-only query against a collection in the live Firestore (emulator unless SI_TARGET=live). Returns matching documents as JSON with Timestamps rendered as ISO strings. Use si_describe_collection first so field names and enum literals are right.",
    inputSchema: {
      type: "object",
      properties: {
        collection: { type: "string" },
        where: {
          type: "array",
          description: 'Filters, e.g. [["status","==","open"],["priority","in",["P1","P2"]]]. Operators: ==, !=, <, <=, >, >=, in, not-in, array-contains, array-contains-any.',
          items: { type: "array" },
        },
        orderBy: { type: "string", description: "Field to sort by." },
        direction: { type: "string", enum: ["asc", "desc"], description: "Sort direction; default asc." },
        limit: { type: "number", description: "Max documents; default 25, cap 200." },
      },
      required: ["collection"],
      additionalProperties: false,
    },
    handler: async ({ collection, where, orderBy, direction, limit }) => {
      if (!schema.COLLECTIONS[collection]) {
        throw new Error(`Unknown collection "${collection}". Known: ${Object.keys(schema.COLLECTIONS).join(", ")}`);
      }
      let q = db().collection(collection);
      for (const clause of where || []) {
        if (!Array.isArray(clause) || clause.length !== 3) {
          throw new Error(`Each where clause must be [field, op, value]; got ${JSON.stringify(clause)}`);
        }
        q = q.where(clause[0], clause[1], clause[2]);
      }
      if (orderBy) q = q.orderBy(orderBy, direction === "desc" ? "desc" : "asc");
      const n = Math.min(Math.max(Number(limit) || 25, 1), 200);
      q = q.limit(n);

      const snap = await q.get();
      const docs = snap.docs.map((d) => ({ _id: d.id, ...toJSON(d.data()) }));
      return [
        `${targetLabel()}`,
        `${collection}: ${docs.length} document(s)${docs.length === n ? ` (hit the limit of ${n} — there may be more)` : ""}`,
        "",
        JSON.stringify(docs, null, 2),
      ].join("\n");
    },
  },

  {
    name: "si_get_document",
    description: "Fetch a single document by collection and ID from the live Firestore (emulator unless SI_TARGET=live).",
    inputSchema: {
      type: "object",
      properties: { collection: { type: "string" }, id: { type: "string" } },
      required: ["collection", "id"],
      additionalProperties: false,
    },
    handler: async ({ collection, id }) => {
      const snap = await db().collection(collection).doc(id).get();
      if (!snap.exists) return `${collection}/${id} does not exist.\n(${targetLabel()})`;
      return `${targetLabel()}\n\n${JSON.stringify({ _id: snap.id, ...toJSON(snap.data()) }, null, 2)}`;
    },
  },

  {
    name: "si_count",
    description:
      "Count documents in a collection, optionally filtered — cheaper than fetching them. Useful for 'is the database seeded?' and for dashboard sanity checks against stats/dashboard_cards.",
    inputSchema: {
      type: "object",
      properties: {
        collection: { type: "string" },
        where: { type: "array", description: 'Same shape as si_query, e.g. [["status","==","open"]].', items: { type: "array" } },
      },
      required: ["collection"],
      additionalProperties: false,
    },
    handler: async ({ collection, where }) => {
      let q = db().collection(collection);
      for (const c of where || []) q = q.where(c[0], c[1], c[2]);
      const agg = await q.count().get();
      const filter = (where || []).map((c) => `${c[0]} ${c[1]} ${JSON.stringify(c[2])}`).join(" AND ");
      return `${collection}${filter ? ` where ${filter}` : ""}: ${agg.data().count}\n(${targetLabel()})`;
    },
  },

  {
    name: "si_database_status",
    description:
      "One-shot health check: which Firestore this is pointed at, whether it is reachable, and how many documents each collection holds. Run this first when anything database-related seems wrong — it distinguishes 'emulator not running' from 'not seeded' from 'genuinely empty'.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => {
      const label = targetLabel();
      const names = Object.keys(schema.COLLECTIONS);
      let counts;
      try {
        counts = await Promise.all(
          names.map(async (n) => {
            try {
              const agg = await db().collection(n).count().get();
              return [n, agg.data().count];
            } catch (e) {
              return [n, `error: ${e.message}`];
            }
          })
        );
      } catch (e) {
        return [
          `Target: ${label}`,
          `UNREACHABLE — ${e.message}`,
          "",
          "If this is the emulator, start it from app/:  npm run emulators",
          "If this is meant to be the live project, check SI_TARGET and GOOGLE_APPLICATION_CREDENTIALS.",
        ].join("\n");
      }

      // Per-collection errors are caught above so one bad collection cannot
      // hide the rest — but if EVERY collection failed, the database is down,
      // and reporting "0 documents" would be actively misleading.
      const failures = counts.filter(([, c]) => typeof c !== "number");
      if (failures.length === counts.length) {
        const reason = String(failures[0][1]).replace(/^error:\s*/, "");
        return [
          `Target: ${label}`,
          `UNREACHABLE — every collection failed. First error: ${reason}`,
          "",
          "If this is the emulator, start it from app/:  npm run emulators",
          "If this is meant to be the live project, check SI_TARGET and GOOGLE_APPLICATION_CREDENTIALS.",
        ].join("\n");
      }

      const total = counts.reduce((s, [, c]) => s + (typeof c === "number" ? c : 0), 0);
      const lines = counts.map(([n, c]) => `  ${n.padEnd(20)} ${c}`);
      const refSeeded = ["departments", "assets", "priorities", "sla", "plants"].every(
        (n) => typeof (counts.find(([x]) => x === n) || [])[1] === "number" && counts.find(([x]) => x === n)[1] > 0
      );

      return [
        `Target: ${label}`,
        `Reachable. ${total} document(s) total.`,
        "",
        ...lines,
        "",
        refSeeded
          ? "Reference data is seeded."
          : 'Reference data is missing or partial — run "npm run seed:db" from app/.',
      ].join("\n");
    },
  },

  {
    name: "si_latest_apk_build",
    description:
      "The most recent APK build in the /apk_builds registry — version, code, git sha, size, hash, and whether it is released. Use to answer 'what is the current build?' and 'is this APK current?'.",
    inputSchema: {
      type: "object",
      properties: {
        build_type: { type: "string", enum: schema.BUILD_TYPES, description: "Filter to debug or release; omit for either." },
        released_only: { type: "boolean", description: "Only builds marked released:true." },
      },
      additionalProperties: false,
    },
    handler: async ({ build_type, released_only }) => {
      let q = db().collection("apk_builds");
      if (released_only) q = q.where("released", "==", true);
      if (build_type) q = q.where("build_type", "==", build_type);
      const snap = await q.orderBy("version_code", "desc").limit(5).get();

      if (snap.empty) {
        return [
          `No matching builds in /apk_builds. (${targetLabel()})`,
          "",
          'Record one from app/:  npm run apk  &&  npm run apk:record',
        ].join("\n");
      }
      const docs = snap.docs.map((d) => ({ _id: d.id, ...toJSON(d.data()) }));
      return `${targetLabel()}\n\nMost recent ${docs.length}:\n\n${JSON.stringify(docs, null, 2)}`;
    },
  },
];

const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

/* ---------------------------------------------------------------------------
   JSON-RPC over stdio
---------------------------------------------------------------------------- */

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;

  // Notifications carry no id and must never be answered.
  if (id === undefined || id === null) return;

  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: (params && params.protocolVersion) || DEFAULT_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions:
          "Schema and database tools for the SI CMMS Firestore. Call si_schema_overview before writing any query or document, and si_check_transition before any code that changes work_orders.status. Read-only: no tool here writes to Firestore.",
      });

    case "ping":
      return reply(id, {});

    case "tools/list":
      return reply(
        id,
        { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }
      );

    case "tools/call": {
      const tool = TOOL_BY_NAME[(params || {}).name];
      if (!tool) return replyError(id, -32602, `Unknown tool: ${(params || {}).name}`);
      try {
        const text = await tool.handler((params && params.arguments) || {});
        return reply(id, { content: [{ type: "text", text: String(text) }] });
      } catch (e) {
        // Tool failures are results, not protocol errors — the model should see
        // the message and adjust rather than have the call vanish.
        return reply(id, { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
      }
    }

    default:
      return replyError(id, -32601, `Method not found: ${method}`);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    Promise.resolve(handle(msg)).catch((e) => {
      if (msg && msg.id != null) replyError(msg.id, -32603, e.message);
    });
  }
});

process.stdin.on("end", () => process.exit(0));
// stdout is the protocol channel — anything written to it that is not JSON-RPC
// corrupts the stream, so diagnostics go to stderr only.
process.on("uncaughtException", (e) => {
  process.stderr.write(`[si-firestore-mcp] uncaught: ${e.stack || e.message}\n`);
});
