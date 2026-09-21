"use strict";

class BaseAgent {
  constructor({ name, systemPrompt = "" }) {
    if (typeof name !== "string" || !name.trim()) throw new TypeError("Agent name is required");
    this.name = name;
    this.systemPrompt = String(systemPrompt).slice(0, 8_000);
  }

  initialMessages(history) {
    const messages = Array.isArray(history) ? history.map((message) => structuredClone(message)) : [];
    return this.systemPrompt ? [{ role: "system", content: this.systemPrompt }, ...messages] : messages;
  }
}

class ChatAgent extends BaseAgent {
  // Legacy loop compatibility only. The production Python runtime owns defaults.
  constructor({ systemPrompt = "" } = {}) {
    super({
      name: "chat",
      systemPrompt,
    });
  }
}

module.exports = { BaseAgent, ChatAgent };
