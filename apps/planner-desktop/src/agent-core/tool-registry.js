"use strict";

class ToolRegistry {
  constructor(tools = []) {
    this.tools = new Map();
    for (const tool of tools) this.register(tool);
  }
  register(tool) {
    if (!tool || typeof tool.name !== "string" || typeof tool.execute !== "function" || typeof tool.definition !== "function") throw new TypeError("Invalid tool");
    if (this.tools.has(tool.name)) throw new TypeError(`Duplicate tool: ${tool.name}`);
    this.tools.set(tool.name, tool);
    return this;
  }
  get(name) { return this.tools.get(name) || null; }
  definitions() { return [...this.tools.values()].map((tool) => tool.definition()); }
}

module.exports = { ToolRegistry };
