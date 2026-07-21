import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Resolve the path to Cursor's global state SQLite DB for the current platform.
 */
export function getStateDbPath(): string | undefined {
  const home = os.homedir();
  const candidates: string[] = [];
  switch (process.platform) {
    case "darwin":
      candidates.push(
        path.join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb")
      );
      break;
    case "win32": {
      const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
      candidates.push(path.join(appData, "Cursor", "User", "globalStorage", "state.vscdb"));
      break;
    }
    default:
      candidates.push(path.join(home, ".config", "Cursor", "User", "globalStorage", "state.vscdb"));
      break;
  }
  return candidates.find((p) => fs.existsSync(p));
}

export interface CursorCredentials {
  token: string;
  userId: string;
  /** Cookie value used by the dashboard API. */
  sessionCookie: string;
}

/**
 * Read the `cursorAuth/accessToken` value from the state DB (read-only).
 * Uses the system `sqlite3` binary so we avoid shipping native modules.
 */
export async function readAccessToken(dbPath: string): Promise<string | undefined> {
  const query = "SELECT value FROM ItemTable WHERE key='cursorAuth/accessToken' LIMIT 1;";
  try {
    const { stdout } = await execFileAsync("sqlite3", ["-readonly", dbPath, query], {
      maxBuffer: 1024 * 1024,
    });
    const token = stdout.trim();
    return token.length > 0 ? token : undefined;
  } catch {
    return undefined;
  }
}

interface JwtPayload {
  sub?: string;
  [key: string]: unknown;
}

export function decodeJwt(token: string): JwtPayload | undefined {
  const parts = token.split(".");
  if (parts.length < 2) {
    return undefined;
  }
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(json) as JwtPayload;
  } catch {
    return undefined;
  }
}

/**
 * The dashboard expects a session token shaped as `<userId>::<jwt>`.
 * `sub` looks like `auth0|user_01ABC...`; we keep the part after the pipe.
 */
export function extractUserId(token: string): string | undefined {
  const payload = decodeJwt(token);
  const sub = payload?.sub;
  if (!sub || typeof sub !== "string") {
    return undefined;
  }
  return sub.includes("|") ? sub.split("|")[1] : sub;
}

export async function getCredentials(): Promise<CursorCredentials | undefined> {
  const dbPath = getStateDbPath();
  if (!dbPath) {
    return undefined;
  }
  const token = await readAccessToken(dbPath);
  if (!token) {
    return undefined;
  }
  const userId = extractUserId(token);
  if (!userId) {
    return undefined;
  }
  const sessionCookie = `WorkosCursorSessionToken=${encodeURIComponent(`${userId}::${token}`)}`;
  return { token, userId, sessionCookie };
}
