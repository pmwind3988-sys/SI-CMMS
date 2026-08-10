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
import { Check, X, Pencil, Plus, Loader2, Info } from "lucide-react";
import { useReferenceData, updateReferenceRow } from "../../lib/referenceData";
import {
  upsertDepartment,
  upsertAsset,
  updateSlaTargets,
  updatePriority,
} from "../../lib/admin";
import { describeError } from "../../lib/errors";
import Button from "../ui/Button";
import Field, { inputClass } from "../ui/Field";
import { Card, ErrorBanner, Toast } from "../ui/Surfaces";

const TABS = [
  { key: "statuses", label: "Statuses" },
  { key: "priorities", label: "Priorities" },
  { key: "sla", label: "SLA targets" },
  { key: "impacts", label: "Impact levels" },
  { key: "types", label: "Work order types" },
  { key: "severities", label: "Safety severities" },
  { key: "departments", label: "Departments" },
  { key: "assets", label: "Equipment" },
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
          note="Departments scope what a Supervisor can see, so an id here must match the department on their user record."
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
    </div>
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
}) {
  const [editing, setEditing] = useState(null); // row key
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

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
          <div className="min-w-[46rem]">
            <div className="flex items-center px-4 py-2.5 bg-canvas text-[11.5px] font-bold text-ink-soft uppercase tracking-wide">
              {columns.map((c) => (
                <div key={c.key} className={c.width}>
                  {c.label}
                </div>
              ))}
              <div className="w-24 text-right">Edit</div>
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
                  <div className="w-24 flex justify-end gap-1.5">
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
                      <Button size="sm" variant="ghost" icon={Pencil} aria-label="Edit row" onClick={() => startEdit(row)} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>
      <p className="mt-2 text-[11.5px] text-ink-soft lg:hidden">Scroll the table sideways to reach every column.</p>

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
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center sm:p-6">
      <Card className="max-h-[85dvh] w-full max-w-md overflow-y-auto p-4 sm:p-5">
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
    </div>
  );
}
