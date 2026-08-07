"use client";

/**
 * SI — Service Inside · Work Order detail
 *
 * The work order id arrives as `?id=` rather than as a path segment. A static
 * export has to know every route at build time, and work order ids are created
 * at runtime, so `/work-orders/[id]` could never be prerendered. A query param
 * keeps the route static while the id stays dynamic.
 */
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import RequireAuth from "../../../components/RequireAuth";
import WorkOrderDetail from "../../../components/workorders/WorkOrderDetail";

function WorkOrderDetailInner() {
  const id = useSearchParams().get("id");
  if (!id) return <div className="text-ink-soft text-[13px]">No work order selected.</div>;
  return <WorkOrderDetail woId={id} />;
}

export default function WorkOrderViewPage() {
  return (
    <RequireAuth>
      {/* useSearchParams needs a Suspense boundary during prerender. */}
      <Suspense fallback={<div className="text-ink-soft text-[13px]">Loading…</div>}>
        <WorkOrderDetailInner />
      </Suspense>
    </RequireAuth>
  );
}
