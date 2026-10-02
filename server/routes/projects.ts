import type { Express } from "express"
import { getServerLang, serverMessage } from "../i18n.js"
import type { RouteContext } from "./context.js"

export function registerProjectRoutes(app: Express, ctx: RouteContext): void {
  app.get("/api/project", async (request, response) => {
    try {
      const projects = await ctx.openCode.projects()
      response.json({
        projects: projects.filter((project) => project.worktree !== "/"),
        selected: await ctx.openCode.selectedProject(projects),
      })
    } catch (error) {
      ctx.connection.handleError(error, response, request)
    }
  })

  app.post("/api/project/select", async (request, response) => {
    try {
      const worktree = typeof request.body?.worktree === "string" ? request.body.worktree : ""
      const id = typeof request.body?.id === "string" ? request.body.id : ""
      const projectKey = worktree || id
      if (!projectKey) {
        response.status(400).json({ error: "PROJECT_REQUIRED", message: serverMessage("projectRequired", getServerLang(request)) })
        return
      }
      response.json({ project: await ctx.openCode.selectProject(projectKey) })
    } catch (error) {
      ctx.connection.handleError(error, response, request)
    }
  })
}
