import { describe, expect, test } from "vitest";
import { parseConfirm } from "@/lib/supabase/confirm";

const q = (s: string) => parseConfirm(new URLSearchParams(s));

describe("parseConfirm", () => {
  test("a token-hash link works with a plain path", () => {
    expect(q("token_hash=abc&type=email&next=%2Fsample%23insights")).toEqual({ kind: "token", tokenHash: "abc", type: "email", next: "/sample#insights" });
  });

  test("next from the template's {{ .RedirectTo }} is unwrapped to its own next", () => {
    expect(q("token_hash=abc&type=email&next=https://site.example/auth/confirm?next=%2Fapp%2Fupload")).toMatchObject({ next: "/app/upload" });
    expect(q("token_hash=abc&type=email&next=https://site.example")).toMatchObject({ next: "/app" });
  });

  test("open redirects are refused", () => {
    expect(q("token_hash=abc&type=email&next=//evil.com")).toMatchObject({ next: "/app" });
    expect(q("token_hash=abc&type=email&next=https://site.example/auth/confirm?next=https://evil.com")).toMatchObject({ next: "/app" });
  });

  test("a PKCE code from Supabase's default template is still accepted", () => {
    expect(q("code=xyz&next=%2Fapp")).toEqual({ kind: "code", code: "xyz", next: "/app" });
  });

  test("unknown types and empty links are invalid", () => {
    expect(q("token_hash=abc&type=sms")).toMatchObject({ kind: "invalid" });
    expect(q("")).toMatchObject({ kind: "invalid", next: "/app" });
  });
});
