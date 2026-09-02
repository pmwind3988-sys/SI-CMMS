"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Factory, Image as ImageIcon, X, Sparkles, AlertTriangle, Send, Save } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { createWorkOrder, updateWorkOrderFields, addAttachment } from "../../lib/workOrders";
import { useReferenceData, includingCurrent } from "../../lib/referenceData";
import { createDepartment } from "../../lib/admin";
import { describeError } from "../../lib/errors";
import { registerDraftSource, takeDraft } from "../../lib/draftRecovery";
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
/**
 * The on-screen label for each key validate() can return, so a blocked submit
 * can say WHERE to look.
 *
 * Every one of these already renders a precise hint beside its own field, and
 * that is still the better message — but it is beside the *field*, and the
 * button sits at the bottom of a sidebar of its own. `Production impact` is the
 * case that proves it: a radio group halfway up the form with no default, so a
 * form filled in from the top and submitted from the bottom showed nothing at
 * all near the pointer and read as a dead button.
 *
 * Module scope, not inside the component: `blockedFields` is derived near the
 * top of the render and this would otherwise be read before its own `const`
 * initialised — a ReferenceError on every render rather than a wrong label.
 *
 * Keep these in step with the `label` on each Field, since the whole value of
 * the summary is that the words match what the eye is hunting for.
 */
/**
 * What an "Other (specify)" work order's equipment name is prefixed with.
 *
 * One constant because it is written on submit and read back when editing, and
 * the two have to agree — a mismatch would show an empty "Which equipment"
 * field on a work order that plainly has one, and then require it to be retyped
 * before the form would submit.
 */
const OTHER_PREFIX = "Other — ";

const ERROR_FIELD_LABELS = {
  department: "Department",
  plant: "Plant",
  asset: "Equipment",
  otherEquipment: "Which equipment",
  complaint: "Complaint",
  impact: "Production impact",
  requester: "Requester",
  phone: "Phone number",
};

