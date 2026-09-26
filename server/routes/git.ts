import type { Express } from "express"
import type { RouteContext } from "./context.js"

export function registerGitRoutes(app: Express, ctx: RouteContext): void {
  app.get("/api/git/changes", async (request, response) => {
    try {
      response.json(await ctx.openCode.gitChanges())
    } catch (error) {
      ctx.connection.handleError(error, response, request)
    }
  })
}
