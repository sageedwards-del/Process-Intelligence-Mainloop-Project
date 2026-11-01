"use server";

import { headers } from "next/headers";
import { safeNext } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { status: "idle" } | { status: "sent"; email: string } | { status: "error"; message: string };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Emails a one-time sign-in link. New addresses get an account and a personal workspace. */
export async function sendMagicLink(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim();
  if (!EMAIL.test(email)) return { status: "error", message: "Enter a valid email address." };

  const h = await headers();
  const origin = h.get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const next = safeNext(form.get("next"));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error) return { status: "error", message: error.message };
  return { status: "sent", email };
}
