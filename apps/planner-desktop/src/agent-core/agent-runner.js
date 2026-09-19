"use strict";

const DEFAULT_LIMITS = Object.freeze({ maxModelRounds: 6, maxToolCalls: 12, maxMessages: 80, maxTextChars: 32_000, maxToolResultChars: 8_000 });

class AgentRunError extends Error {
  constructor(code, message) { super(message); this.name = "AgentRunError"; this.code = code; }
}

function boundedText(value, limit) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length <= limit ? text : `${text.slice(0, limit)}…[truncated]`;
}

class AgentRunner {
  constructor({ provider, registry, limits = {} }) {
    this.provider = provider;
    this.registry = registry;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.running = false;
  }

  async run({ agent, history, model, toolsEnabled = true, signal }) {
    if (this.running) throw new AgentRunError("RUN_IN_PROGRESS", "A response is already running for this session");
    this.running = true;
    const trace = [];
    let toolCount = 0;
    try {
      signal?.throwIfAborted();
      let messages = agent.initialMessages(history).slice(-this.limits.maxMessages);
      for (let round = 1; round <= this.limits.maxModelRounds; round += 1) {
        signal?.throwIfAborted();
        const response = await this.provider.complete({
          model,
          messages,
          tools: toolsEnabled ? this.registry.definitions() : [],
          signal,
        });
        const content = boundedText(response.content || "", this.limits.maxTextChars);
        const rawToolCalls = Array.isArray(response.toolCalls) ? response.toolCalls : [];
        if (rawToolCalls.length > this.limits.maxToolCalls - toolCount) throw new AgentRunError("TOOL_CALL_LIMIT", `Stopped before exceeding ${this.limits.maxToolCalls} tool calls`);
        const seenCallIds = new Set();
        const toolCalls = rawToolCalls.map((call, index) => {
          const proposedId = typeof call?.id === "string" && call.id.length <= 256 ? call.id : "";
          const id = proposedId && !seenCallIds.has(proposedId) ? proposedId : `invalid-${round}-${index + 1}`;
          seenCallIds.add(id);
          return {
            id,
            name: typeof call?.name === "string" ? call.name.slice(0, 64) : "",
            arguments: typeof call?.arguments === "string" ? call.arguments.slice(0, 16_385) : "",
            malformed: id !== proposedId,
          };
        });
        const assistantMessage = { role: "assistant", content };
        if (toolCalls.length) assistantMessage.tool_calls = toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } }));
        messages.push(assistantMessage);
        if (!toolCalls.length) return { status: "completed", text: content, messages, trace, rounds: round, toolCalls: toolCount };
        if (!toolsEnabled) throw new AgentRunError("TOOLS_DISABLED", "The selected service requested a tool while tools are disabled");
        for (const call of toolCalls) {
          signal?.throwIfAborted();
          toolCount += 1;
          if (toolCount > this.limits.maxToolCalls) throw new AgentRunError("TOOL_CALL_LIMIT", `Stopped after ${this.limits.maxToolCalls} tool calls`);
          const tool = this.registry.get(call.name);
          let result;
          let ok = false;
          try {
            if (call.malformed) throw new Error("Tool call has no unique valid call ID");
            if (!tool) throw new Error(`Unknown tool: ${call.name}`);
            const args = tool.parseAndValidate(call.arguments);
            result = await tool.execute(args, { signal });
            ok = true;
          } catch (error) {
            if (signal?.aborted) throw error;
            const validationFailure = typeof error?.code === "string" && error.code.startsWith("INVALID_TOOL_");
            result = { error: { code: error.code || "TOOL_EXECUTION_FAILED", message: validationFailure ? boundedText(error.message, 500) : "Tool execution failed safely" } };
          }
          const resultText = boundedText(result, this.limits.maxToolResultChars);
          trace.push({ callId: call.id || "invalid", name: String(call.name || "unknown").slice(0, 64), ok, result: resultText });
          messages.push({ role: "tool", tool_call_id: call.id || "invalid", content: resultText });
        }
        messages = messages.slice(-this.limits.maxMessages);
      }
      throw new AgentRunError("MODEL_ROUND_LIMIT", `Stopped after ${this.limits.maxModelRounds} model rounds`);
    } finally {
      this.running = false;
    }
  }
}

module.exports = { AgentRunner, AgentRunError, DEFAULT_LIMITS };
