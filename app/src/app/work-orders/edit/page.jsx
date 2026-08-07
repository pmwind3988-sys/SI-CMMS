"use client";

/**
 * SI — Service Inside · Edit work order
 *
 * Reads the work order id from `?id=` for the same reason the detail page does:
 * a static export cannot prerender path segments that only exist at runtime.
 */
import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import RequireAuth from "../../../components/RequireAuth";
import RaiseWorkOrderForm from "../../../components/workorders/RaiseWorkOrderForm";
import { listenWorkOrder } from "../../../lib/workOrders";
import { ErrorBanner } from "../../../components/ui/Surfaces";

function EditWorkOrderInner() {
  const id = useSearchParams().get("id");
  const router = useRouter();
  const [wo, setWo] = useState(undefined);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) return;
    const unsub = listenWorkOrder(id, setWo, () => setError("This work order couldn't be found or you no longer have access to it."));
    return unsub;
  }, [id]);

  if (!id) return <div className="text-ink-soft text-[13px]">No work order selected.</div>;

  if (error) {
    return (
      <div className="max-w-md">
        <ErrorBanner message={error} />
        <button onClick={() => router.push("/work-orders")} className="text-navy text-[13px] font-semibold">
          ← Back to Work Orders
        </button>
      </div>
    );
  }
  if (wo === undefined) return <div className="text-ink-soft text-[13px]">Loading…</div>;
  if (wo === null) return null;

  if (wo.status !== "open") {
    return (
      <div className="max-w-md">
        <ErrorBanner message="This work order can only be edited while it's still Open — a technician has already been assigned." />
        <button onClick={() => router.push(`/work-orders/view?id=${id}`)} className="text-navy text-[13px] font-semibold">
          ← Back to work order
        </button>
      </div>
    );
  }

  return <RaiseWorkOrderForm existing={wo} />;
}

export default function EditWorkOrderPage() {
  return (
    <RequireAuth>
      {/* useSearchParams needs a Suspense boundary during prerender. */}
      <Suspense fallback={<div className="text-ink-soft text-[13px]">Loading…</div>}>
        <EditWorkOrderInner />
      </Suspense>
    </RequireAuth>
  );
}
