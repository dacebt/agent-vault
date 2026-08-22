# Agent Vault

Agent Vault is a standalone project-memory plugin for Claude Code and Codex. It gives each source repository a durable external brain containing linked knowledge, architectural decisions, task coordination, dated journals, unfinished-work handoffs, and a bundled local HTML viewer.

The plugin keeps that memory outside the source repository under `~/agent-vault` by default. Each direct child is an independently bootstrapped project bundle whose name matches its source repository. The source repo owns the product; Agent Vault owns what agents need to remember about it.

Agent Vault is a single-plugin marketplace. This repository contains no unrelated plugins.

## What it stores

Each tracked project combines OKF v0.2 Markdown concepts with a SQLite task store:

```text
~/agent-vault/
└── <project-name>/
    ├── index.md
    ├── README.md
    ├── tasks/
    │   └── tasks.sqlite3
    ├── knowledge/
    │   ├── index.md
    │   └── <topic>.md
    ├── docs/
    │   ├── index.md
    │   ├── <reference>.md
    │   └── decisions/
    │       ├── index.md
    │       └── ADR-NNN-<decision>.md
    ├── journal/
    │   └── YYYY-MM-DD.md
    ├── handoffs/
    │   └── YYYY-MM-DD-HHMM.md
    └── views/
        └── <view-name>/index.html
```

Markdown is authoritative for knowledge, decisions, documentation, journals, and handoffs. `tasks/tasks.sqlite3` is authoritative for task concepts. File concepts use bundle-relative Markdown links; tasks use immutable `task:<uuid>` links. Both providers form one traversable graph.

The containing directory is only a locator. Project bundles remain independent even when the containing directory is a Git repository used to durably commit vault changes.

## What the plugin does

Agent Vault combines explicit skills with quiet lifecycle automation.

### Lifecycle hooks

- **SessionStart** resolves the current project and injects a compact orientation: active tasks, counts, live handoffs, recent knowledge, journal and decision activity, and graph health.
- **PostToolUse** notices a newly created Git commit and appends its short SHA and subject to the most recently touched active task.
- **UserPromptSubmit** recognizes explicit wrap-up language and reminds the agent that journaling is available without forcing a journal entry.
- **PreCompact** reconstructs the recent transcript in a sandboxed headless run and writes a handoff only when work is genuinely unfinished.
- **SessionEnd** starts a detached, sandboxed capture that journals substantive work and adds a handoff only when something remains in flight.

Every hook silently exits when the containing root is absent, the current project has not been bootstrapped, required tooling is unavailable, or there is nothing meaningful to do.

PreCompact and SessionEnd use `codex exec` for their headless transcript reconstruction, including when Agent Vault is installed in Claude Code. Without the `codex` CLI on `PATH`, those two captures no-op; the remaining skills and hooks continue to work.

### Skills

| Skill                   | Purpose                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `agent-vault:bootstrap` | Scaffold a project bundle and extract a linked architecture/conventions spine from observable repository state. |
| `agent-vault:capture`   | Record a note, reference, decision, or explicitly requested task and wire it into the graph.                    |
| `agent-vault:decide`    | Capture a real architectural choice as a linked ADR.                                                            |
| `agent-vault:groom`     | Audit task, decision, handoff, and durability hygiene.                                                          |
| `agent-vault:handoff`   | Write the exact resume-point for unfinished work.                                                               |
| `agent-vault:journal`   | Append a grounded dated account of substantive work.                                                            |
| `agent-vault:orient`    | Present the project’s complete current state or a shareable status summary.                                     |
| `agent-vault:recall`    | Answer a specific prior-work question by traversing links and backlinks.                                        |
| `agent-vault:refresh`   | Check current-reality claims against the source repository.                                                     |
| `agent-vault:render`    | Build a browser-openable HTML view of project state.                                                            |
| `agent-vault:task-flow` | Move SQLite-backed tasks through their lifecycle with acceptance and outcome discipline.                        |
| `agent-vault:viewer`    | Start, inspect, or stop the bundled read-only local browser viewer.                                             |
| `agent-vault:weave`     | Audit and repair graph links, indexes, orphans, and stale references.                                           |

## Installation

Agent Vault uses the same repository as both its Claude Code and Codex marketplace source.

### Claude Code

```sh
claude plugin marketplace add https://github.com/dacebt/agent-vault.git
claude plugin install agent-vault@agent-vault
```

Inside Claude Code, the equivalent interactive commands are:

```text
/plugin marketplace add https://github.com/dacebt/agent-vault.git
/plugin install agent-vault@agent-vault
```

### Codex

```sh
codex plugin marketplace add https://github.com/dacebt/agent-vault.git
codex plugin add agent-vault@agent-vault
```

Start a new Claude Code or Codex session after installation so the host loads the skills and hooks from the installed plugin.

## Set up the vault root

Create the containing directory once:

```sh
mkdir -p ~/agent-vault
```

