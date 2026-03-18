"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();

    // Handle OAuth code exchange (e.g. after Google sign-in redirect)
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ data, error }) => {
        if (error) {
          console.error("Code exchange failed:", error.message);
          setUser(null);
        } else {
          setUser(data.session?.user ?? null);
        }
        // Clean up the URL
        window.history.replaceState({}, "", window.location.pathname);
      });
    } else {
      supabase.auth.getUser().then(({ data: { user } }) => {
        setUser(user);
      });
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user === undefined) return; // still loading
    if (!user && pathname !== "/login") router.replace("/login");
    if (user && pathname === "/login") router.replace("/");
  }, [user, pathname, router]);

  // Loading state
  if (user === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
        <span className="text-2xl animate-bounce">🫘</span>
      </div>
    );
  }

  // Not authenticated and not on login page — redirect happening
  if (!user && pathname !== "/login") return null;

  return <>{children}</>;
}
