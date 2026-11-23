# pstack in Codex

Read this adapter once per session before following a pstack workflow in Codex. `<pstack>` is the absolute installed directory containing this file, `skills/`, and `agents/`. Resolve it from the skill file you actually loaded, including when the host uses a cache. This is the cappeol/plugins Codex adaptation of Lauren Tan's PStack.

## Dispatch and tools

Inspect the current session's tool schemas before dispatch. Desktop, CLI, cloud, and third-party hosts expose different capabilities. Use only fields, model values, and effort levels that the available tool accepts. Session and user instructions take precedence over workflow defaults.

| Cursor term | Codex action |
| --- | --- |
| `Task` | Use `collaboration.spawn_agent` or `spawn_agent` when available and delegation is authorized. Translate the brief to `message` or `prompt` according to the live schema. Otherwise perform independent implementation or exploration steps sequentially and report the missing capability. A required independent review remains blocked; self-review cannot satisfy it. |
| `AskQuestion` | Use an available user-input tool when allowed by the current mode; otherwise ask in plain text. An approval request still follows the host's approval flow. |
| Open a todolist | Use the host's plan/task tool, or keep a task-specific Markdown checklist in the work directory and update it as steps finish. |
| Run another pstack skill (`/name` or "the **name** skill") | Read the absolute `<pstack>/skills/<name>/SKILL.md` and follow it. Skill commands and namespaces depend on the host; a literal slash command is not a tool. |
| `Grep`, `Glob`, `Read`, shell | Use the available file/shell tools; prefer `rg` for searches. |
| `generalPurpose` | Omit Cursor's agent type; use the host's general agent capability if exposed. |
| `poteto-agent`, `comment-sicko` | These are instruction documents, not registered Codex agent types. Resolve `<pstack>/agents/poteto-agent.md` or `<pstack>/agents/comment-sicko.md` to an absolute path and explicitly tell the child to read it. Also give the child the absolute poteto-mode SKILL.md and this adapter's path. Agent frontmatter, including `model:`, is documentation, never a Codex dispatch setting. Never transmit its foreign model slug. For `auto` or `inherit-parent`, use the host's native generic child with inherited model and no agent-defined model default. |
| `readonly: true` | Use a read-only capability if offered; otherwise explicitly prohibit edits in the brief and inspect status afterward. A prompt is not a sandbox. |
| `readonly: false` | Use normal tool access subject to the host's permissions. Do not invent a permission field. |
| `environment: "cloud"`, `environment: "local"` | Use an available isolated worktree capability for concurrent writers, with an explicit base revision. The field itself is Cursor-only; Codex cloud execution requires separate host support. |
| `cloud_base_branch` | Include the exact base branch or commit and working directory in the brief. Resolve and create the checkout before dispatch when the host does not do it. |
| `run_in_background: true` | Omit; available Codex spawn tools return a handle. Collect all results with the host's wait tool and respect concurrency limits. |
| `resume` | Use a supported follow-up/send tool with the returned agent handle. If absent, start a child with the earlier result and relevant file paths. |
| `file_attachments` | Give absolute local paths in the brief; verify that the child can access them. |

Every child kickoff must begin with `Read <pstack>/skills/poteto-mode/worker.md before anything else.`, replacing `<pstack>` with the absolute installed directory. This bundled worker read comes before agent style, SKILL.md, or adapter reads, including for generic children.

A workflow's multi-model comparison requires those models to be actually available. If execution becomes sequential or uses one model family, label the loss of independence/diversity in the result. Never claim an independent reviewer when the parent performed the review. When no independent reviewer is available, record `BLOCKED: independent review`, retain any actual reviewer results, and keep merge-ready and shipping gates closed. Passing tests or CI do not replace that verdict.

## Models and setup-pstack

