#!/usr/bin/env node
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { existsSync } from "node:fs";

const TAG = "[npm-wrap]";

type AuthState =
  | { kind: "ok"; user: string }
  | { kind: "needs-login"; reason: string }
  | { kind: "error"; reason: string };

function runCapture(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("npm", args, { encoding: "utf8" });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function runInherit(args: string[], opts: SpawnSyncOptions = {}): number {
  const result = spawnSync("npm", args, { stdio: "inherit", ...opts });
  if (result.error) {
    console.error(`${TAG} failed to spawn npm: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

/**
 * Split wrapper args from args forwarded to `npm install`. Anything after
 * a `--` separator, or any arg starting with `-` not recognized by the
 * wrapper, is forwarded untouched.
 */
function parseArgs(argv: string[]): { forward: string[] } {
  const forward: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      forward.push(...argv.slice(i + 1));
      break;
    }
    forward.push(arg);
  }
  return { forward };
}

/**
 * Prefer `npm ci` so installs come straight from the lockfile instead of
 * re-resolving versions. It can't add packages or run without a lockfile,
 * so fall back to `npm install` for those cases.
 */
function chooseInstall(forward: string[]): { cmd: "ci" | "install"; args: string[] } {
  const hasLockfile = existsSync("package-lock.json") || existsSync("npm-shrinkwrap.json");
  const addsPackages = forward.some((arg) => !arg.startsWith("-"));
  if (hasLockfile && !addsPackages) return { cmd: "ci", args: ["ci", ...forward] };
  return { cmd: "install", args: ["install", ...forward] };
}

function checkAuth(): AuthState {
  const { status, stdout, stderr } = runCapture(["whoami"]);
  if (status === 0) {
    const user = stdout.trim();
    if (user.length > 0) return { kind: "ok", user };
    return { kind: "needs-login", reason: "whoami returned empty username" };
  }

  // Auth-specific npm error codes. Anything else (network, DNS, registry 5xx)
  // is surfaced as a generic error so we don't mask infra problems by
  // unnecessarily prompting for a login.
  if (/ENEEDAUTH|E401|EAUTHUNKNOWN|EAUTHIP/.test(stderr)) {
    return { kind: "needs-login", reason: stderr.trim().split("\n")[0] ?? "auth required" };
  }
  if (/Unauthorized|authentication token|log[ -]?in/i.test(stderr)) {
    return { kind: "needs-login", reason: stderr.trim().split("\n")[0] ?? "auth required" };
  }
  return {
    kind: "error",
    reason: stderr.trim() || `npm whoami exited with status ${status}`,
  };
}

/**
 * Returns true when running inside a non-interactive agent (Claude Code,
 * Cursor, CI, etc.). We skip the login prompt in these environments because
 * there is no terminal to type credentials into, and npm login would hang.
 *
 * Primary signal: no TTY on stdin (universal for all non-interactive runners).
 * Secondary signals: well-known agent/CI env vars, for cases where stdin TTY
 * detection is unreliable (e.g. pseudo-TTY allocation in some CI setups).
 */
function isAgentEnvironment(): boolean {
  // No interactive terminal — can't login regardless of who's calling.
  if (!process.stdin.isTTY) return true;

  const env = process.env;
  // Claude Code (claude CLI) sets this when spawning subprocesses.
  if (env["CLAUDE_CODE"]) return true;
  // Standard CI signal respected by virtually every CI/CD platform.
  if (env["CI"]) return true;
  // Cursor AI agent environment.
  if (env["CURSOR_TRACE_ID"] ?? env["CURSOR_AGENT"]) return true;
  // GitHub Copilot / Codespaces.
  if (env["GITHUB_ACTIONS"] ?? env["CODESPACES"]) return true;

  return false;
}

function main(): void {
  const { forward } = parseArgs(process.argv.slice(2));

  if (isAgentEnvironment()) {
    console.error(`${TAG} non-interactive environment detected — skipping auth check`);
    const { cmd, args } = chooseInstall(forward);
    console.error(`${TAG} running \`npm ${cmd}\``);
    process.exit(runInherit(args));
  }

  const auth = checkAuth();
  switch (auth.kind) {
    case "ok":
      console.error(`${TAG} authenticated as ${auth.user}`);
      break;
    case "needs-login": {
      console.error(`${TAG} npm token missing or expired (${auth.reason}); running \`npm login\``);
      const code = runInherit(["login"]);
      if (code !== 0) {
        console.error(`${TAG} npm login failed (exit ${code})`);
        process.exit(code);
      }
      break;
    }
    case "error":
      console.error(`${TAG} could not verify npm auth state: ${auth.reason}`);
      console.error(`${TAG} proceeding with \`npm install\` anyway`);
      break;
  }

  const { cmd, args } = chooseInstall(forward);
  console.error(`${TAG} running \`npm ${cmd}\``);
  process.exit(runInherit(args));
}

main();
