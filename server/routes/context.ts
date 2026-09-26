import type { Express, NextFunction, Request, Response } from "express"
import type { OpenCodeService } from "../opencode.js"
import type { PinService } from "../pins.js"
import type { PushService } from "../push.js"
import type { OpenCodeConnection } from "../connection.js"
import type { EventHub } from "../sse/hub.js"

export interface RouteContext {
  openCode: OpenCodeService
  pins: PinService
  push: PushService
  connection: OpenCodeConnection
  hub: EventHub
  pollLimiter: (request: Request, response: Response, next: NextFunction) => void
}

export type RouteModule = (app: Express, ctx: RouteContext) => void
