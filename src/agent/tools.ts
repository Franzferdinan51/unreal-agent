// Unreal Agent — Built-in tools (local filesystem)
// No subprocess management yet — bash delegates to Node.

import type { ToolDefinition, ToolContext } from "../types.js";

function args<T = string>(args: Record<string, unknown>, key: string, def?: T): T {
  if (!(key in args)) {
    if (def !== undefined) return def;
    throw new Error(`Missing required argument: ${key}`);
  }
  return args[key] as T;
}

function err(msg: string) {
  return { content: msg, isError: true };
}

function ok(text: string) {
  return { content: text };
}

// ── read ─────────────────────────────────────────────────────

export const readTool: ToolDefinition = {
  name: "read",
  description: "Read a file's contents. Path is relative to the agent's cwd unless absolute.",
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "File path to read" } },
    required: ["path"],
    additionalProperties: false,
  },
  handler: async (a, ctx) => {
    const path = args<string>(a, "path");
    const fs = await import("node:fs/promises");
    const path_ = await import("node:path");
    const abs = path_.isAbsolute(path) ? path : path_.resolve(ctx.cwd, path);
    try {
      const data = await fs.readFile(abs, "utf8");
      return ok(data);
    } catch (e: any) {
      return err(`read failed: ${e?.message ?? e}`);
    }
  },
};

// ── write ────────────────────────────────────────────────────

export const writeTool: ToolDefinition = {
  name: "write",
  description: "Write content to a file (overwrites). Path is relative to cwd unless absolute.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to write" },
      content: { type: "string", description: "Full file content" },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  dangerous: true,
  handler: async (a, ctx) => {
    const path = args<string>(a, "path");
    const content = args<string>(a, "content");
    const fs = await import("node:fs/promises");
    const path_ = await import("node:path");
    const abs = path_.isAbsolute(path) ? path : path_.resolve(ctx.cwd, path);
    try {
      await fs.mkdir(path_.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, "utf8");
      return ok(`wrote ${content.length} bytes to ${path}`);
    } catch (e: any) {
      return err(`write failed: ${e?.message ?? e}`);
    }
  },
};

// ── edit ─────────────────────────────────────────────────────

export const editTool: ToolDefinition = {
  name: "edit",
  description: "Replace oldText with newText in a file. oldText must match exactly once.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path" },
      oldText: { type: "string", description: "Existing text to replace (must match exactly once)" },
      newText: { type: "string", description: "Replacement text" },
    },
    required: ["path", "oldText", "newText"],
    additionalProperties: false,
  },
  dangerous: true,
  handler: async (a, ctx) => {
    const path = args<string>(a, "path");
    const oldText = args<string>(a, "oldText");
    const newText = args<string>(a, "newText");
    const fs = await import("node:fs/promises");
    const path_ = await import("node:path");
    const abs = path_.isAbsolute(path) ? path : path_.resolve(ctx.cwd, path);
    try {
      const data = await fs.readFile(abs, "utf8");
      const occurrences = data.split(oldText).length - 1;
      if (occurrences === 0) return err(`edit failed: oldText not found in ${path}`);
      if (occurrences > 1) return err(`edit failed: oldText matches ${occurrences} times in ${path} — must match exactly once`);
      const updated = data.replace(oldText, newText);
      await fs.writeFile(abs, updated, "utf8");
      return ok(`edited ${path}`);
    } catch (e: any) {
      return err(`edit failed: ${e?.message ?? e}`);
    }
  },
};

// ── ls ───────────────────────────────────────────────────────

export const lsTool: ToolDefinition = {
  name: "ls",
  description: "List a directory.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path (default: cwd)" },
    },
    additionalProperties: false,
  },
  handler: async (a, ctx) => {
    const input = (a.path as string | undefined) ?? ".";
    const fs = await import("node:fs/promises");
    const path_ = await import("node:path");
    const abs = path_.isAbsolute(input) ? input : path_.resolve(ctx.cwd, input);
    try {
      const entries = await fs.readdir(abs, { withFileTypes: true });
      const lines = entries
        .map((e) => `${e.isDirectory() ? "d" : "-"} ${e.name}`)
        .sort();
      return ok(lines.join("\n"));
    } catch (e: any) {
      return err(`ls failed: ${e?.message ?? e}`);
    }
  },
};

