# Codex App Support Notes

Scratch Pad now supports two separate Codex paths:

- `Codex CLI execution`
  Scratch Pad still runs local tasks through the existing `codex exec` path.
- `Codex app handoff`
  Scratch Pad can ask Codex Desktop to open the current project repo with `codex app <repo-path>`.

These are intentionally different behaviors.

## What Scratch Pad Supports Today

- detect whether the `codex` CLI is installed
- detect whether the `codex app` handoff surface is available
- detect whether Codex Desktop appears to be installed locally on macOS
- detect whether the experimental `codex app-server` surface exists
- open the current repo in Codex Desktop

## What Scratch Pad Does Not Claim

- it does not mirror a live Scratch Pad CLI run into Codex Desktop
- it does not resume or attach to an existing Scratch Pad run inside the app
- it does not stream Codex Desktop events back into Scratch Pad
- it does not replace the current `codex exec` run path

## Why `codex app-server` Is Investigation Only

The local CLI exposes `codex app-server`, but it is still marked experimental.
Scratch Pad does not currently implement an app-server client.

If Scratch Pad ever uses it later, the architecture would need:

- a dedicated app-server transport client
- protocol-version handling and error recovery
- a clear mapping between Scratch Pad project/task/run state and Codex app session state
- a decision about which flows stay deterministic and CLI-based versus which flows become app-based

## Likely Long-Term Split

What should probably stay CLI-based:

- one-shot non-interactive task execution
- saved run logs
- deterministic run status transitions

What could later become app-based:

- repo handoff with richer context
- user-initiated interactive follow-up work
- deeper auth/session awareness
- richer event streaming into the UI

Until that protocol work is real and verified, Scratch Pad should keep treating Codex Desktop as a separate handoff target rather than a hidden replacement for the CLI.
