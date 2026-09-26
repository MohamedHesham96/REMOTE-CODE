import type { Express } from "express"
import { config } from "../config.js"
import { clearSessionCookie, isValidAccessToken, setSessionCookie } from "../auth.js"
import { getServerLang, serverMessage } from "../i18n.js"
import type { RouteContext } from "./context.js"

export function registerAuthRoutes(app: Express, _ctx: RouteContext): void {
  void _ctx
  app.post("/api/login", (request, response) => {
    const accessToken = typeof request.body?.accessToken === "string" ? request.body.accessToken : ""

    if (!isValidAccessToken(accessToken, config.accessToken)) {
      response.status(401).json({ error: "INVALID_ACCESS_TOKEN", message: serverMessage("invalidAccessToken", getServerLang(request)) })
      return
    }

    setSessionCookie(request, response, config.accessToken)
    response.json({ ok: true })
  })

  app.post("/api/logout", (request, response) => {
    clearSessionCookie(request, response)
    response.json({ ok: true })
  })
}
