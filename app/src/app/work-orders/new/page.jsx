"use client";

import RequireAuth from "../../../components/RequireAuth";
import RaiseWorkOrderForm from "../../../components/workorders/RaiseWorkOrderForm";

export default function NewWorkOrderPage() {
  return (
    <RequireAuth>
      <RaiseWorkOrderForm />
    </RequireAuth>
  );
}
