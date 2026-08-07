"use client";

import RequireAuth from "../../components/RequireAuth";
import WorkOrderList from "../../components/workorders/WorkOrderList";

export default function WorkOrdersPage() {
  return (
    <RequireAuth>
      <WorkOrderList />
    </RequireAuth>
  );
}