// ── grep ─────────────────────────────────────────────────────

export const grepTool: ToolDefinition = {
  name: "grep",
  description: "Search files in cwd for a regex. Returns matching lines with file:line:content.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regex pattern" },
      glob: { type: "string", description: "Optional file glob (e.g. '*.cpp')" },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  handler: async (a, ctx) => {
    const pattern = args<string>(a, "pattern");
    const glob = (a.glob as string | undefined) ?? null;
    const { execSync } = await import("node:child_process");
    let cmd: string;
    if (process.platform === "darwin" || process.platform === "linux") {
      const grepArgs = glob ? `--include="${glob}"` : "";
      cmd = `grep -rn ${grepArgs} -E ${JSON.stringify(pattern)} .`;
    } else {
      // fall back to node-side scan
      const fs = await import("node:fs/promises");
      const path_ = await import("node:path");
      const re = new RegExp(pattern);
      const results: string[] = [];
      async function walk(dir: string) {
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          const full = path_.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name === ".git") continue;
            await walk(full);
          } else if (!glob || entry.name.match(globToRegex(glob))) {
            const content = await fs.readFile(full, "utf8").catch(() => "");
            content.split("\n").forEach((line, i) => {
              if (re.test(line)) results.push(`${full}:${i + 1}:${line}`);
            });
          }
        }
      }
      await walk(ctx.cwd);
      return ok(results.slice(0, 200).join("\n") || "(no matches)");
    }
    try {
      const out = execSync(cmd, { cwd: ctx.cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return ok(out.slice(0, 8000) || "(no matches)");
    } catch (e: any) {
      const stderr = e?.stderr ? e.stderr.toString() : "";
      if (e?.status === 1) return ok("(no matches)");
      return err(`grep failed: ${stderr || e?.message}`);
    }
  },
};

function globToRegex(glob: string): RegExp {
  return new RegExp("^" + glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
}

// ── find ─────────────────────────────────────────────────────

export const findTool: ToolDefinition = {
  name: "find",
  description: "Find files by glob pattern.",
  parameters: {
    type: "object",
    properties: { pattern: { type: "string", description: "Glob (e.g. '**/*.cpp')" } },
    required: ["pattern"],
    additionalProperties: false,
  },
  handler: async (a, ctx) => {
    const pattern = args<string>(a, "pattern");
    const fs = await import("node:fs/promises");
    const path_ = await import("node:path");
    const re = globToRegex(pattern);
    const results: string[] = [];
    async function walk(dir: string, rel: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const full = path_.join(dir, entry.name);
        const rfull = path_.join(rel, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "Binaries" || entry.name === "Intermediate") continue;
          await walk(full, rfull);
        } else if (re.test(rfull)) {
          results.push(rfull);
        }
      }
    }
    await walk(ctx.cwd, "");
    return ok(results.slice(0, 200).join("\n") || "(no matches)");
  },
};

// ── bash ─────────────────────────────────────────────────────

export const bashTool: ToolDefinition = {
  name: "bash",
  description: "Execute a shell command in cwd. Returns stdout + stderr (max 8KB).",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to execute" },
      timeout: { type: "number", description: "Timeout in ms (default 30s)" },
    },
    required: ["command"],
    additionalProperties: false,
  },
  dangerous: true,
  handler: async (a, ctx) => {
    const command = args<string>(a, "command");
    const timeout = (a.timeout as number | undefined) ?? 30000;
    const { exec } = await import("node:child_process");
    return new Promise((resolve) => {
      exec(command, { cwd: ctx.cwd, timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        const out = (stdout ?? "") + (stderr ? stderr.length ? `\n[stderr]\n${stderr}` : "" : "");
        if (err) {
          resolve(ok(`[exit ${err.code ?? 1}]\n${out.slice(0, 8000)}`));
        } else {
          resolve(ok(out.slice(0, 8000) || "(no output)"));
        }
      });
    });
  },
};

// ── registry ─────────────────────────────────────────────────

export function defaultTools(): ToolDefinition[] {
  return [readTool, writeTool, editTool, lsTool, grepTool, findTool, bashTool];
}

export function toolName(t: ToolDefinition): string {
  return t.name;
}
