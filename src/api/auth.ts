import { request } from "./http"

export async function login(accessToken: string): Promise<void> {
  await request("/api/login", {
    method: "POST",
    body: JSON.stringify({ accessToken }),
  })
}

export async function logout(): Promise<void> {
  await request("/api/logout", { method: "POST" })
}
