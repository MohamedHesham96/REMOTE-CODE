import { createHmac, timingSafeEqual } from "node:crypto"
import type { NextFunction, Request, Response } from "express"

const cookieName = "remotecode_session"
const sessionContext = "remotecode"

function equal(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function expectedSession(accessToken: string): string {
  return createHmac("sha256", accessToken).update(sessionContext).digest("base64url")
}

function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.cookie

  if (!cookieHeader) {
    return undefined
  }

  for (const item of cookieHeader.split(";")) {
    const [key, ...value] = item.trim().split("=")

    if (key === name) {
      return decodeURIComponent(value.join("="))
    }
  }

  return undefined
}

export function isValidAccessToken(candidate: string, accessToken: string): boolean {
  return equal(candidate, accessToken)
}

export function setSessionCookie(request: Request, response: Response, accessToken: string): void {
  response.cookie(cookieName, expectedSession(accessToken), {
    httpOnly: true,
    sameSite: "lax",
    secure: request.secure,
    maxAge: 1000 * 60 * 60 * 24 * 30,
    path: "/",
  })
}

export function clearSessionCookie(request: Request, response: Response): void {
  response.clearCookie(cookieName, {
    httpOnly: true,
    sameSite: "strict",
    secure: request.secure,
    path: "/",
  })
}

export function requireAuthentication(accessToken: string) {
  return (request: Request, response: Response, next: NextFunction): void => {
    response.setHeader("Cache-Control", "no-store")

    if (readCookie(request, cookieName) === expectedSession(accessToken)) {
      next()
      return
    }

    response.status(401).json({ error: "UNAUTHORIZED", message: "You must sign in again" })
  }
}
