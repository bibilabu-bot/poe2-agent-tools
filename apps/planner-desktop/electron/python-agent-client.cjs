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
  }
  async request(method, params = {}) {
    this.#ensureProcess();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
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
    if (response.event === "rag_progress") {
      if (Number.isInteger(response.completed) && Number.isInteger(response.total) && response.completed >= 0 && response.completed <= response.total && response.total <= 20000) this.onProgress?.({completed:response.completed,total:response.total});
      return;
    }
    const pending = this.pending.get(response.id); if (!pending) return;
    this.pending.delete(response.id);
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new PythonAgentError(response.error?.code || "AGENT_FAILED", response.error?.message || "智能体运行失败"));
  }
  #rejectAll(error) { for (const pending of this.pending.values()) pending.reject(error); this.pending.clear(); }
}

module.exports = { PythonAgentClient, PythonAgentError };
