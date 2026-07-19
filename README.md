# npm-wrap

A thin CLI wrapper around `npm` that runs `npm login` first — but only when your current npm token is actually missing or expired.

Once auth is sorted, the wrapper prefers `npm ci`: when a lockfile (`package-lock.json` or `npm-shrinkwrap.json`) is present and you aren't adding a specific package, it runs `npm ci` so dependencies come straight from the lockfile instead of being re-resolved. It falls back to `npm install` when there's no lockfile or when you pass package names (which `npm ci` doesn't support). Set `NPM_WRAP_NO_CI` to force `npm install` even with a lockfile — handy for repeated local installs, since `npm ci` wipes `node_modules` and reinstalls from scratch each run.

If you're already authenticated, it just forwards straight to the install. If the registry is unreachable (DNS failure, 5xx, etc.), it prints a warning and still proceeds rather than falsely prompting you to log in.

In non-interactive environments (no TTY, CI, or an AI coding agent such as Claude Code or Cursor), the wrapper skips the auth check entirely and goes straight to the install, because there is no terminal to drive an interactive `npm login`.

## Install

```sh
git clone <this repo> npm-wrap
cd npm-wrap
npm install
npm run build
npm install -g .
```

That puts `npm-wrap` on your `PATH`.

## Usage

```sh
npm-wrap                         # `npm ci` if a lockfile exists, else `npm install`
npm-wrap --save-dev typescript   # adds a package, so forwards to `npm install`
npm-wrap lodash is-odd           # install multiple packages (`npm install`)
npm-wrap -- --foo --bar          # anything after `--` is forwarded verbatim
```

On each invocation the wrapper:

1. Checks whether it's running in a non-interactive environment (see below). If so, it prints a notice, skips straight to the install (step 4), and exits.
2. Otherwise, runs `npm whoami` to probe the current token.
3. Branches on the result:
   - **Authenticated** — prints `[npm-wrap] authenticated as <user>` and continues.
   - **Auth error** (`E401`, `ENEEDAUTH`, `EAUTHUNKNOWN`, `EAUTHIP`, or a message like "Unauthorized") — runs `npm login` interactively, then continues. If login fails, the wrapper exits with the login's exit code.
   - **Other error** (network, registry down) — warns and proceeds to the install anyway, so an offline machine isn't forced through a pointless login prompt.
4. Runs `npm ci` (or `npm install <your args>` when there's no lockfile or you're adding packages) with inherited stdio and exits with its exit code.

## Intercepting `npm install`

If you'd rather not remember to type `npm-wrap`, shadow `npm` in your shell so that only `install` (and its `i`/`add` aliases) is routed through the wrapper — every other npm subcommand (`run`, `test`, `ci`, `publish`, …) falls through to the real `npm` untouched.

This is safe from infinite recursion: `npm-wrap` spawns the `npm` **binary** directly (via a `PATH` lookup, not your shell), so it never re-enters the shell function or alias below.

### Zsh / Bash

Add to `~/.zshrc` or `~/.bashrc`:

```sh
npm() {
  case "$1" in
    install | i | add)
      shift
      npm-wrap "$@"
      ;;
    *)
      command npm "$@"
      ;;
  esac
}
```

`command npm` bypasses the function to reach the real binary.

### Fish

Add to `~/.config/fish/functions/npm.fish` (or run the body once and `funcsave npm`):

```fish
function npm
    if contains -- $argv[1] install i add
        npm-wrap $argv[2..-1]
    else
        command npm $argv
    end
end
```

### PowerShell (Windows)

Add to your profile (`notepad $PROFILE`):

```powershell
function npm {
    # -CommandType Application resolves the real npm executable, skipping this function.
    $realNpm = Get-Command npm -CommandType Application | Select-Object -First 1
    if ($args.Count -gt 0 -and $args[0] -in @('install', 'i', 'add')) {
        $rest = if ($args.Count -gt 1) { $args[1..($args.Count - 1)] } else { @() }
        npm-wrap @rest
    } else {
        & $realNpm @args
    }
}
```

The same function works in PowerShell 7+ on macOS/Linux.

After editing any of the above, restart your shell (or `source` the file) for it to take effect.

## Non-interactive detection

An interactive `npm login` is pointless (and will hang) where there's no human at a terminal, so the wrapper detects those cases and skips the auth check. It treats the environment as non-interactive when any of the following is true:

- **stdin is not a TTY** — the universal signal for any non-interactive runner.
- `CLAUDE_CODE` is set (Claude Code).
- `CI` is set (respected by virtually every CI/CD platform).
- `CURSOR_TRACE_ID` or `CURSOR_AGENT` is set (Cursor).
- `GITHUB_ACTIONS` or `CODESPACES` is set (GitHub Actions / Codespaces).

## Environment variables

- `NPM_WRAP_NO_CI` — when set to any non-empty value, forces `npm install` even when a lockfile is present, opting out of the default `npm ci`.

## How it detects "expired"

npm's auth-related error codes are well-defined:

| Code            | Meaning                                      |
| --------------- | -------------------------------------------- |
| `ENEEDAUTH`     | No token configured.                         |
| `E401`          | Registry rejected the token (expired/revoked). |
| `EAUTHUNKNOWN`  | Registry returned an unrecognized auth state. |
| `EAUTHIP`       | Token present but IP not allowed.            |

The wrapper matches those codes in the stderr of `npm whoami`, plus a textual fallback for phrases like "Unauthorized", "authentication token", and "log in" that some registries return without a machine-readable code. Anything else (DNS, timeouts, 5xx) is treated as "can't tell" and passed through without a login prompt.

## Exit codes

- Wrapper exits with the exit code of the underlying `npm ci`/`npm install`.
- If `npm login` fails, the wrapper exits with the login's exit code and does not run install.

## Caveats

- `npm login` is interactive — the wrapper inherits stdio so npm can drive the browser OAuth (or classic prompt) flow directly.
- Scoped registries are not probed explicitly; `npm whoami` uses your default registry. If you rely on a non-default scope, invoke via `npm-wrap --registry=...` — the flag is forwarded to the underlying install, though `whoami` still probes the default. Raise an issue if you need per-scope probing.
- No automated tests; the three auth branches have been exercised manually against a mocked `npm`.

## Development

```sh
npm run build    # compile TypeScript to dist/
npm run lint     # tsc --noEmit
```

Source is a single file: `src/cli.ts`.
