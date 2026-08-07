"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import { dashboardPathForRole } from "../lib/roles";

export default function RootPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? dashboardPathForRole(user.role) : "/login");
  }, [user, loading, router]);

  return null;
}
