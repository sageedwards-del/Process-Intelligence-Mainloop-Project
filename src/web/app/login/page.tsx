import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in · Process Discovery Engine" };

export default function Login() {
  return (
    <>
      <SiteHeader />
      <main className="dot-grid flex-1">
        <div className="mx-auto max-w-md px-4 py-20 sm:py-28">
          <p className="eyebrow text-primary">Sign in</p>
          <h1 className="mt-4 text-4xl font-medium tracking-[-0.02em]">Your workspace</h1>
          <p className="mt-4 leading-relaxed text-ink-muted">
            No password: enter your email and we&rsquo;ll send a one-time link. First time here? The link creates your
            account and a private workspace.
          </p>
          <div className="mt-10">
            <Suspense>
              <LoginForm />
            </Suspense>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
