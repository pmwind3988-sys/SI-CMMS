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
 *   accepts, so they can be relabelled and recoloured but not added to or
 *   deleted — a status with no transition rows and no trigger handling would be
 *   a broken status, and work orders already reference these codes. Migration
 *   0009 grants UPDATE only, so the database enforces this too.
 *
 *   Operational records (departments, equipment) are real business data. Those
 *   can be added.
 *
 * Edits reach every open session over Realtime, so a colour change shows up on a
 * supervisor's board without them reloading.
 */
import { useEffect, useMemo, useState } from "react";
import { Check, X, Pencil, Plus, Trash2, Loader2, Info, ShieldAlert, Lock } from "lucide-react";
import { useReferenceData, updateReferenceRow } from "../../lib/referenceData";
import {
  upsertDepartment,
  deleteDepartment,
  upsertAsset,
  updateSlaTargets,
  updatePriority,
  setRolePermission,
} from "../../lib/admin";
import { describeError } from "../../lib/errors";
import { useAuth } from "../../context/AuthContext";
import { canEditRolePermissions } from "../../lib/constants";
import { ALL_ROLES, ROLE_LABELS } from "../../lib/roles";
import Button from "../ui/Button";
import Field, { inputClass } from "../ui/Field";
import { Card, ErrorBanner, Toast, ModalOverlay } from "../ui/Surfaces";

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
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  function flash(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }
  function fail(e, fallback) {
    setError(describeError(e, fallback));
  }

  const priorityOptions = useMemo(
    () => ref.priorities.map((p) => ({ value: p.id, label: `${p.id} — ${p.label}` })),
    [ref.priorities]
  );
  const departmentOptions = useMemo(
    () => ref.departments.map((d) => ({ value: d.id, label: d.name })),
    [ref.departments]
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

      {/* Eight tabs wrapped to four rows on a phone and pushed the table below
          the fold. A single scrolling strip keeps it to one row. */}
      <div className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 no-scrollbar scroll-touch sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setError(null);
            }}
            className={`flex-shrink-0 whitespace-nowrap rounded border px-3.5 py-2 text-[13px] font-semibold ${
              tab === t.key ? "bg-ink text-white border-ink" : "bg-white text-ink border-[#D8DEE4]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!ref.ready && <div className="text-[13px] text-ink-soft">Loading settings…</div>}

      {ref.ready && tab === "statuses" && (
        <EditableTable
          note="The eleven statuses are fixed by the workflow. Rename or recolour them; the order controls the status timeline."
          rows={ref.statuses}
          rowKey="code"
          columns={[
            { key: "code", label: "Code", type: "readonly", width: "flex-[1.4]" },
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
          onDelete={async (row) => {
            await deleteDepartment(row.id);
            flash(`${row.name} deleted.`);
          }}
          deleteWarning="Departments still referenced by a work order, a piece of equipment or a user can't be deleted — you'll be told which. This can't be undone."
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
              options: departmentOptions,
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
        <div className="mb-3 flex items-start gap-2 rounded border border-[#EF444455] bg-[#FCE9E9] px-3.5 py-2.5 text-[12.5px] text-danger">
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
   * Optional. Only the tables holding real operational records get one — the
   * enum-keyed lookups (statuses, priorities, impacts, types, severities) have
   * no delete policy at all, because their row set is the enum's and a status
   * with no transition rows would be a broken status (migration 0009).
   *
   * One row at a time, with a confirmation. Checkbox multi-select arrives with
   * the rest of the admin CRUD work and will absorb this button.
   */
  onDelete,
  deleteWarning,
}) {
  const [editing, setEditing] = useState(null); // row key
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState(null); // row pending deletion

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
          {/* Widened when there is a delete column: the action cell grows from
              w-24 to w-32, and a min-width that did not grow with it left the
              delete button outside the scrollable area entirely. */}
          <div className={onDelete ? "min-w-[49rem]" : "min-w-[46rem]"}>
            <div className="flex items-center px-4 py-2.5 bg-canvas text-[11.5px] font-bold text-ink-soft uppercase tracking-wide">
              {columns.map((c) => (
                <div key={c.key} className={c.width}>
                  {c.label}
                </div>
              ))}
              <div className={`${onDelete ? "w-32" : "w-24"} text-right`}>{onDelete ? "Actions" : "Edit"}</div>
            </div>

            {rows.map((row, i) => {
              const isEditing = editing === row[rowKey];
              return (
                <div
                  key={row[rowKey]}
                  className={`flex items-center px-4 py-2.5 ${i === 0 ? "" : "border-t border-[#F1F3F5]"}`}
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
                  <div className={`${onDelete ? "w-32" : "w-24"} flex justify-end gap-1.5`}>
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
                        {onDelete && (
                          <Button
                            size="sm"
                            variant="danger"
                            icon={Trash2}
                            aria-label="Delete row"
                            onClick={() => setConfirming(row)}
                          />
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>
      <p className="mt-2 text-[11.5px] text-ink-soft lg:hidden">Scroll the table sideways to reach every column.</p>

      {confirming && (
        <ConfirmDeleteDialog
          label={confirming.name || confirming.label || confirming[rowKey]}
          warning={deleteWarning}
          onClose={() => setConfirming(null)}
          onConfirm={async () => {
            await onDelete(confirming);
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
 * Deleting reference data is not undoable and not a status change, so it asks
 * first — the only other place in this module that does is deleting a work
 * order.
 *
 * The failure is shown in the dialog AND passed to onError for the page banner,
 * matching AddRowDialog below. Both are wanted: deleteDepartment() reports what
 * is still pointing at the row, which only reads properly next to the name, and
 * the banner keeps that sentence on screen after the dialog is dismissed.
 */
function ConfirmDeleteDialog({ label, warning, onClose, onConfirm, onError }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function confirm() {
    setError(null);
    setBusy(true);
    try {
      await onConfirm();
    } catch (err) {
      setError(describeError(err, "Couldn't delete that."));
      onError?.(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalOverlay className="p-4">
      <Card className="rise max-h-[85dvh] w-full max-w-md overflow-y-auto p-4 sm:p-5">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-[15.5px] font-bold text-ink">Delete {label}?</h2>
          <button onClick={onClose} aria-label="Close" className="text-ink-soft hover:text-ink">
            <X size={18} />
          </button>
        </div>
        {error && <ErrorBanner message={error} />}
        <p className="mb-5 text-[13px] text-ink-soft">
          {warning || "This can't be undone."}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" icon={busy ? Loader2 : Trash2} disabled={busy} onClick={confirm}>
            {busy ? "Deleting…" : "Delete"}
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