| Cursor term | Codex action |
| --- | --- |
| `claude-*`, `grok-*`, `gpt-*`, `gemini-*` | Treat each as a requested provider/model, not a portable alias. Use it only when the live dispatch schema or authenticated model catalog confirms it. For an unavailable explicit selection, report the role and request a supported selection; do not silently substitute another vendor. |
| `inherit-parent`, `auto` | Omit `model` to inherit the session. A missing role also inherits the session rather than using an unverified Cursor default. |
| `pstack-models.mdc` | Load role choices from the applicable session instructions first. Otherwise read a bounded `pstack-models` block in the applicable project or user AGENTS.md as below. Codex does not load Cursor rules. |
| Effort suffix or token | Separate model and effort, then use `reasoning_effort` or the live tool's equivalent only if supported. For `session`, pass the known current session effort when the host exposes it and the selected model supports it; otherwise omit the override and report that parent-effort inheritance is unverified when an explicit model is selected. Omission can use that model's default. If a level is unsupported, report it and use a supported choice confirmed by the user. |

Before the first role dispatch, read the applicable model configuration if it is not already in context. Use the highest-precedence applicable instructions, without merging conflicting blocks. A list-valued panel keeps its entry count, including aliases. Record unsupported roles instead of reducing the panel silently. Source workflows no longer dispatch `hardest tasks`, architect runners, or reflect roles; do not repurpose those saved choices or automatically select a stronger model. The legacy `strongest judgment` alias may resolve a specifically requested legacy `hardest tasks` role only when that role has no explicit choice. Preserve its model and effort exactly, and never use the alias to restore retired upstream routing.

For an explicitly requested setup-pstack, follow the source skill's detect, current-state, budget, and confirmation steps with these changes:

1. Detect models and effort levels from the actual dispatch schema or authenticated host catalog. When detection is unavailable, use inheritance or request the available values. Never copy source provider defaults as Codex model choices.
2. Read existing choices from session instructions and the selected AGENTS.md block. Saved Codex model, effort, list, and alias values are user choices, including values that resemble old Cursor defaults. Never apply the source's Grok, Gemini, Fable, or budget replacement heuristics, regardless of `# defaults: 2` or `# defaults: 3`. Show every active source role, retired saved role, and unsupported choice. The single-file how, why, architect, and reflect skills do not dispatch their former roles. Preserve all retired lines during maintenance and dispatch. Only explicit setup may propose removing them, and only the confirmed table authorizes removal. Treat an absent role as `inherit-parent`.
3. Offer the current budgets `large` (xhigh), `medium` (high), and `small` (medium). For new choices, `large` keeps the source role's default effort, `medium` lowers it one step, and `small` lowers it two, using `low`, `medium`, `high`, `xhigh` with a default cap of `xhigh`. Keep existing explicit per-role efforts, panel entry efforts, saved `default effort`, `session`, and aliases until the user confirms a change. Explicit `max` or higher supported efforts remain choices; never silently clamp or rewrite them. Surface any saved `unlimited` budget and propose a current label only during explicit setup. Translate effort separately from the model slug to the live host's supported levels for that model. If a proposed level is unsupported, mark the role as needing a choice. Keep model families and panel lists; never invent fast/model slugs. Show starting and proposed efforts and confirm the concrete role table, including any retired-role removals, before persistence. A model-selection change does not authorize changing other agent settings.
4. Persist only the selected project AGENTS.md, or the user-level `$CODEX_HOME/AGENTS.md` (normally `~/.codex/AGENTS.md`) when the user chooses global scope. Preserve all text outside one `<!-- pstack-models:start -->` / `<!-- pstack-models:end -->` block. Replace that block idempotently; if multiple blocks or malformed delimiters exist, surface the conflict before writing. Use plain Markdown with one role per line, proposed `# defaults: 3` setup metadata, the confirmed budget label, and `default effort: session` or a confirmed supported level; no `.mdc` frontmatter. Show the exact destination before writing.
5. Read back the saved block and report its scope. New sessions load applicable AGENTS.md instructions; the current session uses the confirmed table. Never write model choices into the plugin cache or commit personal choices with the plugin.

A valid Codex model block without `# defaults: 2` or `# defaults: 3` still applies. Missing Cursor metadata triggers no setup reminder, unsolicited rewrite, or migration. Only the next explicitly requested setup may persist current metadata after confirming the table. Routine upstream maintenance never edits user or project model configuration.

