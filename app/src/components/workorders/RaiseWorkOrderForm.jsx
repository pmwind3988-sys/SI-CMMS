"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Factory, Image as ImageIcon, X, Sparkles, AlertTriangle, Send, Save } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { createWorkOrder, updateWorkOrderFields, addAttachment } from "../../lib/workOrders";
import { useReferenceData, includingCurrent } from "../../lib/referenceData";
import { createAsset, createDepartment } from "../../lib/admin";
import { describeError } from "../../lib/errors";
import Field, { inputClass } from "../ui/Field";
import Combobox from "../ui/Combobox";
import Button from "../ui/Button";
import { Card, ErrorBanner } from "../ui/Surfaces";
import { PriorityBadge } from "../ui/Badges";

/**
 * Dual-mode: `existing` present -> Edit Work Order (core fields only,
 * status stays "open" — enforced both here and by the open -> open row in
 * wo_status_transitions).
 * `existing` absent -> Create / Raise Work Order.
 */
export default function RaiseWorkOrderForm({ existing }) {
  const { user } = useAuth();
  /* Both halves of every retirable set (migration 0031). The active* lists are
     what this form offers; the full lists are only there so that editing a work
     order raised before a retirement still shows the value it actually has —
     see includingCurrent() below. */
  const {
    ready,
    departments,
    assets,
    impacts,
    types,
    severities,
    activeDepartments,
    activeAssets,
    activeImpacts,
    activeTypes,
    activeSeverities,
    assetById,
    departmentName,
    priorityColor,
    slaForPriority,
    suggestPriority,
  } = useReferenceData();
  const router = useRouter();
  const isEdit = !!existing;

  const [departmentId, setDepartmentId] = useState(existing?.department_id || "");
  const [assetId, setAssetId] = useState(existing?.asset_id || "");
  const [area, setArea] = useState(existing?.area || "");
  const [creatingDept, setCreatingDept] = useState(false);
  const [creatingAsset, setCreatingAsset] = useState(false);
  const [type, setType] = useState(existing?.type || "breakdown");
  const [complaint, setComplaint] = useState(existing?.description || "");
  const [impact, setImpact] = useState(existing?.impact || "");
  const [photos, setPhotos] = useState([]);
  const [safetyFlag, setSafetyFlag] = useState(existing?.safety_risk?.flag || false);
  const [safetySeverity, setSafetySeverity] = useState(existing?.safety_risk?.severity || "Medium");
  const [envFlag, setEnvFlag] = useState(existing?.environmental_risk?.flag || false);
  const [requester, setRequester] = useState(existing?.requester_name || user.name);
  const [phone, setPhone] = useState(existing?.requester_phone || user.phone || "");
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const photoInput = useRef(null);

  const asset = assetById(assetId);
  const safety = { flag: safetyFlag, severity: safetySeverity };
  const env = { flag: envFlag };

  /**
   * Priority is DERIVED now, not chosen — it follows the production impact,
   * still escalated by safety and environmental risk exactly as before. What
   * changed is that there is no longer an override: the four priority buttons
   * and the `priorityTouched` flag they set are gone.
   *
   * This is a display of the rule, not the rule. `si_derive_priority` in
   * migration 0036 recomputes the same thing in a BEFORE INSERT/UPDATE trigger
   * and overwrites whatever arrives, so a value sent from anywhere — this form,
   * a stale tab, PostgREST directly — cannot disagree with the impact. Keeping
   * the client calculation is what lets the form show the answer and the SLA
   * targets before submitting; it is not what enforces it.
   */
  const effectivePriority = suggestPriority(impact, safety, env);
  /** The ceiling the safety severity would impose, for the note under it. */
  const safetyCeiling = safetyFlag
    ? severities.find((s) => s.code === safetySeverity)?.escalates_to_priority
    : null;
  const envCeiling = envFlag
    ? severities.find((s) => s.code === "Medium")?.escalates_to_priority
    : null;

  /**
   * Every asset, from every department (migration 0019). The department filter
   * that used to be here assumed the person raising a work order only ever
   * reported faults on their own department's machines, which is not how a
   * plant works — whoever notices the fault files it.
   *
   * Retired values are filtered out of all six pickers (migration 0031), and
   * WHEN EDITING the value already on the work order is added back. The form is
   * also the edit form, so a job raised against a machine since decommissioned
   * has to keep showing that machine; without it the picker would fall to the
   * first remaining option and silently rewrite a field nobody touched.
   *
   * Not when raising, which is the whole point of retiring — otherwise `type`,
   * which starts on a hardcoded "breakdown", would re-offer a retired type to
   * every new work order.
   */
  const offeredAssets = includingCurrent(activeAssets, assets, isEdit ? assetId : null, "id");
  const offeredDepartments = includingCurrent(activeDepartments, departments, isEdit ? departmentId : null, "id");
  const offeredTypes = includingCurrent(activeTypes, types, isEdit ? type : null, "code");
  /* No offeredPriorities any more: nothing picks a priority, so there is no
     picker whose current value has to be added back. suggestPriority() already
     resolves against the ACTIVE priorities on its own. */
  const offeredImpacts = includingCurrent(activeImpacts, impacts, isEdit ? impact : null, "code");
  const offeredSeverities = includingCurrent(
    activeSeverities,
    severities,
    isEdit && safetyFlag ? safetySeverity : null,
    "code"
  );

  /* Reference data arrives after the first render, so the two fields that start
     from a hardcoded default — type "breakdown", severity "Medium" — cannot be
     initialised from the active lists. If either default has since been retired,
     move to the first one still offered, rather than leaving the form holding a
     value si_guard_retired_reference() will refuse on submit with nothing
     highlighted to explain why. */
  useEffect(() => {
    if (!ready || isEdit) return;
    if (activeTypes.length && !activeTypes.some((t) => t.code === type)) {
      setType(activeTypes[0].code);
    }
    if (activeSeverities.length && !activeSeverities.some((s) => s.code === safetySeverity)) {
      setSafetySeverity(activeSeverities[0].code);
    }
  }, [ready, isEdit, activeTypes, activeSeverities, type, safetySeverity]);

  const assetOptions = offeredAssets.map((m) => ({
    value: m.id,
    label: m.name,
    hint: `${m.asset_code || m.id} · ${departmentName(m.department_id)}`,
  }));

  const departmentOptions = offeredDepartments.map((d) => ({ value: d.id, label: d.name, hint: d.code }));

  /**
   * Picking equipment sets the department to whoever maintains that machine —
   * every time, not only when the field is empty. The asset is the more specific
   * choice of the two, so it wins; the field stays editable afterwards for the
   * case where the machine's registered owner is not who should handle it.
   */
  function handleAssetChange(id) {
    setAssetId(id);
    const a = assetById(id);
    if (a?.department_id) setDepartmentId(a.department_id);
  }

  /**
   * No longer clears a mismatched asset. The pair is *allowed* to disagree now:
   * department says who triages, the asset says which machine, and a lathe
   * handled this once by Toolroom is a real situation rather than a data error.
   */
  function handleDepartmentChange(id) {
    setDepartmentId(id);
  }

  /**
   * Register a machine that isn't in the list (migration 0032). Selected right
   * away rather than waiting for Realtime to deliver the row, same as the
   * department below — and it sets the department too, because handleAssetChange
   * is bypassed here and the pair would otherwise disagree on a brand new asset.
   */
  async function handleCreateAsset(name) {
    setCreatingAsset(true);
    setSubmitError(null);
    try {
      const created = await createAsset({ name, departmentId });
      setAssetId(created.id);
      if (created.department_id) setDepartmentId(created.department_id);
    } catch (e) {
      setSubmitError(describeError(e, "Couldn't register that equipment."));
    } finally {
      setCreatingAsset(false);
    }
  }

  async function handleCreateDepartment(name) {
    setCreatingDept(true);
    setSubmitError(null);
    try {
      const created = await createDepartment({ name });
      // Realtime will deliver the new row to every open session including this
      // one, but selecting it here rather than waiting for that round trip keeps
      // the picker from appearing to have done nothing.
      setDepartmentId(created.id);
    } catch (e) {
      setSubmitError(describeError(e, "Couldn't add that department."));
    } finally {
      setCreatingDept(false);
    }
  }

  function validate() {
    const errs = {};
    if (!departmentId) errs.department = "Select a department.";
    if (!assetId) errs.asset = "Select the affected equipment.";
    if (!complaint || complaint.length < 10) errs.complaint = "Describe the complaint (min. 10 characters).";
    if (!impact) errs.impact = "Select the production impact.";
    if (!requester) errs.requester = "Requester name is required.";
    if (!phone || phone.replace(/\D/g, "").length < 7) errs.phone = "Enter a valid phone number.";
    return errs;
  }

  async function handleSubmit() {
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      if (isEdit) {
        await updateWorkOrderFields(existing.id, {
          department_id: departmentId,
          asset_id: asset.id,
          asset_name: asset.name,
          area: area.trim() || null,
          type,
          priority: effectivePriority || "P3",
          impact,
          description: complaint,
          safety_risk: safety,
          environmental_risk: env,
          permit_required: !!safety.flag,
          requester_name: requester,
          requester_phone: phone,
        });
        router.push(`/work-orders/view?id=${existing.id}`);
        return;
      }

      const woId = await createWorkOrder({
        departmentId,
        assetId: asset.id,
        assetName: asset.name,
        area,
        type,
        priority: effectivePriority || "P3",
        impact,
        description: complaint,
        safetyRisk: safety,
        environmentalRisk: env,
        requesterId: user.uid,
        requesterName: requester,
        requesterPhone: phone,
      });

      const actor = { uid: user.uid, name: requester, role: user.role };
      /* addAttachment compresses each photo before it uploads, so these are the
         only bytes that reach storage — see the note there. */
      await Promise.all(photos.map((p) => addAttachment(woId, actor, p, "photo")));

      router.push(`/work-orders/view?id=${woId}`);
    } catch (e) {
      setSubmitError(
        describeError(
          e,
          isEdit
            ? "Couldn't save these changes. Your edits are still here — try again."
            : "Couldn't submit this work order. Your entries are still here — try again."
        )
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <button onClick={() => router.push(isEdit ? `/work-orders/view?id=${existing.id}` : "/work-orders")} className="flex items-center gap-1.5 text-ink-soft text-[13px] mb-3.5">
        <ArrowLeft size={15} /> {isEdit ? "Back to Work Order" : "Back to Work Orders"}
      </button>
      <h1 className="text-xl font-bold text-ink mb-1">{isEdit ? `Edit ${existing.wo_number}` : "Raise Work Order"}</h1>
      <p className="text-[13px] text-ink-soft mb-6">
        {isEdit
          ? "Core details can be corrected while this work order is still Open — before a technician is assigned."
          : "Priority is set from the production impact, and escalates for safety or environmental risk."}
      </p>

      {submitError && <ErrorBanner message={submitError} />}

      {/* Stacked below `lg`, two columns above. The old `flex-wrap` +
          `min-w-[380px]` pair looked responsive but wasn't: min-width is a floor
          flex-wrap can't go under, so on any phone narrower than 380px the
          column overflowed the viewport instead of wrapping. */}
      <div className="flex flex-col gap-5 lg:flex-row lg:gap-6">
        <div className="min-w-0 lg:flex-[2]">
          <Card className="p-4 sm:p-5">
            {/* Department first, equipment second.

                Picking a machine still fills the department in from whoever
                maintains it — handleAssetChange has not changed — so answering
                in this order means the second answer can overwrite the first.
                That is the right way round: the asset is the more specific of
                the two and knows its own owner, and the field stays editable
                afterwards for the case where the registered owner is not who
                should handle this one.

                It also un-inverts registering a NEW machine, which is the case
                the old order got backwards: createAsset() refuses to start
                without a department (migration 0032), because assets.department_id
                is `not null`. Asking for equipment first meant the person adding
                a machine had to go back up for the field they had just skipped. */}
            <Field
              label="Department"
              required
              hint={errors.department}
            >
              <Combobox
                value={departmentId}
                onChange={handleDepartmentChange}
                options={departmentOptions}
                loading={!ready || creatingDept}
                loadingLabel={creatingDept ? "Adding…" : "Loading…"}
                placeholder="Search departments…"
                emptyLabel="No departments yet"
                onCreate={handleCreateDepartment}
                createLabel="Add department"
              />
              <p className="mt-1.5 text-[11.5px] text-ink-soft">
                Who should handle this. Picking the equipment below fills this in from the machine&apos;s
                own department — change it afterwards if someone else should take it, or type a name
                that isn&apos;t listed to add it.
              </p>
            </Field>

            <Field label="Equipment" required hint={errors.asset}>
              <Combobox
                value={assetId}
                onChange={handleAssetChange}
                options={assetOptions}
                loading={!ready || creatingAsset}
                loadingLabel={creatingAsset ? "Adding…" : "Loading…"}
                placeholder="Search equipment by name, asset code or department…"
                emptyLabel="No equipment registered yet"
                noMatchLabel="No equipment matches that"
                onCreate={handleCreateAsset}
                createLabel="Add equipment"
              />
              <p className="mt-1.5 text-[11.5px] text-ink-soft">
                Can&apos;t find the machine? With the department above set, type the name here to
                register it.
              </p>
            </Field>

            <Field label="Area">
              <input
                value={area}
                onChange={(e) => setArea(e.target.value)}
                maxLength={120}
                placeholder="Where in the plant — line, bay, floor"
                className={inputClass}
              />
            </Field>
            {asset && (
              <div className="flex items-center gap-2 bg-canvas rounded px-3 py-2 mb-4 text-[12.5px] text-ink-soft">
                <Factory size={14} /> Criticality: <strong className="text-ink">{asset.criticality}</strong>
                <span className="mx-1">·</span> Asset ID: <span className="font-mono">{asset.asset_code || asset.id}</span>
              </div>
            )}

            <Field label="Work order type">
              <div className="flex flex-wrap gap-2">
                {offeredTypes.map((t) => (
                  <button
                    key={t.code}
                    type="button"
                    onClick={() => setType(t.code)}
                    title={t.description || undefined}
                    className={`px-3.5 py-2 rounded text-[13px] font-medium border ${type === t.code ? "bg-ink text-white border-ink" : "bg-white text-ink border-[#D8DEE4]"}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Complaint" required hint={errors.complaint}>
              <textarea value={complaint} onChange={(e) => setComplaint(e.target.value)} rows={4} placeholder="What happened? Include symptoms, sounds, error codes…" className={`${inputClass} resize-y`} />
            </Field>

            {/* Production impact now sits ABOVE priority, where it did not
                before. Priority is derived from it, and a derived value printed
                above the field it derives from reads backwards — the reader has
                to scroll down to find out why it says what it says. */}
            <Field label="Production impact" required hint={errors.impact}>
              <div className="flex flex-col gap-2">
                {offeredImpacts.map((opt) => (
                  <label
                    key={opt.code}
                    title={opt.description || undefined}
                    className="flex items-center justify-between px-3 py-2.5 rounded border cursor-pointer"
                    style={{ borderColor: impact === opt.code ? "#F59E0B" : "#E2E6EA", background: impact === opt.code ? "#FDE7C4" : "#fff" }}
                  >
                    <span className="flex items-center gap-2 text-[13.5px] text-ink">
                      <input type="radio" checked={impact === opt.code} onChange={() => setImpact(opt.code)} className="accent-accent" />
                      {opt.label}
                    </span>
                    <PriorityBadge p={opt.suggests_priority} size="sm" />
                  </label>
                ))}
              </div>
            </Field>

            {/* Read-only, and rendered as a statement rather than as a disabled
                control: four greyed-out buttons would still read as "you may
                choose, just not now", which is the wrong idea entirely. */}
            <Field label="Priority">
              <div
                className="rounded px-3.5 py-3 border"
                style={{
                  background: effectivePriority ? `${priorityColor(effectivePriority)}0D` : "#F6F8FB",
                  borderColor: effectivePriority ? `${priorityColor(effectivePriority)}55` : "#E5E9F0",
                }}
              >
                {effectivePriority ? (
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                    <PriorityBadge p={effectivePriority} />
                    <span className="text-[12.5px] text-ink-soft">
                      Set from the production impact
                      {safetyFlag ? ", raised for safety risk" : ""}
                      {envFlag ? ", raised for environmental risk" : ""}. Not editable.
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Sparkles size={14} className="text-accent" />
                    <span className="text-[12.5px] text-ink-soft">
                      Choose the production impact above and the priority follows from it.
                    </span>
                  </div>
                )}
              </div>
            </Field>

            {!isEdit && (
              <div className="mb-4">
                <FileUploadField label="Upload Photo" icon={ImageIcon} accept="image/*" inputRef={photoInput} files={photos} onSelect={(f) => setPhotos((p) => [...p, ...f])} onRemove={(i) => setPhotos((p) => p.filter((_, idx) => idx !== i))} previewImages />
                <p className="mt-1.5 text-[11.5px] text-ink-soft">
                  Resized and compressed on this device before it uploads, so a photo straight off a
                  phone camera goes up in a fraction of the time.
                </p>
              </div>
            )}
            {isEdit && (
              <div className="text-[11.5px] text-ink-soft mb-4">
                Photos are managed from the Attachments tab on the work order itself, not from this edit form.
              </div>
            )}

            <Field label="Safety risk">
              <div className="mb-2 flex flex-wrap items-center gap-3">
                {["No", "Yes"].map((v) => (
                  <button
                    key={v}
                    onClick={() => setSafetyFlag(v === "Yes")}
                    className="px-5 py-2 rounded text-[13px] font-semibold border"
                    style={{ borderColor: (v === "Yes") === safetyFlag ? "#EF4444" : "#D8DEE4", background: (v === "Yes") === safetyFlag ? "#FCE9E9" : "#fff", color: (v === "Yes") === safetyFlag ? "#EF4444" : "#64748B" }}
                  >
                    {v}
                  </button>
                ))}
              </div>
              {safetyFlag && (
                <div className="flex gap-2">
                  {offeredSeverities.map((s) => (
                    <button
                      key={s.code}
                      type="button"
                      onClick={() => setSafetySeverity(s.code)}
                      title={`${s.label} — raises the priority to at least ${s.escalates_to_priority}`}
                      className="flex-1 py-1.5 rounded text-[12px] font-semibold border"
                      style={{ borderColor: safetySeverity === s.code ? "#EF4444" : "#D8DEE4", background: safetySeverity === s.code ? "#FCE9E9" : "#fff", color: safetySeverity === s.code ? "#EF4444" : "#64748B" }}
                    >
                      {s.code}
                    </button>
                  ))}
                </div>
              )}
              {/* Said out loud, not just in a `title`. Priority is derived and
                  sits ABOVE this field, so flagging a risk down here changes a
                  value that may well be off the top of the screen — under the
                  old design an override was a deliberate click, and the effect
                  was where the eye already was. */}
              {safetyCeiling && (
                <p className="mt-1.5 text-[11.5px] text-ink-soft">
                  Raises the priority to at least{" "}
                  <strong style={{ color: priorityColor(safetyCeiling) }}>{safetyCeiling}</strong>.
                </p>
              )}
            </Field>

            <Field label="Environmental risk">
              <div className="flex items-center gap-3">
                {["No", "Yes"].map((v) => (
                  <button
                    key={v}
                    onClick={() => setEnvFlag(v === "Yes")}
                    className="px-5 py-2 rounded text-[13px] font-semibold border"
                    style={{ borderColor: (v === "Yes") === envFlag ? "#F59E0B" : "#D8DEE4", background: (v === "Yes") === envFlag ? "#FDE7C4" : "#fff", color: (v === "Yes") === envFlag ? "#8A5A0A" : "#64748B" }}
                  >
                    {v}
                  </button>
                ))}
              </div>
              {envCeiling && (
                <p className="mt-1.5 text-[11.5px] text-ink-soft">
                  Raises the priority to at least{" "}
                  <strong style={{ color: priorityColor(envCeiling) }}>{envCeiling}</strong>.
                </p>
              )}
            </Field>

            <div className="flex flex-col sm:flex-row sm:gap-4">
              <div className="flex-1">
                <Field label="Requester" required hint={errors.requester}>
                  <input value={requester} onChange={(e) => setRequester(e.target.value)} className={inputClass} />
                </Field>
              </div>
              <div className="flex-1">
                <Field label="Phone number" required hint={errors.phone}>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
                </Field>
              </div>
            </div>
          </Card>
        </div>

        <div className="min-w-0 lg:flex-1">
          {/* Only sticky once it's a real side column — stuck to the top of a
              stacked mobile layout it would hover over the form fields below it.
              top-20 clears the sticky app header. */}
          <div className="rounded bg-navy p-4 text-white sm:p-5 lg:sticky lg:top-20">
            <div className="flex items-center gap-2 mb-3.5">
              <AlertTriangle size={15} className="text-accent" />
              <span className="font-bold text-[14px]">SLA preview</span>
            </div>
            {effectivePriority ? (
              <>
                <div className="flex items-center gap-2 mb-4">
                  <PriorityBadge p={effectivePriority} />
                  <span className="text-[12.5px] text-[#B9C9E8]">From production impact</span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {[
                    ["Acknowledge by", slaForPriority(effectivePriority)?.ack_target_label],
                    ["Response by", slaForPriority(effectivePriority)?.response_target_label],
                    ["Resolution by", slaForPriority(effectivePriority)?.resolution_target_label],
                  ].map(([label, val]) => (
                    <div key={label} className="flex items-center justify-between text-[12.5px]">
                      <span className="text-[#B9C9E8]">{label}</span>
                      <span className="font-mono font-semibold">{val ?? "—"}</span>
                    </div>
                  ))}
                </div>
                {isEdit && (
                  <div className="text-[11px] text-[#B9C9E8] mt-3 pt-3 border-t border-[#2C5AA8]">
                    Changing the impact re-derives the priority, but SLA deadlines already set at creation are not changed retroactively.
                  </div>
                )}
              </>
            ) : (
              <p className="text-[12.5px] text-[#B9C9E8]">Fill in the form to see the priority and SLA targets here.</p>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="amber" icon={isEdit ? Save : Send} onClick={handleSubmit} disabled={submitting} className="flex-1 justify-center">
              {submitting ? "Saving…" : isEdit ? "Save Changes" : "Submit"}
            </Button>
            <Button variant="ghost" className="justify-center" onClick={() => router.push(isEdit ? `/work-orders/view?id=${existing.id}` : "/work-orders")}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FileUploadField({ label, icon: Icon, accept, inputRef, files, onSelect, onRemove, previewImages }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="text-[12.5px] font-semibold text-ink mb-2">{label}</div>
      <button onClick={() => inputRef.current.click()} className="w-full flex items-center justify-center gap-2 py-4 border border-dashed border-[#D8DEE4] rounded bg-canvas text-ink-soft text-[13px]">
        <Icon size={16} /> {label}
      </button>
      <input ref={inputRef} type="file" accept={accept} multiple hidden onChange={(e) => onSelect(Array.from(e.target.files || []))} />
      {files.length > 0 && (
        <div className="flex gap-2 flex-wrap mt-2.5">
          {files.map((f, i) =>
            previewImages ? (
              <div key={i} className="relative w-16 h-16 rounded overflow-hidden border border-border">
                <img src={URL.createObjectURL(f)} alt={f.name} className="w-full h-full object-cover" />
                <button onClick={() => onRemove(i)} className="absolute top-0.5 right-0.5 bg-black/60 rounded text-white p-0.5">
                  <X size={11} />
                </button>
              </div>
            ) : (
              <div key={i} className="flex items-center justify-between text-[12.5px] bg-canvas rounded px-2.5 py-1.5 w-full">
                <span className="truncate">{f.name}</span>
                <button onClick={() => onRemove(i)} className="text-ink-soft">
                  <X size={13} />
                </button>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