To keep bundles somewhere else, set an absolute path in `AGENT_VAULT` before starting the host:

```sh
export AGENT_VAULT=/absolute/path/to/my-agent-vault
```

Agent Vault never falls back to another product’s directory. Its default and override belong only to this standalone plugin.

Once installed, open Claude Code or Codex inside a source repository and ask it to run `agent-vault:bootstrap`. Bootstrap creates `<vault-root>/<git-root-basename>` and initializes the Markdown bundle plus `tasks/tasks.sqlite3`.

## Run the local viewer

Ask an agent to use `agent-vault:viewer`, or manage the bundled loopback server directly from this checkout:

```sh
bash plugins/agent-vault/bin/viewer.sh start
bash plugins/agent-vault/bin/viewer.sh status
bash plugins/agent-vault/bin/viewer.sh stop
```

The viewer serves `http://127.0.0.1:7373` by default, reads the configured Agent Vault root, and presents SQLite task boards, concept graphs, linked documents, and physical file trees without mutation. It has no package-install or build step. Set `AGENT_VAULT` or `PORT` before invoking the command to override the defaults.

## Requirements

Core operation requires:

- Bash
- Git
- `jq`
- `awk`, `find`, `grep`, `sed`, `shasum`, and standard Unix utilities
- Python 3 with its standard `sqlite3` module

Optional OKF validation, OKF v0.1 upgrades, and legacy Markdown-task migration additionally require Ruby with standard-library YAML/Psych support. Automatic PreCompact and SessionEnd capture additionally require the Codex CLI.

The optional local viewer requires Node.js 22.13 or newer so `node:sqlite` is available without an experimental flag.

The shell utilities include BSD/macOS and GNU/Linux fallbacks where their command syntax differs.

## Task storage

Tasks are SQLite-backed concepts with immutable UUID identities and separate human display keys. Workflow status does not change identity or link targets. The canonical command is:

```sh
python3 plugins/agent-vault/bin/task-db.py --help
```

The public storage and graph contract is documented in [`sqlite-task-contract.md`](plugins/agent-vault/reference/sqlite-task-contract.md). Consumers should open task databases read-only; Agent Vault’s task command is the write authority.

## Optional format utilities

These tools are diagnostics and explicit migrations. Ordinary Agent Vault writes do not invoke them as automatic gates.

```sh
ruby plugins/agent-vault/bin/okf-validate.rb --require-version 0.2 /path/to/bundle
ruby plugins/agent-vault/bin/okf-validate.rb --require-version 0.2 --strict /path/to/bundle

ruby plugins/agent-vault/bin/okf-upgrade-v0.2.rb /path/to/bundle
ruby plugins/agent-vault/bin/okf-upgrade-v0.2.rb --write /path/to/bundle

python3 plugins/agent-vault/bin/migrate-task-markdown.py /path/to/project
python3 plugins/agent-vault/bin/migrate-task-markdown.py /path/to/project --write
```

The task importer preflights the entire migration, rewrites task links to immutable URIs, validates parity, creates a recovery archive, and rolls back project changes if application fails.

## Repository layout

```text
agent-vault/
├── .agents/plugins/marketplace.json
├── .claude-plugin/marketplace.json
├── plugins/
│   └── agent-vault/
│       ├── .claude-plugin/plugin.json
│       ├── .codex-plugin/plugin.json
│       ├── hooks.json
│       ├── skills/
│       ├── bin/
│       ├── lib/
│       ├── templates/
│       ├── reference/
│       ├── viewer/
│       └── tests/
├── LICENSE
└── README.md
```

The Claude Code manifest declares hooks inline with `${CLAUDE_PLUGIN_ROOT}`. The Codex manifest points to `hooks.json`, whose commands use `${PLUGIN_ROOT}`. The hook scripts accept either host variable and fall back to their own installed location. Skills resolve bundled files from the loaded skill path rather than from a development checkout.

## Upstream synchronization

This repository is the distributable downstream mirror, not the development authority for the mirrored components. Plugin changes originate, land, and are verified in `ebt-agent-skills/plugins/ebt-vault`; viewer changes originate, land, and are verified in the standalone `ebt-vault-viewer` repository. Once that upstream work is complete, it is adapted to the Agent Vault namespace and parroted into this repository. Do not develop independent plugin or viewer behavior here first.

That synchronization rule governs implementation, not release numbering. Agent Vault owns its marketplace and manifest versions independently; they do not need to match the `ebt-vault` plugin version in `ebt-agent-skills`.

## Provenance

Agent Vault began as the `ebt-vault` plugin inside the private `ebt-agent-skills` collection. This repository is its standalone, publicly distributable form with an independent plugin name, marketplace, storage root, environment namespace, cache namespace, generated provenance, and repository documentation. The bundled viewer is mirrored from the standalone `ebt-vault-viewer` project.

## License

Agent Vault is available under the [MIT License](LICENSE).
