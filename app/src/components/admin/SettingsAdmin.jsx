"use client";

/**
 * SI — Service Inside · Administration · Settings
 *
 * Every value that used to be hardcoded in src/lib/constants.js, editable here.
 *
 * Two kinds of table, and the difference is deliberate rather than cosmetic:
 *
 *   Lookup tables (statuses, priorities, impact levels, types, severities) are
 *   keyed on a Postgres enum. Their rows describe values the schema already
 *   accepts, so they can be relabelled and recoloured but not added to.
 *   Migration 0009 grants UPDATE only, so the database enforces this too.
 *
 *   Operational records (departments, equipment) are real business data. Those
 *   can be added.
 *
 * A third operation cuts across both, and is a Superuser's alone (migration
 * 0031): RETIRING a row. The row stays, so every work order that already
 * references it keeps its label and its colour forever; it just stops being
 * offered for new work. That is the answer for taking a priority or a department
 * out of use, and it is reversible.
 *
 * Removing a row outright is the rarer one, and only possible while nothing has
 * ever referenced it — the mistyped department, essentially. Anything else is
 * refused by si_guard_reference_delete() with a sentence naming what still
 * points at it, which is shown as-is because describeError() surfaces server
 * messages verbatim.
 *
 * Statuses, SLA targets and Permissions have neither, deliberately: nobody picks
 * a status (the workflow moves through them), an SLA row belongs to its priority
 * rather than standing on its own, and a permission is already a switch.
 *
 * Edits reach every open session over Realtime, so a colour change shows up on a
 * supervisor's board without them reloading.
 */
import { useEffect, useMemo, useState, useRef } from "react";
import {
  Check,
  X,
  Pencil,
  Plus,
  Trash2,
  Loader2,
  Info,
  ShieldAlert,
  Lock,
  Archive,
  RotateCcw,
} from "lucide-react";
import {
  useReferenceData,
  updateReferenceRow,
  setReferenceRowActive,
  deleteReferenceRow,
  isRetired,
} from "../../lib/referenceData";
import {
  upsertDepartment,
  upsertAsset,
  updateSlaTargets,
  updatePriority,
  setRolePermission,
} from "../../lib/admin";
import { describeError } from "../../lib/errors";
import { useAuth } from "../../context/AuthContext";
import {
  canEditRolePermissions,
  canRetireReferenceData,
  canRemoveReferenceRow,
} from "../../lib/constants";
import { ALL_ROLES, ROLE_LABELS } from "../../lib/roles";
import Button from "../ui/Button";
import Field, { inputClass } from "../ui/Field";
import { Card, ErrorBanner, Toast, ModalOverlay } from "../ui/Surfaces";
import { usePaged, useAutoPageSize, PagerFooter } from "../ui/Paged";

const TABS = [
  { key: "statuses", label: "Statuses" },
  { key: "priorities", label: "Priorities" },
  { key: "sla", label: "SLA targets" },
  { key: "impacts", label: "Impact levels" },
  { key: "types", label: "Work order types" },
  { key: "severities", label: "Safety severities" },
  { key: "departments", label: "Departments" },
  { key: "assets", label: "Equipment" },
  { key: "permissions", label: "Permissions" },
];