Arena's cross-judge requires a different vendor from the parent, not merely a different GPT model. When the live host offers only GPT models, report `Skipped in Codex: cross-vendor judge. No supported different-vendor model.` Follow the source fallback by skipping the judge and letting the parent pick the base in Phase D, with that limitation recorded. Do not send unverified Claude or Gemini slugs, substitute a same-vendor judge, or claim provider diversity. This fallback does not satisfy any separate mandatory independent-review or shipping gate.

## Bundled skills and external helpers

The required child instruction document is bundled at `<pstack>/skills/poteto-mode/worker.md` in each harness. Internal PStack skills resolve to the absolute `<pstack>/skills/<name>/SKILL.md`. The upstream references to cursor-team-kit `deslop`, `control-cli`, and `control-ui` resolve to the bundled absolute `<pstack>/skills/deslop/SKILL.md`, `<pstack>/skills/control-cli/SKILL.md`, and `<pstack>/skills/control-ui/SKILL.md` respectively. These three directories preserve the source bytes from this repository's `cursor-team-kit/skills/`; their MIT license is bundled at `<pstack>/docs/dependencies/cursor-team-kit-LICENSE`. They need no second plugin or the old fork. Their generic harness examples remain subject to the host's browser, computer-use, shell, and data-access policies; prefer the host's supported tools and do not bypass its restrictions.

External helpers require separate capability discovery. Cursor's built-in `create-skill` maps to the installed Codex system `skill-creator` SKILL.md or the host's equivalent authoring skill. Resolve its actual absolute path from the live skill catalog. Other named plugins, skills, drivers, and integrations are not supplied merely because a workflow names them. Discover an installed equivalent and inspect its instructions and tools. If a mandatory helper is missing, mark the dependent gate blocked and continue independent work. Do not invent plugin names, paths, tools, or successful gates.

## Paths and history

| Cursor term | Codex action |
| --- | --- |
| `.cursor/skills/` | Project `.agents/skills/` or user `~/.agents/skills/` when manually installing skills. For plugin workflows use the installed `<pstack>/skills/` tree. |
| `~/.cursor/plugins/`, `.cursor-plugin/plugin.json` | Discover the installed plugin path from the active skill catalog. Portable metadata is root `plugin.json`; `.codex-plugin/plugin.json` is a compatibility fallback. Avoid hardcoded cache versions. |
| `.cursor/rules/`, always-applied rule | Applicable AGENTS.md instructions. Model configuration uses the bounded block above. |
| `agent-transcripts`, `~/.cursor/projects/` | Prefer host-provided thread/history tools. If local transcript access is authorized, discover the current workspace/session's location rather than assuming Cursor paths. Read only the relevant session; if unavailable, report the missing evidence. |
| Upstream GitHub pstack source links | Read `<pstack>/<path>` when bundled. Required reads use bundled files; links to omitted assets or automations are upstream reference material and may describe a newer revision. |

## Cursor-only features and activation

Codex capability availability does not follow from a Cursor workflow naming a feature. For an unavailable step report `Skipped in Codex: <step>. <reason>.` Continue independent steps; when a downstream step requires that output, mark it blocked and explain the missing prerequisite rather than fabricating a URL, key, or result.

| Cursor-only features | Codex action |
| --- | --- |
| Cursor Automations, routine state, `update_state`, `SendToUser`, `api2.cursor.sh/automations` | Use a host scheduling tool only if present and the user authorized scheduling. Otherwise skip the automation-dependent step. |
| Bugbot | Existing forge review comments can be read and triaged with the authorized forge tools. Skip configuring or waiting for a missing Bugbot service. |
| Cursor cloud agents | Worktrees provide local isolation only. Skip dashboard/machine-specific cloud steps when Codex has no equivalent. |
| Built-in PR tool | Use an available forge connector or CLI, following the user's publishing authority. |

This first adapter ships no startup hooks and does not auto-activate poteto-mode. Invoke the installed skill explicitly or use your existing standing instruction to activate it. Plugin discovery, activation, model availability, and successful workflow execution are separate checks.
