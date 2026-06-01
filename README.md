# npm-wrap

A thin CLI wrapper around `npm install` that runs `npm login` first — but only when your current npm token is actually missing or expired.

If you're already authenticated, it just forwards straight to `npm install`. If the registry is unreachable (DNS failure, 5xx, etc.), it prints a warning and still proceeds to `npm install` rather than falsely prompting you to log in.

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
npm-wrap                         # equivalent to `npm install`
npm-wrap --save-dev typescript   # args forward to `npm install`
npm-wrap lodash is-odd           # install multiple packages
npm-wrap -- --foo --bar          # anything after `--` is forwarded verbatim
```

On each invocation the wrapper:

1. Runs `npm whoami` to probe the current token.
2. Branches on the result:
   - **Authenticated** — prints `[npm-wrap] authenticated as <user>` and continues.
   - **Auth error** (`E401`, `ENEEDAUTH`, `EAUTHUNKNOWN`, `EAUTHIP`, or "Unauthorized") — runs `npm login` interactively, then continues. If login fails, the wrapper exits with the login's exit code.
   - **Other error** (network, registry down) — warns and proceeds to `npm install` anyway, so an offline machine isn't forced through a pointless login prompt.
3. Runs `npm install <your args>` with inherited stdio and exits with its exit code.

## How it detects "expired"

npm's auth-related error codes are well-defined:

| Code            | Meaning                                      |
| --------------- | -------------------------------------------- |
| `ENEEDAUTH`     | No token configured.                         |
| `E401`          | Registry rejected the token (expired/revoked). |
| `EAUTHUNKNOWN`  | Registry returned an unrecognized auth state. |
| `EAUTHIP`       | Token present but IP not allowed.            |

The wrapper matches those codes in the stderr of `npm whoami`. Anything else (DNS, timeouts, 5xx) is treated as "can't tell" and passed through without a login prompt.

## Exit codes

- Wrapper exits with the exit code of the underlying `npm install`.
- If `npm login` fails, the wrapper exits with the login's exit code and does not run install.

## Caveats

- `npm login` is interactive — the wrapper inherits stdio so npm can drive the browser OAuth (or classic prompt) flow directly.
- Scoped registries are not probed explicitly; `npm whoami` uses your default registry. If you rely on a non-default scope, invoke via `npm-wrap --registry=...` — the flag is forwarded to `npm install`, though `whoami` still probes the default. Raise an issue if you need per-scope probing.
- No automated tests; the three auth branches have been exercised manually against a mocked `npm`.

## Development

```sh
npm run build    # compile TypeScript to dist/
npm run lint     # tsc --noEmit
```

Source is a single file: `src/cli.ts`.
