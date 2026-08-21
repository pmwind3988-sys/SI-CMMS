"use client";

import { useEffect, useState } from "react";
import RequireAuth from "../../components/RequireAuth";
import WorkOrderList from "../../components/workorders/WorkOrderList";
import { Toast } from "../../components/ui/Surfaces";
import { takeHandoffToast } from "../../lib/toastHandoff";

export default function WorkOrdersPage() {
  const [toast, setToast] = useState(null);

  /* This page is where a decline lands, and the only place the confirmation for
     it can be shown: WorkflowPanel routes here and unmounts, so the message
     travels through sessionStorage. takeHandoffToast() removes the key as it
     reads, so navigating back does not replay it.

     It lives here rather than in WorkOrderList because the list is also
     rendered on the dashboard drill-downs, and a confirmation should appear
     once, on the screen the action actually navigated to. */
  useEffect(() => {
    const message = takeHandoffToast();
    if (!message) return;
    setToast(message);
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, []);

  return (
    <RequireAuth>
      <WorkOrderList />
      <Toast message={toast} />
    </RequireAuth>
  );
}