export default function SettingsAdmin() {
  const ref = useReferenceData();
  const [tab, setTab] = useState("statuses");
  const tabStripRef = useRef(null);

  /* The selected tab can sit off-screen on a phone — nine of them need about
     900px — so it is scrolled back into view whenever it changes. */
  useEffect(() => {
    tabStripRef.current
      ?.querySelector(`[data-tab="${tab}"]`)
      ?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [tab]);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  function flash(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }
  function fail(e, fallback) {
    setError(describeError(e, fallback));
  }

  /* Built from every row rather than the active ones. These drive the "Suggests"
     and "Caps at" columns, which are foreign keys onto priorities and stay valid
     after a retirement — and a row whose current value had dropped out of its own
     <select> would show the raw code, or worse, be silently rewritten to the
     first remaining option on the next save. Same for equipment sitting in a
     retired department. The suffix is so the pairing is not invisible. */
  const priorityOptions = useMemo(
    () =>
      ref.priorities.map((p) => ({
        value: p.id,
        label: `${p.id} — ${p.label}${isRetired("priorities", p) ? " (retired)" : ""}`,
      })),
    [ref.priorities]
  );
  const departmentOptions = useMemo(
    () =>
      ref.departments.map((d) => ({
        value: d.id,
        label: `${d.name}${isRetired("departments", d) ? " (retired)" : ""}`,
      })),
    [ref.departments]
  );
  /* The add-equipment dialog is the exception: that is a choice for something
     new, so it offers only what is still in use. */
  const activeDepartmentOptions = useMemo(
    () => ref.activeDepartments.map((d) => ({ value: d.id, label: d.name })),
    [ref.activeDepartments]
  );

  return (
    <div className="max-w-6xl">
      <Toast message={toast} />

      <div className="mb-5">
        <h1 className="text-xl font-bold text-ink mb-0.5">Settings</h1>
        <p className="text-[13px] text-ink-soft">
          Labels, colours, SLA targets and the equipment register. Changes apply everywhere
          immediately.
        </p>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* Nine tabs wrapped to four rows on a phone and pushed the table below
          the fold. A single scrolling strip keeps it to one row — with a fade
          at the right edge while there is more to reach, because a row that is
          merely cut off looks like a row that ends, and with the selected tab
          scrolled into view so it is never the one off-screen.

          `role="tablist"` and the arrow keys make the selection something other
          than a fill colour; without them these were nine unrelated buttons and
          which one was active existed only in the styling. */}
      <div className="relative -mx-4 mb-4 sm:mx-0">
        <div
          ref={tabStripRef}
          role="tablist"
          aria-label="Settings sections"
          className="flex gap-1.5 overflow-x-auto px-4 no-scrollbar scroll-touch sm:flex-wrap sm:overflow-visible sm:px-0"
          onKeyDown={(e) => {
            const i = TABS.findIndex((t) => t.key === tab);
            if (i < 0) return;
            let next = null;
            if (e.key === "ArrowRight") next = TABS[(i + 1) % TABS.length];
            else if (e.key === "ArrowLeft") next = TABS[(i - 1 + TABS.length) % TABS.length];
            else if (e.key === "Home") next = TABS[0];
            else if (e.key === "End") next = TABS[TABS.length - 1];
            if (!next) return;
            e.preventDefault();
            setTab(next.key);
            setError(null);
            tabStripRef.current?.querySelector(`[data-tab="${next.key}"]`)?.focus();
          }}
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              data-tab={t.key}
              role="tab"
              aria-selected={tab === t.key}
              tabIndex={tab === t.key ? 0 : -1}
              onClick={() => {
                setTab(t.key);
                setError(null);
              }}
              className={`min-h-[44px] flex-shrink-0 whitespace-nowrap rounded border px-3.5 py-2 text-[13px] font-semibold ${
                tab === t.key ? "bg-ink text-white border-ink" : "bg-white text-ink border-[#D8DEE4]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-canvas to-transparent sm:hidden" />
      </div>

      {!ref.ready && <div className="text-[13px] text-ink-soft">Loading settings…</div>}

      {ref.ready && tab === "statuses" && (
        <EditableTable
          note="The statuses are fixed by the workflow. Rename or recolour them; the order controls the status timeline. Two are marked retired — migration 0039 removed On The Way and On Site from the flow, so no new work order can reach them. They stay here because work orders closed before that change still show those steps on their timeline."
          rows={ref.statuses}
          rowKey="code"
          columns={[
            /* No `retireTable` prop, deliberately — see the header of
               EditableTable below. Retiring a status is not a toggle: it means
               deleting rows from wo_status_transitions, which is a migration.
               The marker is here so nobody relabels a rung the workflow can no
               longer reach believing it is live. */
            {
              key: "code",
              label: "Code",
              type: "readonly",
              width: "flex-[1.4]",
              render: (row) => (isRetired("wo_statuses", row) ? `${row.code} (retired)` : row.code),
            },
            { key: "label", label: "Label", type: "text", width: "flex-[1.6]" },
            { key: "color_hex", label: "Colour", type: "color", width: "w-40" },
            { key: "sort_order", label: "Order", type: "number", width: "w-20" },
          ]}
          onSave={async (row, patch) => {
            await updateReferenceRow("wo_statuses", "code", row.code, patch);
            flash(`${patch.label ?? row.label} saved.`);
          }}
          onError={(e) => fail(e, "Couldn't save that status.")}
        />
      )}

      {ref.ready && tab === "priorities" && (
        <EditableTable
          note="Priority colours drive every badge in the app."
          rows={ref.priorities}
          rowKey="id"
          columns={[
            { key: "id", label: "Code", type: "readonly", width: "w-20" },
            { key: "label", label: "Label", type: "text", width: "flex-1" },
            { key: "color_hex", label: "Colour", type: "color", width: "w-40" },
            { key: "description", label: "Description", type: "text", width: "flex-[2]" },
          ]}
          onSave={async (row, patch) => {
            await updatePriority(row.id, patch);
            flash(`${row.id} saved.`);
          }}
          onError={(e) => fail(e, "Couldn't save that priority.")}
          retireTable="priorities"
          retireWarning="Work orders already raised at this priority keep their badge and their SLA. It stops being offered on the raise form, and stops being suggested by any impact level. You can restore it at any time."
          onChanged={flash}
        />
      )}

      {ref.ready && tab === "sla" && (
        <EditableTable
          note="Minutes are what the database enforces — si_sla_target_minutes() reads these to stamp each work order's deadline. The labels are only what the UI displays, so keep the two in step."
          rows={ref.sla}
          rowKey="id"
          columns={[
            { key: "priority_id", label: "Priority", type: "readonly", width: "w-20" },
            { key: "ack_target_minutes", label: "Ack (min)", type: "number", width: "w-24" },
            { key: "ack_target_label", label: "Ack label", type: "text", width: "flex-1" },
            { key: "response_target_minutes", label: "Resp (min)", type: "number", width: "w-24" },
            { key: "response_target_label", label: "Resp label", type: "text", width: "flex-1" },
            { key: "resolution_target_minutes", label: "Res (min)", type: "number", width: "w-24" },
            { key: "resolution_target_label", label: "Res label", type: "text", width: "flex-1" },
          ]}
          onSave={async (row, patch) => {
            await updateSlaTargets(row.priority_id, patch);
            flash(`${row.priority_id} SLA saved.`);
          }}
          onError={(e) => fail(e, "Couldn't save those SLA targets.")}
        />
      )}

      {ref.ready && tab === "impacts" && (
        <EditableTable
          note="Each impact level suggests a priority on the raise form. The requester can still override it."
          rows={ref.impacts}
          rowKey="code"
          columns={[
            { key: "code", label: "Code", type: "readonly", width: "flex-1" },
            { key: "label", label: "Label", type: "text", width: "flex-[2]" },
            {
              key: "suggests_priority",
              label: "Suggests",
              type: "select",
              options: priorityOptions,
              width: "w-44",
            },
            { key: "sort_order", label: "Order", type: "number", width: "w-20" },
          ]}
          onSave={async (row, patch) => {
            await updateReferenceRow("impact_levels", "code", row.code, patch);
            flash("Impact level saved.");
          }}
          onError={(e) => fail(e, "Couldn't save that impact level.")}
          retireTable="impact_levels"
          retireWarning="Work orders already raised at this impact level keep it. It stops being offered on the raise form. You can restore it at any time."
          onChanged={flash}
        />
      )}

      {ref.ready && tab === "types" && (
        <EditableTable
          rows={ref.types}
          rowKey="code"
          columns={[
            { key: "code", label: "Code", type: "readonly", width: "flex-1" },
            { key: "label", label: "Label", type: "text", width: "flex-1" },
            { key: "description", label: "Description", type: "text", width: "flex-[2]" },
            { key: "sort_order", label: "Order", type: "number", width: "w-20" },
          ]}
          onSave={async (row, patch) => {
            await updateReferenceRow("wo_types", "code", row.code, patch);
            flash("Work order type saved.");
          }}
          onError={(e) => fail(e, "Couldn't save that type.")}
          retireTable="wo_types"
          retireWarning="Work orders already raised as this type keep it. It stops being offered on the raise form. You can restore it at any time."
          onChanged={flash}
        />
      )}

      {ref.ready && tab === "severities" && (
        <EditableTable
          note="A flagged safety risk caps the suggested priority at whatever you set here — it can raise the suggestion but never lower it."
          rows={ref.severities}
          rowKey="code"
          columns={[
            { key: "code", label: "Code", type: "readonly", width: "w-28" },
            { key: "label", label: "Label", type: "text", width: "flex-[2]" },
            {
              key: "escalates_to_priority",
              label: "Caps at",
              type: "select",
              options: priorityOptions,
              width: "w-44",
            },
            { key: "sort_order", label: "Order", type: "number", width: "w-20" },
          ]}
          onSave={async (row, patch) => {
            await updateReferenceRow("safety_severities", "code", row.code, patch);
            flash("Safety severity saved.");
          }}
          onError={(e) => fail(e, "Couldn't save that severity.")}
          retireTable="safety_severities"
          retireWarning="Work orders already flagged at this severity keep it. It stops being offered when someone ticks the safety box. You can restore it at any time."
          onChanged={flash}
        />
      )}

      {ref.ready && tab === "departments" && (
        <EditableTable
          note="Departments no longer scope who sees a work order — every Supervisor sees all of them. This is the dimension the dashboard breaks down by, and anyone raising a work order can add one from the form, so it is worth tidying."
          rows={ref.departments}
          rowKey="id"
          columns={[
            { key: "id", label: "ID", type: "readonly", width: "flex-[1.4]" },
            { key: "name", label: "Name", type: "text", width: "flex-[1.6]" },
            { key: "code", label: "Code", type: "text", width: "flex-1" },
          ]}
          onSave={async (row, patch) => {
            await upsertDepartment({
              id: row.id,
              name: patch.name ?? row.name,
              code: patch.code ?? row.code,
              plantId: row.plant_id,
            });
            flash("Department saved.");
          }}
          onError={(e) => fail(e, "Couldn't save that department.")}
          addLabel="Add department"
          addFields={[
            { key: "id", label: "ID", placeholder: "DEPT-TOOLROOM", required: true },
            { key: "name", label: "Name", placeholder: "Tool Room", required: true },
            { key: "code", label: "Code", placeholder: "TOOL" },
          ]}
          onAdd={async (values) => {
            await upsertDepartment({
              id: values.id.trim(),
              name: values.name.trim(),
              code: values.code?.trim() || values.id.trim(),
              plantId: "PLT001",
            });
            flash(`${values.name} added.`);
          }}
          retireTable="departments"
          retireWarning="Work orders, equipment and users already in this department stay exactly as they are, and the dashboard still breaks them out. It stops being offered on the raise form and when assigning a user. You can restore it at any time."
          onChanged={flash}
        />
      )}

      {ref.ready && tab === "assets" && (
        <EditableTable
          note="The equipment the raise form offers. Adding a machine here makes it selectable immediately — no code change and no redeploy."
          rows={ref.assets}
          rowKey="id"
          columns={[
            { key: "id", label: "ID", type: "readonly", width: "flex-1" },
            { key: "name", label: "Name", type: "text", width: "flex-[1.6]" },
            {
              key: "department_id",
              label: "Department",
              type: "select",
              options: departmentOptions,
              width: "flex-[1.4]",
            },
            {
              key: "criticality",
              label: "Criticality",
              type: "select",
              options: [
                { value: "high", label: "High" },
                { value: "medium", label: "Medium" },
                { value: "low", label: "Low" },
              ],
              width: "w-36",
            },
          ]}
          onSave={async (row, patch) => {
            await upsertAsset({
              id: row.id,
              assetCode: row.asset_code,
              name: patch.name ?? row.name,
              departmentId: patch.department_id ?? row.department_id,
              criticality: patch.criticality ?? row.criticality,
              category: row.category,
              // Carried through, not defaulted: this column is what retires a
              // machine since 0031, so dropping it here would quietly put a
              // decommissioned one back on the raise form.
              status: row.status,
            });
            flash("Equipment saved.");
          }}
          onError={(e) => fail(e, "Couldn't save that equipment.")}
          addLabel="Add equipment"
          addFields={[
            { key: "id", label: "Asset ID", placeholder: "AST-0777", required: true },
            { key: "name", label: "Name", placeholder: "Surface Grinder 2", required: true },
            {
              key: "department_id",
              label: "Department",
              type: "select",
              options: activeDepartmentOptions,
              required: true,
            },
            {
              key: "criticality",
              label: "Criticality",
              type: "select",
              options: [
                { value: "high", label: "High" },
                { value: "medium", label: "Medium" },
                { value: "low", label: "Low" },
              ],
              required: true,
            },
          ]}
          onAdd={async (values) => {
            await upsertAsset({
              id: values.id.trim(),
              assetCode: values.id.trim(),
              name: values.name.trim(),
              departmentId: values.department_id,
              criticality: values.criticality || "medium",
            });
            flash(`${values.name} added.`);
          }}
          retireTable="assets"
          retireWarning="Work orders already raised against this machine stay exactly as they are. It stops being offered on the raise form. You can restore it at any time."
          onChanged={flash}
        />
      )}

      {ref.ready && tab === "permissions" && (
        <PermissionsPanel rows={ref.rolePermissions} onFlash={flash} onError={setError} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
   Permissions — who may delete work orders.

   Every other tab on this screen is Admin-editable. This one is not: only a
   Superuser writes role_permissions (migration 0018), because a capability an
   Administrator can grant themselves is not a capability, it is a formality.
   An Administrator still sees the table, so the current grants are never a
   mystery — they just cannot move the toggles.

   Toggle-then-apply rather than save-on-click: these are five switches that are
   usually reasoned about together, and a switch that writes the moment it is
   touched turns a change of mind into a second audited write.
-------------------------------------------------------------------*/

const CAPABILITIES = [
  {
    key: "can_delete_work_orders",
    label: "Delete work orders",
    detail:
      "Permanently remove a work order and everything attached to it. The deletion is recorded — who, when, and a copy of the record — but the work order itself does not come back.",
  },
];

function PermissionsPanel({ rows, onFlash, onError }) {
  const { user: me } = useAuth();
  const mayEdit = canEditRolePermissions(me);

  // The draft is seeded from the live rows and re-seeded whenever they change,
  // so another Superuser's change does not sit invisible behind a stale draft.
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const next = {};
    for (const r of rows) {
      for (const c of CAPABILITIES) next[`${r.role}.${c.key}`] = r[c.key] === true;
    }
    setDraft(next);
  }, [rows]);

  const dirty = useMemo(
    () =>
      rows.flatMap((r) =>
        CAPABILITIES.filter((c) => draft[`${r.role}.${c.key}`] !== (r[c.key] === true)).map((c) => ({
          role: r.role,
          capability: c.key,
          value: draft[`${r.role}.${c.key}`],
        }))
      ),
    [rows, draft]
  );

  async function apply() {
    setBusy(true);
    onError(null);
    try {
      for (const change of dirty) {
        await setRolePermission(change.role, change.capability, change.value);
      }
      onFlash(
        dirty.length === 1
          ? "Permission updated."
          : `${dirty.length} permissions updated.`
      );
    } catch (e) {
      onError(describeError(e, "Couldn't save those permissions."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mb-3 flex items-start gap-2 rounded bg-canvas px-3.5 py-2.5 text-[12.5px] text-ink-soft">
        <Info size={14} className="mt-0.5 flex-shrink-0" />
        <span>
          {mayEdit
            ? "Granting a capability here gives it to every account holding that role. It does not widen what they can see — a Supervisor granted deletion reaches their own department, not the plant. A Superuser always holds every capability and is not listed."
            : "Only a Superuser can change these. They are shown so you can see what your role currently holds."}
        </span>
      </div>

      {mayEdit && rows.length > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded border border-[#EF444455] bg-[#FCE9E9] px-3.5 py-2.5 text-[12.5px] text-danger-text">
          <ShieldAlert size={14} className="mt-0.5 flex-shrink-0" />
          <span>
            Deletion is the only irreversible action in this system. Everything else that looks
            like removal is a status change, and can be undone.
          </span>
        </div>
      )}

      {/* No rows at all means the table isn't there yet, which is a migration
          that has not been applied — not a database in which nobody has been
          granted anything. Saying so beats five permanently-disabled switches. */}
      {rows.length === 0 && (
        <div className="mb-3 flex items-start gap-2 rounded border border-[#F59E0B66] bg-[#FFFBEB] px-3.5 py-2.5 text-[12.5px] text-[#92400E]">
          <ShieldAlert size={14} className="mt-0.5 flex-shrink-0" />
          <span>
            No permission rows were returned. Migration 0018 has probably not been applied to this
            project yet — run <span className="font-mono">npm run db:push</span>. Until then nobody
            can delete work orders, which is the safe default.
          </span>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto scroll-touch">
          <div className="min-w-[34rem]">
            <div className="flex items-center bg-canvas px-4 py-2.5 text-[11.5px] font-bold uppercase tracking-wide text-ink-soft">
              <div className="flex-1">Role</div>
              {CAPABILITIES.map((c) => (
                <div key={c.key} className="w-56">
                  {c.label}
                </div>
              ))}
            </div>

            {ALL_ROLES.map((role, i) => {
              const row = rows.find((r) => r.role === role);
              return (
                <div
                  key={role}
                  className={`flex items-center px-4 py-3 ${i === 0 ? "" : "border-t border-[#F1F3F5]"}`}
                >
                  <div className="flex-1 text-[13.5px] font-medium text-ink">
                    {ROLE_LABELS[role] || role}
                  </div>
                  {CAPABILITIES.map((c) => {
                    const id = `${role}.${c.key}`;
                    const checked = draft[id] === true;
                    return (
                      <label
                        key={c.key}
                        title={c.detail}
                        className={`flex w-56 items-center gap-2 text-[13px] ${
                          mayEdit ? "cursor-pointer text-ink" : "cursor-default text-ink-soft"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-amber"
                          checked={checked}
                          disabled={!mayEdit || !row}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, [id]: e.target.checked }))
                          }
                        />
                        {checked ? "Allowed" : "Not allowed"}
                        {!mayEdit && <Lock size={12} className="text-ink-soft" />}
                      </label>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {mayEdit && (
        <div className="mt-3 flex items-center gap-3">
          <Button icon={busy ? Loader2 : Check} disabled={busy || dirty.length === 0} onClick={apply}>
            {busy ? "Applying…" : "Apply changes"}
          </Button>
          <span className="text-[12.5px] text-ink-soft">
            {dirty.length === 0
              ? "No changes to apply."
              : `${dirty.length} change${dirty.length === 1 ? "" : "s"} pending.`}
          </span>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------
   A row-at-a-time editable table, driven by a column spec.
-------------------------------------------------------------------*/
function EditableTable({
  rows,
  rowKey,
  columns,
  onSave,
  onError,
  note,
  addLabel,
  addFields,
  onAdd,
  /**
   * The table name, for the six that can be taken out of use (migration 0031).
   * Everything else follows from it: RETIRABLE says where the flag lives,
   * canRetireReferenceData() and canRemoveReferenceRow() say who sees which
   * button. Omitted on statuses, SLA and permissions — see the file header.
   *
   * One row at a time, with a confirmation on the two consequential directions.
   * Restoring needs none: it puts a value back on a form.
   */
  retireTable,
  retireWarning,
  onChanged,
}) {
  const { user: me } = useAuth();
  const [editing, setEditing] = useState(null); // row key
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState(null); // { row, mode: 'retire' | 'remove' }

  const mayRetire = !!retireTable && canRetireReferenceData(me);
  const mayRemove = !!retireTable && canRemoveReferenceRow(retireTable, me);
  const hasActions = mayRetire || mayRemove;

  /* Retired rows drop to the bottom under their own heading rather than sitting
     dimmed in place. In place they read as a rendering glitch; under a heading
     that says what they are, the list stays a list of what is in use — which is
     what this screen is mostly for. */
  const retiredOf = (row) => (retireTable ? isRetired(retireTable, row) : false);
  const liveRows = rows.filter((r) => !retiredOf(r));
  const retiredRows = retireTable ? rows.filter(retiredOf) : [];

  /* Two independent pagers, so a long retired list cannot bury the live one it
     sits under. The enum-keyed tables are four to eleven rows, so neither
     footer ever renders there - only departments and equipment grow. Keyed on
     the table rather than on the arrays, which are rebuilt every render. */
  /* Only the live rows are measured. The retired block sits under them and is
     usually short, so it keeps a fixed small page rather than competing for the
     same screen height. */
  const liveRef = useRef(null);
  /* No reserve for the retired block below: the hook measures what is under the
     list rather than being told about it. */
  const liveSize = useAutoPageSize(liveRef, { min: 3, signature: rows.length });

  const livePager = usePaged(liveRows, { pageSize: liveSize, resetKey: `live|${rowKey}|${retireTable ?? ""}` });
  const retiredPager = usePaged(retiredRows, { pageSize: 10, resetKey: `retired|${rowKey}|${retireTable ?? ""}` });

  async function setActive(row, active) {
    setBusy(true);
    try {
      await setReferenceRowActive(retireTable, row[rowKey], active);
      onChanged?.(
        `${row.name || row.label || row[rowKey]} ${active ? "restored" : "retired"}.`
      );
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(row) {
    setEditing(row[rowKey]);
    const d = {};
    for (const c of columns) if (c.type !== "readonly") d[c.key] = row[c.key] ?? "";
    setDraft(d);
  }

  async function save(row) {
    setBusy(true);
    try {
      // Only send what actually changed, and coerce numbers so a text input
      // doesn't hand Postgres a string for an integer column.
      const patch = {};
      for (const c of columns) {
        if (c.type === "readonly") continue;
        let v = draft[c.key];
        if (c.type === "number") v = v === "" || v === null ? null : Number(v);
        if (v !== (row[c.key] ?? "")) patch[c.key] = v;
      }
      if (Object.keys(patch).length) await onSave(row, patch);
      setEditing(null);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  /* One renderer for both groups. `retired` only dims and swaps the retire
     button for a restore — a retired row stays editable, because relabelling or
     recolouring one is exactly what you do before restoring it. */
  function renderRow(row, isFirst, retired) {
    const isEditing = editing === row[rowKey];
    return (
      <div
        key={row[rowKey]}
        className={`flex items-center px-4 py-2.5 ${isFirst ? "" : "border-t border-[#F1F3F5]"} ${
          retired ? "opacity-60" : ""
        }`}
      >
        {columns.map((c) => (
          <div key={c.key} className={`${c.width} pr-2 min-w-0`}>
            {!isEditing || c.type === "readonly" ? (
              <CellValue column={c} row={row} />
            ) : (
              <CellInput
                column={c}
                value={draft[c.key]}
                onChange={(v) => setDraft((d) => ({ ...d, [c.key]: v }))}
              />
            )}
          </div>
        ))}
        <div className={`${hasActions ? "w-40" : "w-24"} flex justify-end gap-1.5`}>
          {isEditing ? (
            <>
              <Button size="sm" variant="ghost" icon={X} aria-label="Cancel edit" onClick={() => setEditing(null)} />
              <Button
                size="sm"
                icon={busy ? Loader2 : Check}
                aria-label="Save row"
                disabled={busy}
                onClick={() => save(row)}
              />
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" icon={Pencil} aria-label="Edit row" onClick={() => startEdit(row)} />
              {mayRetire &&
                (retired ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={RotateCcw}
                    aria-label="Restore row"
                    disabled={busy}
                    onClick={() => setActive(row, true)}
                  />
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Archive}
                    aria-label="Retire row"
                    disabled={busy}
                    onClick={() => setConfirming({ row, mode: "retire" })}
                  />
                ))}
              {mayRemove && (
                <Button
                  size="sm"
                  variant="danger"
                  icon={Trash2}
                  aria-label="Remove row permanently"
                  onClick={() => setConfirming({ row, mode: "remove" })}
                />
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {note && (
        <div className="flex items-start gap-2 bg-canvas rounded px-3.5 py-2.5 mb-3 text-[12.5px] text-ink-soft">
          <Info size={14} className="mt-0.5 flex-shrink-0" />
          <span>{note}</span>
        </div>
      )}

      {addLabel && (
        <div className="mb-3">
          <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>
            {addLabel}
          </Button>
        </div>
      )}

      {/* These grids are column-spec driven — the SLA tab alone has seven columns
          plus an action cell — so there's no honest way to reflow them into cards.
          Instead the table keeps its real width and scrolls horizontally inside
          the card, which is why the row width is pinned rather than left to
          collapse: without the min-width, flex would compress every cell to
          nothing on a phone. */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto scroll-touch">
          {/* Widened when there is an action column: the cell grows from w-24 to
              w-40 to hold retire and remove beside edit, and a min-width that
              did not grow with it would leave the last button outside the
              scrollable area entirely. */}
          <div className={hasActions ? "min-w-[54rem]" : "min-w-[46rem]"}>
            <div className="flex items-center px-4 py-2.5 bg-canvas text-[11.5px] font-bold text-ink-soft uppercase tracking-wide">
              {columns.map((c) => (
                <div key={c.key} className={c.width}>
                  {c.label}
                </div>
              ))}
              <div className={`${hasActions ? "w-40" : "w-24"} text-right`}>
                {hasActions ? "Actions" : "Edit"}
              </div>
            </div>

            <div ref={liveRef}>
              {livePager.visible.map((row, i) => renderRow(row, i === 0, false))}
            </div>
            <PagerFooter pager={livePager} />

            {retiredRows.length > 0 && (
              <>
                <div className="flex items-center gap-2 border-t border-[#F1F3F5] bg-canvas px-4 py-2 text-[11.5px] font-bold uppercase tracking-wide text-ink-soft">
                  <Archive size={13} className="flex-shrink-0" />
                  Retired — kept on existing records, no longer offered
                </div>
                {retiredPager.visible.map((row) => renderRow(row, true, true))}
                <PagerFooter pager={retiredPager} noun="retired rows" />
              </>
            )}
          </div>
        </div>
      </Card>
      <p className="mt-2 text-[11.5px] text-ink-soft lg:hidden">Scroll the table sideways to reach every column.</p>

      {confirming && (
        <ConfirmActionDialog
          mode={confirming.mode}
          label={
            confirming.row.name || confirming.row.label || confirming.row[rowKey]
          }
          warning={confirming.mode === "retire" ? retireWarning : undefined}
          onClose={() => setConfirming(null)}
          onConfirm={async () => {
            if (confirming.mode === "retire") {
              await setReferenceRowActive(retireTable, confirming.row[rowKey], false);
              onChanged?.(
                `${confirming.row.name || confirming.row.label || confirming.row[rowKey]} retired.`
              );
            } else {
              await deleteReferenceRow(retireTable, confirming.row[rowKey]);
              onChanged?.(
                `${confirming.row.name || confirming.row.label || confirming.row[rowKey]} removed.`
              );
            }
            setConfirming(null);
          }}
          onError={onError}
        />
      )}

      {adding && (
        <AddRowDialog
          title={addLabel}
          fields={addFields}
          onClose={() => setAdding(false)}
          onSubmit={async (values) => {
            await onAdd(values);
            setAdding(false);
          }}
          onError={onError}
        />
      )}
    </>
  );
}

function CellValue({ column, row }) {
  const v = row[column.key];
  /* An escape hatch for a column whose displayed text is not simply its own
     value — used by the statuses tab to mark the two rungs migration 0039 took
     out of the workflow. Read-only by construction: `save()` above skips every
     readonly column, so nothing here can be edited back. */
  if (column.render) {
    return <span className="text-[13px] text-ink truncate block">{column.render(row)}</span>;
  }
  if (column.type === "color") {
    return (
      <span className="flex items-center gap-2 text-[12.5px] font-mono text-ink">
        <span
          className="w-4 h-4 rounded border border-border flex-shrink-0"
          style={{ background: v }}
        />
        {v}
      </span>
    );
  }
  if (column.type === "select") {
    const opt = column.options?.find((o) => o.value === v);
    return <span className="text-[13px] text-ink truncate block">{opt?.label ?? v ?? "—"}</span>;
  }
  return (
    <span className="text-[13px] text-ink truncate block">
      {v === null || v === undefined || v === "" ? "—" : String(v)}
    </span>
  );
}

function CellInput({ column, value, onChange }) {
  const base = "w-full px-2 py-1.5 rounded border border-[#D8DEE4] text-[13px] bg-white text-ink";

  if (column.type === "select") {
    return (
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={base}>
        {column.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (column.type === "color") {
    return (
      <span className="flex items-center gap-1.5">
        <input
          type="color"
          value={value || "#64748B"}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="w-7 h-7 rounded border border-border p-0 flex-shrink-0"
          aria-label={column.label}
        />
        <input
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={`${base} font-mono`}
        />
      </span>
    );
  }
  return (
    <input
      type={column.type === "number" ? "number" : "text"}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className={base}
    />
  );
}

/**
 * Retiring and removing both ask first, for different reasons: retiring changes
 * what everyone else's raise form offers, and removing cannot be undone. The
 * third direction, restoring, does not — it puts a value back on a form, and a
 * dialog guarding that is friction with nothing behind it.
 *
 * The failure is shown in the dialog AND passed to onError for the page banner,
 * matching AddRowDialog below. Both are wanted: si_guard_reference_delete()
 * names what is still pointing at the row, which only reads properly next to
 * the name, and the banner keeps that sentence on screen after the dialog is
 * dismissed.
 */
function ConfirmActionDialog({ mode, label, warning, onClose, onConfirm, onError }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const retiring = mode === "retire";

  async function confirm() {
    setError(null);
    setBusy(true);
    try {
      await onConfirm();
    } catch (err) {
      setError(describeError(err, retiring ? "Couldn't retire that." : "Couldn't remove that."));
      onError?.(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalOverlay className="p-4">
      <Card className="rise max-h-[85dvh] w-full max-w-md overflow-y-auto p-4 sm:p-5">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-[15.5px] font-bold text-ink">
            {retiring ? `Retire ${label}?` : `Remove ${label} permanently?`}
          </h2>
          <button onClick={onClose} aria-label="Close" className="text-ink-soft hover:text-ink">
            <X size={18} />
          </button>
        </div>
        {error && <ErrorBanner message={error} />}
        <p className="mb-5 text-[13px] text-ink-soft">
          {retiring
            ? warning ||
              "It stops being offered for new work. Existing records keep it, and you can restore it at any time."
            : "This can't be undone. It only works while nothing has ever used it — otherwise you'll be told what still does, and retiring is the answer instead."}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={retiring ? "primary" : "danger"}
            icon={busy ? Loader2 : retiring ? Archive : Trash2}
            disabled={busy}
            onClick={confirm}
          >
            {busy ? (retiring ? "Retiring…" : "Removing…") : retiring ? "Retire" : "Remove"}
          </Button>
        </div>
      </Card>
    </ModalOverlay>
  );
}

function AddRowDialog({ title, fields, onClose, onSubmit, onError }) {
  const [values, setValues] = useState(() => {
    const v = {};
    for (const f of fields) v[f.key] = f.type === "select" ? (f.options?.[0]?.value ?? "") : "";
    return v;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    for (const f of fields) {
      if (f.required && !String(values[f.key] ?? "").trim()) {
        setError(`${f.label} is required.`);
        return;
      }
    }
    setBusy(true);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(describeError(err, "Couldn't save that."));
      onError?.(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalOverlay className="p-4">
      <Card className="rise max-h-[85dvh] w-full max-w-md overflow-y-auto p-4 sm:p-5">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-[15.5px] font-bold text-ink">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-ink-soft hover:text-ink">
            <X size={18} />
          </button>
        </div>
        {error && <ErrorBanner message={error} />}
        <form onSubmit={submit}>
          {fields.map((f) => (
            <Field key={f.key} label={f.label} required={f.required}>
              {f.type === "select" ? (
                <select
                  value={values[f.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  className={inputClass}
                >
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={values[f.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className={inputClass}
                />
              )}
            </Field>
          ))}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" icon={busy ? Loader2 : Plus} disabled={busy}>
              {busy ? "Saving…" : "Add"}
            </Button>
          </div>
        </form>
      </Card>
    </ModalOverlay>
  );
}
