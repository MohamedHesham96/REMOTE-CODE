export function normalizeProjectPath(path: string): string {
  return path.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase()
}
