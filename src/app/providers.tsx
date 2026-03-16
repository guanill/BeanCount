"use client";

import AuthGuard from "@/components/AuthGuard";

export default function Providers({ children }: { children: React.ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>;
}
