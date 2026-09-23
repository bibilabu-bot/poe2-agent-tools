"use strict";

const path = require("node:path");
const { existsSync } = require("node:fs");
const readline = require("node:readline");
const { spawn } = require("node:child_process");

class PythonAgentError extends Error {
  constructor(code, message) { super(message); this.name = "PythonAgentError"; this.code = code; }
}

class PythonAgentClient {
  constructor({ executable, cwd = path.join(__dirname, ".."), memoryPath = "", onProgress = null } = {}) {
    const localPython = path.join(cwd, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    executable = executable || process.env.P2AT_PYTHON || (existsSync(localPython) ? localPython : "python");
    this.executable = executable; this.cwd = cwd; this.child = null; this.pending = new Map(); this.nextId = 1;
    this.memoryPath = memoryPath;
    this.onProgress = onProgress;
    this._treeWriteHandler = null;
  }
  setTreeWriteHandler(handler) { this._treeWriteHandler = handler || null; }
  async request(method, params = {}, options = {}) {
    this.#ensureProcess();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onEvent: typeof options.onEvent === "function" ? options.onEvent : null, lastSeq: 0 });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, "utf8", (error) => {
        if (!error) return;
        this.pending.delete(id); reject(new PythonAgentError("PYTHON_RUNTIME_WRITE_FAILED", "无法向 Python 智能体发送请求"));
      });
    });
  }
  terminate(reason = new PythonAgentError("CANCELLED", "已停止本次回复")) {
    const child = this.child; this.child = null;
    if (child && !child.killed) child.kill();
    this.#rejectAll(reason);
  }
  #ensureProcess() {
    if (this.child && !this.child.killed) return;
    const bootstrap = "import runpy,sys;sys.path.insert(0,sys.argv[1]);runpy.run_module('python_agent.rpc_server',run_name='__main__')";
    const child = spawn(this.executable, ["-X", "utf8", "-I", "-c", bootstrap, this.cwd], {
      cwd: this.cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", P2AT_AGENT_MEMORY_DB: this.memoryPath },
    });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    readline.createInterface({ input: child.stdout }).on("line", (line) => this.#handleLine(child, line));
    child.stderr.on("data", () => {});
    child.once("error", () => {
      if (this.child !== child) return;
      this.child = null;
      this.#rejectAll(new PythonAgentError("PYTHON_RUNTIME_UNAVAILABLE", "无法启动 Python 智能体运行时"));
    });
    child.once("exit", () => {
      if (this.child !== child) return;
      this.child = null;
      this.#rejectAll(new PythonAgentError("PYTHON_RUNTIME_EXITED", "Python 智能体运行时已退出"));
    });
  }
  #handleLine(child, line) {
    if (this.child !== child) return;
    let response;
    try { response = JSON.parse(line); } catch { this.terminate(new PythonAgentError("PYTHON_PROTOCOL_ERROR", "Python 智能体返回了无效数据")); return; }
    // Tree write callbacks: Python tool requests Electron to execute plannerWriteAPI.
    if (response.callback) {
      this._handleCallback(child, response);
      return;
    }
    if (response.event === "rag_progress") {
      if (Number.isInteger(response.completed) && Number.isInteger(response.total) && response.completed >= 0 && response.completed <= response.total && response.total <= 20000) this.onProgress?.({completed:response.completed,total:response.total});
      return;
    }
    const pending = this.pending.get(response.id); if (!pending) return;
    if (response.event === "agent_run") {
      if (!Number.isInteger(response.seq) || response.seq <= pending.lastSeq || response.seq > 100000) return;
      if (!["phase", "text_delta", "tool_started", "tool_finished"].includes(response.type)) return;
      if (response.type === "text_delta" && (typeof response.text !== "string" || response.text.length > 4096)) return;
      if (response.type === "phase" && (typeof response.phase !== "string" || response.phase.length > 64)) return;
      if (response.type.startsWith("tool_") && (typeof response.name !== "string" || response.name.length > 64)) return;
      pending.lastSeq = response.seq;
      pending.onEvent?.(response);
      return;
    }
    this.pending.delete(response.id);
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new PythonAgentError(response.error?.code || "AGENT_FAILED", response.error?.message || "智能体运行失败"));
  }
  #rejectAll(error) { for (const pending of this.pending.values()) pending.reject(error); this.pending.clear(); }
  async _handleCallback(child, msg) {
    const handler = this._treeWriteHandler;
    let result;
    try {
      if (!handler) throw new PythonAgentError("TREE_WRITE_UNAVAILABLE", "天赋树写入处理器未就绪");
      if (typeof msg.method !== "string" || typeof msg.callback_id !== "string" || !msg.callback_id || !/^[a-z_]+$/.test(msg.method)) throw new PythonAgentError("INVALID_CALLBACK", "回调消息格式无效");
      result = await handler(msg.method, msg.params || {});
    } catch (error) {
      result = null;
    }
    // Write result back to Python's stdin to resolve the waiting future.
    const reply = { callback_result: true, callback_id: msg.callback_id };
    if (result && result.success) reply.result = result;
    else reply.error = result?.errorCode ? { code: result.errorCode, message: result.message } : { code: "TREE_WRITE_FAILED", message: "天赋树写入失败" };
    if (this.child === child) child.stdin.write(JSON.stringify(reply) + "\n");
  }
}

module.exports = { PythonAgentClient, PythonAgentError };
