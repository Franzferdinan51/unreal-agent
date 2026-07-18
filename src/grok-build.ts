// Grok Build adapter.
//
// Grok Build owns the coding/tool loop. Unreal Agent supplies the UE-specific
// skill prompt and workspace, then consumes Grok's documented headless stream.

import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";

export type GrokEvent =
  | { type: "text"; data: string }
  | { type: "thought"; data: string }
  | { type: "end"; sessionId?: string; usage?: unknown }
  | { type: "error"; message: string }
  | { type: string; [key: string]: unknown };

export interface GrokRunOptions {
  prompt: string;
  cwd: string;
  command?: string;
  model?: string;
  sessionId?: string;
  maxTurns?: number;
  alwaysApprove?: boolean;
  noPlan?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: GrokEvent) => void;
}

export async function resolveGrokCommand(explicit?: string): Promise<string> {
  const candidates = [explicit, process.env.GROK_BUILD_PATH, "grok"].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (candidate === "grok") return candidate;
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next configured location.
    }
  }
  throw new Error("Grok Build was not found. Install it or set GROK_BUILD_PATH.");
}

export async function grokVersion(command?: string): Promise<string> {
  const executable = await resolveGrokCommand(command);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve((stdout || stderr).trim());
      else reject(new Error((stderr || stdout || `grok exited ${code}`).trim()));
    });
  });
}

export async function runGrok(options: GrokRunOptions): Promise<{ sessionId?: string }> {
  const executable = await resolveGrokCommand(options.command);
  const args = ["-p", options.prompt, "--cwd", options.cwd, "--output-format", "streaming-json"];
  if (options.model) args.push("--model", options.model);
  if (options.sessionId) args.push("--resume", options.sessionId);
  if (options.maxTurns && options.maxTurns > 0) args.push("--max-turns", String(Math.min(100, Math.floor(options.maxTurns))));
  if (options.alwaysApprove) args.push("--always-approve");
  if (options.noPlan) args.push("--no-plan");

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let buffer = "";
    let stderr = "";
    let sessionId: string | undefined;
    let settled = false;

    const emit = (event: GrokEvent) => {
      if (event.type === "end" && typeof event.sessionId === "string") sessionId = event.sessionId;
      options.onEvent?.(event);
    };
    const parse = (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as GrokEvent;
          emit(event);
        } catch {
          emit({ type: "text", data: line });
        }
      }
    };
    child.stdout.on("data", parse);
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    const abort = () => terminate(child);
    if (options.signal?.aborted) abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => { settled = true; reject(error); });
    child.once("close", (code) => {
      options.signal?.removeEventListener("abort", abort);
      if (buffer.trim()) parse(Buffer.from("\n"));
      if (settled) return;
      settled = true;
      if (code === 0) resolve({ sessionId });
      else {
        const message = stderr.trim() || `Grok Build exited with code ${code}`;
        emit({ type: "error", message });
        reject(new Error(message));
      }
    });
  });
}

function terminate(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}
