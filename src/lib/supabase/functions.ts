import { createClient } from "./client";

const FUNCTIONS_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`;

/**
 * Call a Supabase Edge Function with the current user's auth token.
 */
export async function callEdgeFunction<T = unknown>(
  functionName: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) throw new Error("Not authenticated");

  const res = await fetch(`${FUNCTIONS_URL}/${functionName}`, {
    method: options.method ?? "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Edge function error ${res.status}`);
  return data as T;
}