export default function RaiseWorkOrderForm({ existing }) {
  const { user } = useAuth();
  /* Both halves of every retirable set (migration 0031). The active* lists are
     what this form offers; the full lists are only there so that editing a work
     order raised before a retirement still shows the value it actually has —
     see includingCurrent() below. */
  const {
    ready,
    plants,
    departments,
    assets,
    impacts,
    types,
    severities,
    activePlants,
    activeDepartments,
    activeAssets,
    activeImpacts,
    activeTypes,
    activeSeverities,
    assetById,
    assetsForPlant,
    plantName,
    priorityColor,
    slaForPriority,
    suggestPriority,
  } = useReferenceData();
  const router = useRouter();
  const isEdit = !!existing;

  const [departmentId, setDepartmentId] = useState(existing?.department_id || "");
  /* Which site the machine is on, and what the equipment picker narrows to
     (migration 0049). Blank on a new work order rather than defaulted to a
     plant, because guessing it would silently file an F3 fault against F1 —
     the four master lists are disjoint and several codes appear in more than
     one of them. */
  const [plantId, setPlantId] = useState(existing?.plant_id || "");
  const [assetId, setAssetId] = useState(existing?.asset_id || "");
  /* What the user typed after choosing "Other (specify)". Recorded on THIS work
     order as its equipment name and nowhere else: no row is added to the
     equipment register, which is the whole point of the option.

     Read back off `asset_name` when editing, rather than left blank. The name is
     not recoverable from `asset_id` — that points at the plant's shared Other
     row — so the prefix is the only thing carrying it, and starting empty would
     make editing anything else about the work order silently demand the machine
     name again. Tested on the string rather than through assetById() because
     this runs before the reference data has arrived. */
  const [otherEquipment, setOtherEquipment] = useState(
    existing?.asset_name?.startsWith(OTHER_PREFIX)
      ? existing.asset_name.slice(OTHER_PREFIX.length)
      : ""
  );
  const [area, setArea] = useState(existing?.area || "");
  const [creatingDept, setCreatingDept] = useState(false);
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
  /** Set when this form was rebuilt from a draft rescued off a failed session. */
  const [restored, setRestored] = useState(false);

  const photoInput = useRef(null);

  /* ---------------------------------------------------------------------- *
   * Surviving a forced sign-in.
   *
   * This is the most expensive thing in the app to lose: it is typed on a
   * phone, on a plant floor, by somebody standing in front of the fault. If a
   * session cannot be renewed silently the user has to sign in again, and
   * signing in means leaving this page.
   *
   * See lib/draftRecovery.js for the storage rules. Two things about the wiring
   * here:
   * ---------------------------------------------------------------------- */

  /**
   * Edit drafts and new-work-order drafts must never meet.
   *
   * Restoring an edit of WO-118 into a blank raise form would silently re-file
   * one machine's fault against whatever the form happened to be pointing at —
   * and restoring it into a DIFFERENT work order's edit form is worse. The id
   * in the key makes both impossible rather than unlikely.
   */
  const draftKey = existing ? `workorder:edit:${existing.id}` : "workorder:new";

  /**
   * Everything worth rescuing, and nothing else.
   *
   * `photos` is absent and cannot be added: those are live browser File
   * handles, not data. They have no serialisable form, they are not readable
   * back from sessionStorage, and a 4MB photo would blow the storage quota even
   * if they were. The restore notice says so out loud rather than letting
   * somebody submit a fault report believing the picture is still attached.
   *
   * Transient state is absent too — `errors`, `submitting`, `submitError`,
   * `creatingDept`. Restoring a validation error the user has
   * not earned yet, or a spinner for a submit that never happened, would be
   * restoring the interruption rather than the work.
   */
  const snapshot = () => ({
    departmentId,
    plantId,
    assetId,
    otherEquipment,
    area,
    type,
    complaint,
    impact,
    safetyFlag,
    safetySeverity,
    envFlag,
    requester,
    phone,
  });

  /**
   * Read by the registered source instead of the values it closed over.
   *
   * registerDraftSource runs in an effect with an empty dependency list — it
   * must, or every keystroke would tear the registration down and rebuild it —
   * so the function it registers is the FIRST render's, and would snapshot an
   * empty form no matter what had been typed since. Pointing it at a ref
   * refreshed on every render is what makes it read the current values. This is
   * the bug that would make the whole feature look like it worked and save
   * nothing.
   */
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  /**
   * What the form looked like before anybody touched it.
   *
   * An untouched form declines to be saved — returning null from the source —
   * because a restored empty draft is a confusing no-op, and in edit mode a
   * "restored" banner over the values the work order already had would be a
   * lie. Comparing against the initial state covers both modes without asking
   * every field to report that it changed.
   */
  const pristine = useRef(null);
  if (pristine.current === null) pristine.current = JSON.stringify(snapshot());

  useEffect(() => {
    if (!user?.uid) return undefined;
    return registerDraftSource(draftKey, () => {
      const current = snapshotRef.current();
      return JSON.stringify(current) === pristine.current ? null : current;
    });
  }, [user?.uid, draftKey]);

  /**
   * Put a rescued draft back, once, on mount.
   *
   * takeDraft removes it as it reads it, so a browser Back into this page does
   * not resurrect text the user has already moved on from — the same read-once
   * discipline lib/toastHandoff.js uses. Ownership is enforced by the uid being
   * part of the key: a different account signing in on the same terminal looks
   * under its own uid and finds nothing.
   */
  useEffect(() => {
    if (!user?.uid) return;
    const draft = takeDraft(user.uid, draftKey);
    if (!draft) return;
    if (draft.departmentId !== undefined) setDepartmentId(draft.departmentId);
    if (draft.plantId !== undefined) setPlantId(draft.plantId);
    if (draft.assetId !== undefined) setAssetId(draft.assetId);
    if (draft.otherEquipment !== undefined) setOtherEquipment(draft.otherEquipment);
    if (draft.area !== undefined) setArea(draft.area);
    if (draft.type !== undefined) setType(draft.type);
    if (draft.complaint !== undefined) setComplaint(draft.complaint);
    if (draft.impact !== undefined) setImpact(draft.impact);
    if (draft.safetyFlag !== undefined) setSafetyFlag(draft.safetyFlag);
    if (draft.safetySeverity !== undefined) setSafetySeverity(draft.safetySeverity);
    if (draft.envFlag !== undefined) setEnvFlag(draft.envFlag);
    if (draft.requester !== undefined) setRequester(draft.requester);
    if (draft.phone !== undefined) setPhone(draft.phone);
    setRestored(true);
    // Mount only. draftKey and uid cannot change without this component being
    // rebuilt for a different work order, which should take its own draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, draftKey]);

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
  /* PLT001 is retired (0049) and every work order raised before then carries
     it, so editing one of those has to keep its own plant in the picker — the
     same reason every other picker here goes through includingCurrent. */
  const offeredPlants = includingCurrent(activePlants, plants, isEdit ? plantId : null, "id");
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

  /* Ordered by ERROR_FIELD_LABELS rather than by Object.keys(errors), so the
     summary reads top-to-bottom in the order the fields appear on screen. */
  const blockedFields = Object.keys(ERROR_FIELD_LABELS)
    .filter((k) => errors[k])
    .map((k) => ERROR_FIELD_LABELS[k]);

  /**
   * Equipment, narrowed to the chosen plant — and narrowed to nothing until one
   * is chosen.
   *
   * Migration 0049 replaced the department narrowing with this one. The two are
   * not the same shape and the difference is deliberate: with no department
   * chosen the old picker offered every machine on site, because a department
   * was a hint about who triages and a fault could be filed against anything
   * (0019). A plant is a fact about where the machine physically is, and the
   * four master lists overlap — F1, F2 and F3 each have an AC1 and F2 and F3
   * each have a BP — so one flat list of all four sites would offer four
   * different machines under the same code and no way to tell them apart. With
   * no plant chosen there is nothing sensible to offer, so nothing is.
   *
   * There is no "show equipment from every plant" escape hatch for the same
   * reason. Choosing the plant IS the answer, it sits one field above, and
   * changing it re-narrows immediately.
   *
   * includingCurrent again, and load-bearing here: editing a work order raised
   * against a machine since decommissioned — which is every machine that was in
   * the register before 0049 — must not silently move the selection to the
   * first row still offered.
   */
  const plantAssets = plantId
    ? includingCurrent(
        offeredAssets.filter((m) => m.plant_id === plantId),
        offeredAssets,
        assetId || null,
        "id"
      )
    : includingCurrent([], offeredAssets, assetId || null, "id");

  /**
   * The "Other (specify)" row for the chosen plant, kept out of the ordinary
   * list and appended last.
   *
   * Sorting it to the bottom rather than letting it fall alphabetically among
   * the machines is the point: it is an escape hatch, not a machine, and in
   * F1's 63 rows it would otherwise sit between "Milling No 4" and "Plasma No
   * 2" where nobody looking for it would find it.
   */
  const otherAsset = plantAssets.find((m) => m.asset_code === "OTHER") || null;
  const listedAssets = plantAssets.filter((m) => m.asset_code !== "OTHER");

  /** Has the user chosen "Other" rather than a machine? */
  const isOther = !!assetId && assetById(assetId)?.asset_code === "OTHER";

  const assetOptions = [
    ...listedAssets.map((m) => ({
      value: m.id,
      label: m.name,
      hint: [m.asset_code || m.id, m.model, plantName(m.plant_id)].filter(Boolean).join(" · "),
    })),
    ...(otherAsset
      ? [{ value: otherAsset.id, label: otherAsset.name, hint: "Not in the list — type what it is" }]
      : []),
  ];

  const departmentOptions = offeredDepartments.map((d) => ({ value: d.id, label: d.name, hint: d.code }));
  const plantOptions = offeredPlants.map((pl) => ({ value: pl.id, label: pl.name, hint: pl.code }));

  /**
   * Picking equipment sets the PLANT from the machine, not the department.
   *
   * The old version filled the department in from `assets.department_id`, which
   * 0049 left null on all 134 imported machines — the master lists record a
   * location, not a department. So it would have cleared a department the user
   * had just chosen, on every machine in the register. The plant is the field
   * the machine actually knows, and this only matters when the picker was
   * answered before the plant was: the list is already scoped to the plant, so
   * the value it sets is normally the one already there.
   *
   * Leaving "Other" clears what was typed for it. Left behind, a work order
   * would carry a machine chosen from the list and a leftover free-text name
   * for something else, and the free text is what gets stored.
   */
  function handleAssetChange(id) {
    setAssetId(id);
    const a = assetById(id);
    if (a?.plant_id) setPlantId(a.plant_id);
    if (a?.asset_code !== "OTHER") setOtherEquipment("");
  }

  /**
   * Changing the plant clears the equipment, which is not what changing the
   * department does.
   *
   * The pair is allowed to disagree for department and asset (0019: department
   * says who triages, the asset says which machine). Plant and asset cannot
   * disagree — the plant IS where that machine is, so a work order naming F3
   * and an F1 lathe is not a real situation, it is a stale selection. Keeping
   * it would also leave a machine on screen that the picker no longer offers.
   */
  function handlePlantChange(id) {
    setPlantId(id);
    setAssetId("");
    setOtherEquipment("");
  }

  /**
   * No longer clears a mismatched asset. The pair is *allowed* to disagree now:
   * department says who triages, the asset says which machine, and a lathe
   * handled this once by Toolroom is a real situation rather than a data error.
   */
  function handleDepartmentChange(id) {
    setDepartmentId(id);
  }

  /* handleCreateAsset is gone. Migration 0049 narrowed assets_insert to
     si_is_admin(), so this form can no longer register a machine — the
     controlled per-plant lists plus "Other (specify)" replace it. The policy is
     the boundary; removing the button only stops offering an action whose one
     possible outcome is now a refusal. */

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
    if (!plantId) errs.plant = "Select the plant.";
    if (!assetId) errs.asset = "Select the affected equipment.";
    /* Only when "Other" is chosen, and it has to be required: the work order
       would otherwise record its equipment as the literal words "Other
       (specify)", which names nothing. */
    if (isOther && otherEquipment.trim().length < 3) {
      errs.otherEquipment = "Say what the equipment is (min. 3 characters).";
    }
    if (!complaint || complaint.length < 10) errs.complaint = "Describe the complaint (min. 10 characters).";
    if (!impact) errs.impact = "Select the production impact.";
    if (!requester) errs.requester = "Requester name is required.";
    if (!phone || phone.replace(/\D/g, "").length < 7) errs.phone = "Enter a valid phone number.";
    return errs;
  }

  /**
   * What goes into `work_orders.asset_name`.
   *
   * For a listed machine it is the register's own name, denormalised the way it
   * always was. For "Other" it is what the user typed, prefixed so the row
   * reads honestly everywhere it appears — the list, the detail page and the
   * export all show this column, and "Other (specify)" on its own would name
   * nothing. `asset_id` still points at the plant's Other row, so the foreign
   * key holds and the equipment register gains nothing.
   */
  const equipmentName = isOther ? `${OTHER_PREFIX}${otherEquipment.trim()}` : asset?.name ?? null;

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
          plant_id: plantId,
          asset_id: asset.id,
          asset_name: equipmentName,
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
        plantId,
        departmentId,
        assetId: asset.id,
        assetName: equipmentName,
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
      <button onClick={() => router.push(isEdit ? `/work-orders/view?id=${existing.id}` : "/work-orders")} className="-my-2 -ml-1 mb-1 inline-flex min-h-[44px] items-center gap-1.5 rounded px-1 text-[13px] font-semibold text-ink-soft">
        <ArrowLeft size={15} /> {isEdit ? "Back to Work Order" : "Back to Work Orders"}
      </button>
      <h1 className="text-xl font-bold text-ink mb-1">{isEdit ? `Edit ${existing.wo_number}` : "Raise Work Order"}</h1>
      <p className="text-[13px] text-ink-soft mb-6">
        {isEdit
          ? "Core details can be corrected while this work order is still Open — before a technician is assigned."
          : "Priority is set from the production impact, and escalates for safety or environmental risk."}
      </p>

      {/**
        * The restore notice.
        *
        * Amber and informational rather than red: nothing went wrong from the
        * user's side and nothing needs fixing — except the photos, which is
        * exactly why the sentence names them. A silent restore would be worse
        * than no restore at all here, because somebody who attached three
        * pictures of a leaking seal before being signed out would otherwise
        * submit the report believing they were still there.
        */}
      {restored && (
        <div className="mb-4 flex items-start gap-2 rounded border border-[#F59E0B55] bg-[#FEF3C7] px-4 py-3 text-[13px] text-[#78350F]">
          <Save size={15} className="mt-0.5 flex-shrink-0" />
          <span className="min-w-0">
            Restored what you had typed before your session ended.{" "}
            <strong className="font-semibold">Any photos need attaching again</strong> — those
            couldn’t be saved.
          </span>
        </div>
      )}

      {submitError && <ErrorBanner message={submitError} />}

      {/* Stacked below `lg`, two columns above. The old `flex-wrap` +
          `min-w-[380px]` pair looked responsive but wasn't: min-width is a floor
          flex-wrap can't go under, so on any phone narrower than 380px the
          column overflowed the viewport instead of wrapping. */}
      <div className="flex flex-col gap-5 lg:flex-row lg:gap-6">
        <div className="min-w-0 lg:flex-[2]">
          <Card className="p-4 sm:p-5">
            {/* Department, then plant, then equipment.

                Department stays first because it is the one question a person
                answers about themselves — who should handle this — and 0019 is
                still the rule there: it says who triages and is allowed to
                disagree with where the machine is.

                Plant sits between them because it is what the equipment picker
                narrows on (migration 0049), and a list you have to scope is
                unusable until the thing that scopes it has been answered. The
                old form had equipment second and filled the department in from
                the machine; that stopped working when the imported machines
                arrived carrying a location and no department. */}
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
                Who should handle this. Change it if someone else should take it, or type a name
                that isn&apos;t listed to add it.
              </p>
            </Field>

            <Field label="Plant" required hint={errors.plant}>
              <Combobox
                value={plantId}
                onChange={handlePlantChange}
                options={plantOptions}
                loading={!ready}
                placeholder="Search plants…"
                emptyLabel="No plants configured"
              />
              <p className="mt-1.5 text-[11.5px] text-ink-soft">
                Where the machine is. This is what decides the equipment list below — changing it
                clears the equipment, because each plant keeps its own machines.
              </p>
            </Field>

            <Field label="Equipment" required hint={errors.asset}>
              <Combobox
                value={assetId}
                onChange={handleAssetChange}
                options={assetOptions}
                loading={!ready}
                placeholder={
                  plantId ? "Search equipment by name or machine code…" : "Choose a plant first"
                }
                emptyLabel={
                  plantId ? "No equipment registered for this plant" : "Choose a plant first"
                }
                noMatchLabel="No equipment matches that — choose “Other (specify)”"
              />
              {/* No "+ Add equipment" any more: migration 0049 narrowed
                  assets_insert to si_is_admin(), so the one possible outcome of
                  offering it would be a policy refusal. "Other (specify)" is
                  what replaces it, and it deliberately registers nothing. */}
              <p className="mt-1.5 text-[11.5px] text-ink-soft">
                {plantId
                  ? `Showing ${plantName(plantId)}'s machines. Not listed? Choose “Other (specify)” at the bottom and say what it is.`
                  : "Pick the plant above and its machines appear here."}
              </p>
            </Field>

            {/* Only once "Other" is actually chosen.

                Rendered as its own required field rather than as a hint on the
                picker, because it IS the equipment on this work order — it is
                what `asset_name` gets stored as, and it is what the list, the
                detail page and the export will show. The sentence under it says
                out loud that nothing is added to the register, so nobody
                expects to find it in the picker next time. */}
            {isOther && (
              <Field label="Which equipment" required hint={errors.otherEquipment}>
                <input
                  value={otherEquipment}
                  onChange={(e) => setOtherEquipment(e.target.value)}
                  maxLength={120}
                  placeholder="Name the machine, tool or fixture"
                  className={inputClass}
                  autoFocus
                />
                <p className="mt-1.5 text-[11.5px] text-ink-soft">
                  Recorded on this work order only — it is not added to the equipment list.
                </p>
              </Field>
            )}

            <Field label="Area">
              <input
                value={area}
                onChange={(e) => setArea(e.target.value)}
                maxLength={120}
                placeholder="Where in the plant — line, bay, floor"
                className={inputClass}
              />
            </Field>
            {/* Facts about the machine chosen — and nothing for "Other", whose
                row carries the register's defaults (criticality "medium", code
                "OTHER") and would state them as though they described the thing
                the user just typed. `model` is shown when the master list had
                one; most rows do not. */}
            {asset && !isOther && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-canvas rounded px-3 py-2 mb-4 text-[12.5px] text-ink-soft">
                <Factory size={14} /> Criticality: <strong className="text-ink">{asset.criticality}</strong>
                <span className="mx-1">·</span> Machine code:{" "}
                <span className="font-mono">{asset.asset_code || asset.id}</span>
                {asset.model && (
                  <>
                    <span className="mx-1">·</span> Model:{" "}
                    <span className="font-mono">{asset.model}</span>
                  </>
                )}
              </div>
            )}

            {/* A group of buttons where exactly one is chosen IS a radio group,
                and saying so is what makes the choice readable: these carried no
                `aria-pressed` and no role, so which type was selected existed
                only as a fill colour.

                The description used to live in a `title`, which on a touch
                device is unreachable — there is no hover on a phone — and where
                it did surface it replaced the visible word as the accessible
                name, so the button announced a sentence that did not match its
                label. It is now rendered under the row for the selected type,
                where everybody can read it. */}
            <fieldset className="mb-4">
              <legend className="mb-1.5 block text-[12.5px] font-semibold text-ink">Work order type</legend>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Work order type">
                {offeredTypes.map((t) => (
                  <button
                    key={t.code}
                    type="button"
                    role="radio"
                    aria-checked={type === t.code}
                    onClick={() => setType(t.code)}
                    className={`min-h-[44px] px-3.5 py-2 rounded text-[13px] font-medium border ${type === t.code ? "bg-ink text-white border-ink" : "bg-white text-ink border-[#D8DEE4]"}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {offeredTypes.find((t) => t.code === type)?.description && (
                <p className="mt-1.5 text-[11.5px] text-ink-soft">
                  {offeredTypes.find((t) => t.code === type).description}
                </p>
              )}
            </fieldset>

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
              {/* THE COLOUR FOLLOWS THE ANSWER, NOT THE FIELD.
                  "No" used to be painted in the danger red because the *topic*
                  was safety, so the reassuring answer wore the alarm colour and
                  a form with nothing wrong with it read as though something
                  were. Selected "No" is now neutral ink; only "Yes" is red,
                  which is the state that actually escalates the priority. */}
              <div className="mb-2 flex flex-wrap items-center gap-3" role="radiogroup" aria-label="Safety risk">
                {["No", "Yes"].map((v) => {
                  const on = (v === "Yes") === safetyFlag;
                  const alarm = v === "Yes";
                  return (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setSafetyFlag(v === "Yes")}
                      className="min-h-[44px] px-5 py-2 rounded text-[13px] font-semibold border"
                      style={{
                        borderColor: on ? (alarm ? "#C1291F" : "#101828") : "#D8DEE4",
                        background: on ? (alarm ? "#FCE9E9" : "#F1F3F7") : "#fff",
                        color: on ? (alarm ? "#C1291F" : "#101828") : "#5A6880",
                      }}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
              {safetyFlag && (
                <div className="flex gap-2" role="radiogroup" aria-label="Safety severity">
                  {offeredSeverities.map((s) => (
                    <button
                      key={s.code}
                      type="button"
                      role="radio"
                      aria-checked={safetySeverity === s.code}
                      onClick={() => setSafetySeverity(s.code)}
                      /* The code alone ("S1") is not a name, and the label plus
                         what it does to the priority sat in a `title` that no
                         phone can reach. The consequence stays spelled out in
                         the line below the group for sighted users. */
                      aria-label={`${s.label} — raises the priority to at least ${s.escalates_to_priority}`}
                      className="min-h-[44px] flex-1 rounded border py-1.5 text-[12px] font-semibold"
                      style={{ borderColor: safetySeverity === s.code ? "#C1291F" : "#D8DEE4", background: safetySeverity === s.code ? "#FCE9E9" : "#fff", color: safetySeverity === s.code ? "#C1291F" : "#5A6880" }}
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
              <div className="flex items-center gap-3" role="radiogroup" aria-label="Environmental risk">
                {["No", "Yes"].map((v) => {
                  const on = (v === "Yes") === envFlag;
                  const alarm = v === "Yes";
                  return (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setEnvFlag(v === "Yes")}
                      className="min-h-[44px] px-5 py-2 rounded text-[13px] font-semibold border"
                      style={{
                        borderColor: on ? (alarm ? "#9D6507" : "#101828") : "#D8DEE4",
                        background: on ? (alarm ? "#FDE7C4" : "#F1F3F7") : "#fff",
                        color: on ? (alarm ? "#7A4E06" : "#101828") : "#5A6880",
                      }}
                    >
                      {v}
                    </button>
                  );
                })}
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
                {/* "by" only reads correctly for a priority whose targets are
                    offsets from the raise time. P7's are stage durations that
                    start when the previous stage is reached (migration 0050),
                    so "Response by 3 days after assignment" would promise
                    something the database does not do — there is no response
                    deadline at all until a technician is assigned. Sequential
                    priorities drop the "by" and gain a sentence saying the
                    clocks start in turn. */}
                <div className="flex flex-col gap-2.5">
                  {[
                    ["Acknowledge", slaForPriority(effectivePriority)?.ack_target_label],
                    ["Response", slaForPriority(effectivePriority)?.response_target_label],
                    ["Resolution", slaForPriority(effectivePriority)?.resolution_target_label],
                  ].map(([label, val]) => (
                    <div key={label} className="flex items-center justify-between gap-3 text-[12.5px]">
                      <span className="flex-shrink-0 text-[#B9C9E8]">
                        {slaForPriority(effectivePriority)?.targets_are_sequential ? label : `${label} by`}
                      </span>
                      <span className="text-right font-mono font-semibold">{val ?? "—"}</span>
                    </div>
                  ))}
                </div>
                {slaForPriority(effectivePriority)?.targets_are_sequential && (
                  <div className="mt-3 border-t border-[#2C5AA8] pt-3 text-[11px] text-[#B9C9E8]">
                    A long-term task is measured in stages: each window starts when the one before it
                    is met, not when the job is raised.
                  </div>
                )}
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
          {/* Goes stale between presses exactly as the per-field hints do — both
              are recomputed by the next handleSubmit — so the two never disagree. */}
          {blockedFields.length > 0 && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 rounded border border-[#EF444455] bg-[#FCE9E9] px-3 py-2.5 text-[12.5px] text-danger-text"
            >
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span className="min-w-0">
                {blockedFields.length === 1
                  ? `${blockedFields[0]} still needs an answer — scroll up to it.`
                  : `${blockedFields.length} fields still need an answer: ${blockedFields.join(", ")}.`}
              </span>
            </div>
          )}
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
