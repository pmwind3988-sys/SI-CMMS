---
name: si-firestore
description: The SI CMMS Firestore database — collections, field names, enum literals, the work-order status transition matrix, security-rule write permissions, seeding, and the APK build registry. Use whenever touching Firestore in this repo: writing or reading a collection, adding a query or index, changing work_orders.status, editing firestore.rules or firestore.indexes.json, working in src/lib/ or functions/index.js, seeding or inspecting data, or recording an APK build. Also use when a Firestore call fails with permission-denied or a missing-index error.
---

# SI CMMS · Firestore

This database has 15 collections, a 5-role permission model, and an 11-state
work-order flow whose legal transitions are enforced in security rules. Field
names are snake_case and enum values are lowercase string literals — getting
one character wrong produces a `permission-denied` that says nothing useful.

**The schema is machine-readable. Do not reconstruct it from memory or from the
docs.** [app/schema/schema.js](../../../app/schema/schema.js) is the single
source of truth, derived from `firestore.rules`, `firestore.indexes.json`,
`src/lib/constants.js` and `functions/index.js`.

## Use the MCP tools first

The `si-firestore` MCP server is configured in
[.mcp.json](../../../.mcp.json) and exposes the schema directly. Prefer it over
reading files:

| Before you… | Call |
|---|---|
| write any query or document | `si_schema_overview`, then `si_describe_collection` |
| change `work_orders.status` | `si_check_transition` — **always** |
| write a document | `si_validate_document` |
| trust a field name from the docs | `si_divergences` |
| debug "is the data there?" | `si_database_status` |
| read actual data | `si_query`, `si_get_document`, `si_count` |
| answer "what build is current?" | `si_latest_apk_build` |

If the MCP server is unavailable, `require("./app/schema/schema.js")` gives the
same information; every MCP tool is a thin wrapper over that module.

All MCP tools are **read-only**. Writes go through the scripts below.

## The five things that break most often

1. **`work_orders.status` transitions are a matrix, not a free field.** No role
   may skip a status — including admin, who bypasses the rules but must not
   bypass the flow by convention. Check with `si_check_transition` before
   writing the code, not after the rule rejects it.

2. **Several transitions require a companion field on the same update.**
   `→ waiting_spare_part` needs `spare_part_reason`; `testing → repairing`
   needs `test_fail_reason`; `→ completed` needs `resolution_notes`;
   `assigned → open` (decline) needs `decline_reason`; `completed → closed`
   needs `verified_by`. Each must be a non-empty string. Omit it and the write
   fails with no explanation.

3. **A work order must be created with `status: "open"` and
   `assigned_to_id: null`.** The rules check both on create. `wo_number`,
   `sla_ack_due_at`, `sla_resolution_due_at` and `sla_breached` are stamped
   afterwards by `onWorkOrderCreate` — never set them client-side.

4. **`counters` is server-only, in both directions, for every role.** Never
   read or write it from the client. `wo_number` comes from a transaction in
   `functions/index.js`.

5. **The dashboard never scans `work_orders`.** It reads two precomputed
   documents, `stats/dashboard_cards` and `stats/dashboard_charts`, written
   only by `computeDashboardStats`. Adding a client-side aggregate query over
   `work_orders` is the wrong fix for a missing metric — extend the function.

## Roles and status flow

```
requester · technician · supervisor · manager · admin

open → assigned → accepted → on_the_way → on_site → repairing
     → waiting_spare_part ⇄ repairing → testing → completed → verified → closed

loops: assigned → open (decline) · testing → repairing (test failed)
       completed → repairing (requester says not fixed)
```

Role and `department_id` come from **Auth custom claims**, never from a
Firestore read — a rule that reads a document to check a permission adds a read
to every request forever. Keep it that way when editing rules.

Supervisor is scoped to one `department_id`. Manager and admin are system-wide.

## Reference data is real collections now

`departments`, `assets`, `technicians`, `priorities` and `sla` are seeded from
`schema.js` into actual Firestore collections. `src/lib/constants.js` still
holds the old hardcoded arrays (`DEPARTMENTS`, `EQUIPMENT`, `TECHNICIANS`,
`SLA_MATRIX`) — those are **legacy**. New code should read the collections with
`onSnapshot`. When you migrate a component off `constants.js`, note the field
renames: `EQUIPMENT.criticality` is Title Case in constants and lowercase in
`/assets`; `TECHNICIANS.load` is `current_load` in `/technicians`.

## Commands

Run from `app/`. Everything defaults to the **emulator** — reaching the live
project takes a deliberate `SI_TARGET=live` plus a service-account key.

```bash
npm run emulators        # start Firestore + Auth + Functions emulators
npm run bootstrap:users  # create the 6 seed Auth users and their claims
npm run seed:db          # seed all reference collections (idempotent)
npm run seed:db -- --dry-run
npm run seed:demo        # one demo work order with a full history trail
npm run apk:record       # record the built APK into /apk_builds
```

Seed order matters once: `bootstrap:users` before `seed:db`, so technician
documents get real Auth UIDs instead of the placeholder slugs.

## The APK build registry

`apk_builds` is written by `scripts/recordApkBuild.js`, which reads
`build.gradle`, the built `.apk`, `.next/BUILD_ID` and git — it does not accept
hand-typed version numbers. `version_code` is the ordering key, not
`version_name`. `released: false` means recorded but not offered to clients;
`min_supported_version_code` is the force-update floor.

Doc ID is `{build_type}-{version_name}-{version_code}`, so re-recording the
same build updates in place instead of duplicating.

## Adding a collection or a query

- A new query needing a composite index means editing
  `firestore.indexes.json` **and** deploying it. The missing-index error
  includes a console URL that creates the exact index — use it, then copy the
  definition into the file so it survives.
- A new collection needs three things together: a `match` block in
  `firestore.rules`, an entry in `COLLECTIONS` in `schema.js`, and any indexes.
  A collection missing from `schema.js` is invisible to every MCP tool and to
  the validator.
- Bound every array field. Never let one grow unboundedly inside a document.

## Divergences between code and docs

`docs/SI_Enterprise_Firestore_Architecture.md` disagrees with the code in
several places — most importantly `work_orders.priority` (the code writes a
literal `"P2"`; the doc specifies `priority_id` as a reference) and the
`users.role` enum (the doc still lists `hod`; the code uses `manager`).

`schema.js` follows the **code** for these, and records each decision in
`DIVERGENCES`. Call `si_divergences` before changing a field name that looks
wrong — most of them are deliberate.
