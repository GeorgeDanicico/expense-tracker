import { apiRequest } from "@/lib/api/client";

export type AuthResult = { authenticated: boolean; message?: string };

/** Signs in or signs up through `POST /api/auth`. */
export function submitAuth(input: { mode: string; email: unknown; password: unknown; next: string }) {
  return apiRequest<AuthResult>("/api/auth", { method: "POST", body: JSON.stringify(input) });
}
