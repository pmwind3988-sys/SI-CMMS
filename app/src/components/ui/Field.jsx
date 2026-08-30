"use client";

import { Children, cloneElement, isValidElement, useId } from "react";

/**
 * SI — Service Inside · labelled form field
 * ============================================================================
 * The label is ATTACHED to its control, not merely drawn above it.
 *
 * This component used to render the `<label>` as a sibling of `{children}`
 * with no `htmlFor`, which reads correctly on screen and means nothing at all
 * to assistive technology: measured on the Raise Work Order form, 15 labels
 * and zero associations, so a screen reader announced "edit text, blank" for
 * Department, Equipment, Area, Complaint, Requester and Phone number. Every
 * form in the product went through here, so every form had it.
 *
 * Three things follow from doing it properly, and they are the reason this is
 * a clone rather than a wrapper:
 *
 *  - The id has to come from `useId()`, not a counter or a slug of the label.
 *    These pages are a static export that hydrates, so an id generated
 *    differently on the server and the client is a hydration mismatch and
 *    React discards the tree. `useId` is stable across both by construction.
 *  - The id is only injected when the child does not already have one, so a
 *    call site that manages its own id (Combobox, PasswordInput) keeps it and
 *    the label follows the child rather than overwriting it.
 *  - Only the FIRST form control is labelled. Several fields here wrap a group
 *    of buttons or two inputs; pointing one label at all of them would be
 *    worse than pointing it at none.
 *
 * Tapping the label now focuses the field too, which on a phone is a much
 * larger target than the input's own edge.
 */
export default function Field({ label, required, hint, children }) {
  const reactId = useId();
  const controlId = `f-${reactId}`;
  const hintId = hint ? `${controlId}-hint` : undefined;

  /**
   * Attach to the first element child that looks like a form control.
   * `labelled` stays false when there is nothing to attach to — a group of
   * buttons, say — and the label falls back to being a plain caption, which is
   * what it already was.
   */
  let labelled = false;
  const kids = Children.map(children, (child) => {
    if (labelled || !isValidElement(child)) return child;
    const t = child.type;
    const isIntrinsicControl = t === "input" || t === "select" || t === "textarea";
    // A composed control (Combobox, PasswordInput) takes the id through a prop
    // and puts it on its own input; both accept `id` and `aria-describedby`.
    const isComposed = typeof t === "function";
    if (!isIntrinsicControl && !isComposed) return child;

    labelled = true;
    return cloneElement(child, {
      id: child.props.id || controlId,
      "aria-describedby": [child.props["aria-describedby"], hintId].filter(Boolean).join(" ") || undefined,
      // `required` is a visible red asterisk; without this it is visible only.
      "aria-required": required ? true : child.props["aria-required"],
    });
  });

  return (
    <div className="mb-4">
      <label
        // htmlFor on a label with nothing to point at is invalid, so it is
        // omitted rather than left dangling at an id that does not exist.
        htmlFor={labelled ? controlId : undefined}
        className="block text-[12.5px] font-semibold text-ink mb-1.5"
      >
        {label}{" "}
        {required && (
          // The asterisk is decoration once `aria-required` is on the control —
          // read out, it becomes "star" in the middle of the field name.
          <span className="text-danger-text" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {kids}
      {hint && (
        <div id={hintId} className="text-[11.5px] text-danger-text mt-1">
          {hint}
        </div>
      )}
    </div>
  );
}

export const inputClass =
  // focus-visible rather than focus, and a ring rather than only a border
  // colour: the old rule was `focus:outline-none focus:border-navy`, so a 1px
  // border tint was the entire keyboard focus indicator on every form in the
  // app. The ring keeps the outline suppressed for mouse users and gives a
  // keyboard user something they can actually see.
  "w-full px-3 py-2.5 rounded border border-[#D8DEE4] text-[13.5px] bg-white text-ink " +
  "focus:outline-none focus:border-navy focus-visible:outline-none focus-visible:border-navy " +
  "focus-visible:ring-2 focus-visible:ring-navy/40";
