import { existsSync, readdirSync, readFileSync, appendFileSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

const THREAD_RE = /^THREAD:\s*([a-z0-9][a-z0-9-]*)\s*$/
const DISPATCH_RE = /^FRAY_DISPATCH_ID:\s*(\S+)\s*$/m

const EPILOGUE = `

---
[ORCHESTRATION EPILOGUE - appended by .opencode/plugins/fray.ts]
End your final report with a \`## Follow-ups\` section so the orchestrator can chain the next steps:
1. Concrete follow-up work your findings or changes imply.
2. If you implemented something substantial, recommend a fresh adversarial review pass.
3. If you changed code or tests CI should exercise, recommend a push-to-main and CI-watch follow-up.
4. The single most important next step, and whether it needs the maintainer because it is a default/security/product/brand/API-config-env call.
If there are no follow-ups, write exactly:
\`\`\`markdown
## Follow-ups
None.
\`\`\``

function frayRoot(directory: string, worktree?: string) {
  return worktree || directory
}

function loadConfig(root: string) {
  try {
    const src = readFileSync(join(root, ".fray", "config.yml"), "utf8")
    return {
      enabled: !/^enabled:\s*(false|off|no)\b/im.test(src),
      autonomousMode: /^autonomous_mode:\s*(true|on|yes)\b/im.test(src),
    }
  } catch {
    return { enabled: true, autonomousMode: false }
  }
}

function pendingThreads(root: string) {
  try {
    const dir = join(root, ".fray")
    return readdirSync(dir)
      .filter((name) => name.endsWith(".md") && !name.startsWith("_"))
      .map((name) => {
        const src = readFileSync(join(dir, name), "utf8")
        const status = src.match(/^status:\s*(.+?)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, "") || "?"
        if (status === "done" || status === "dismissed") return null
        const title = src.match(/^title:\s*(.+?)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, "") || name
        return `${name.replace(/\.md$/, "")} [${status}] - ${title}`
      })
      .filter(Boolean)
      .join("\n")
  } catch {
    return ""
  }
}

function appendLedger(root: string, row: Record<string, unknown>) {
  try {
    appendFileSync(join(root, ".fray", ".dispatch-ledger.jsonl"), `${JSON.stringify(row)}\n`)
  } catch {
    // The thread file remains authoritative; ledger failures must not block work.
  }
}

function leadingThread(prompt: string) {
  const first = prompt.split("\n").find((line) => line.trim())?.trim() || ""
  return first.match(THREAD_RE)?.[1]
}

export const OpenCodeFray = async ({ directory, worktree }: { directory: string; worktree?: string }) => {
  const root = frayRoot(directory, worktree)

  return {
    "tool.execute.before": async (input: { tool?: string }, output: { args?: Record<string, unknown> }) => {
      const tool = String(input.tool || "").toLowerCase()
      if (tool !== "task") return

      const args = output.args || {}
      let prompt = typeof args.prompt === "string" ? args.prompt : ""
      const thread = leadingThread(prompt)
      if (!thread) return

      const cfg = loadConfig(root)
      if (!cfg.enabled) return

      const threadPath = join(root, ".fray", `${thread}.md`)
      if (!existsSync(threadPath)) {
        throw new Error(`Fray thread .fray/${thread}.md does not exist. Create the thread file before dispatching.`)
      }

      let dispatchId = prompt.match(DISPATCH_RE)?.[1]
      if (!dispatchId) {
        dispatchId = `opencode-${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${randomUUID().slice(0, 8)}`
        prompt = prompt.replace(/^(\s*THREAD:\s*.+)$/m, `$1\nFRAY_DISPATCH_ID: ${dispatchId}`)
      }

      if (!prompt.includes("[ORCHESTRATION EPILOGUE")) prompt += EPILOGUE
      args.prompt = prompt
      output.args = args

      appendLedger(root, {
        ts: new Date().toISOString(),
        tool: "opencode.task",
        dispatch_id: dispatchId,
        thread,
        task_id: "",
        reconciled: false,
      })
    },

    "experimental.session.compacting": async (_input: unknown, output: { context?: string[] }) => {
      const cfg = loadConfig(root)
      if (!cfg.enabled) return
      const pending = pendingThreads(root)
      output.context ||= []
      output.context.push(
        `## Fray State\nFray is enabled. autonomous_mode: ${cfg.autonomousMode ? "on" : "off"}. Pending threads:\n${pending || "none"}\nBefore continuing, load the opencode-fray skill and run \`node scripts/fray/index.mjs\`.`,
      )
    },
  }
}
