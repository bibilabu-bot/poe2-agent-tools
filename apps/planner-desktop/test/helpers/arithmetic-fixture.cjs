"use strict";

const { BaseTool } = require("../../src/agent-core/base-tool.js");

class ArithmeticFixtureTool extends BaseTool {
  constructor() {
    super({
      name: "fixture_arithmetic",
      description: "Safely add, subtract, multiply, or divide two finite numbers.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["operator", "a", "b"],
        properties: {
          operator: { type: "string", enum: ["add", "subtract", "multiply", "divide"] },
          a: { type: "number", minimum: -1e100, maximum: 1e100 },
          b: { type: "number", minimum: -1e100, maximum: 1e100 },
        },
      },
    });
  }
  async execute({ operator, a, b }, { signal } = {}) {
    signal?.throwIfAborted();
    if (operator === "divide" && b === 0) throw new Error("Division by zero is not allowed");
    const operations = { add: () => a + b, subtract: () => a - b, multiply: () => a * b, divide: () => a / b };
    const result = operations[operator]();
    if (!Number.isFinite(result)) throw new Error("Calculation result is not finite");
    return { result };
  }
}

module.exports = { ArithmeticFixtureTool };
