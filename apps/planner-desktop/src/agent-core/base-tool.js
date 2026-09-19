"use strict";

const MAX_ARGUMENT_BYTES = 16 * 1024;

class ToolValidationError extends Error {
  constructor(message, code = "INVALID_TOOL_ARGUMENTS") {
    super(message);
    this.name = "ToolValidationError";
    this.code = code;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateSchema(schema, value, path = "arguments") {
  if (!schema || typeof schema !== "object") throw new ToolValidationError("Tool schema is invalid", "INVALID_TOOL_SCHEMA");
  if (schema.type === "object") {
    if (!isPlainObject(value)) throw new ToolValidationError(`${path} must be an object`);
    const properties = schema.properties || {};
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) throw new ToolValidationError(`${path}.${key} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) throw new ToolValidationError(`${path}.${key} is not allowed`);
      }
    }
    for (const [key, item] of Object.entries(value)) {
      if (properties[key]) validateSchema(properties[key], item, `${path}.${key}`);
    }
  } else if (schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new ToolValidationError(`${path} must be a finite number`);
    if (Number.isFinite(schema.minimum) && value < schema.minimum) throw new ToolValidationError(`${path} is below the minimum`);
    if (Number.isFinite(schema.maximum) && value > schema.maximum) throw new ToolValidationError(`${path} exceeds the maximum`);
  } else if (schema.type === "string") {
    if (typeof value !== "string") throw new ToolValidationError(`${path} must be a string`);
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) throw new ToolValidationError(`${path} is too long`);
  } else if (schema.type === "boolean" && typeof value !== "boolean") {
    throw new ToolValidationError(`${path} must be a boolean`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) throw new ToolValidationError(`${path} is not an allowed value`);
}

class BaseTool {
  constructor({ name, description, parameters }) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name || "")) throw new TypeError("Tool name is invalid");
    if (typeof description !== "string" || !description.trim()) throw new TypeError("Tool description is required");
    this.name = name;
    this.description = description;
    this.parameters = Object.freeze(structuredClone(parameters));
  }

  definition() {
    return { type: "function", function: { name: this.name, description: this.description, parameters: this.parameters } };
  }

  parseAndValidate(rawArguments) {
    if (typeof rawArguments !== "string") throw new ToolValidationError("Tool arguments must be JSON text");
    if (new TextEncoder().encode(rawArguments).byteLength > MAX_ARGUMENT_BYTES) throw new ToolValidationError("Tool arguments are too large");
    let value;
    try { value = JSON.parse(rawArguments); } catch { throw new ToolValidationError("Tool arguments are not valid JSON"); }
    validateSchema(this.parameters, value);
    return value;
  }

  async execute() { throw new Error("Tool execute() is not implemented"); }
}

module.exports = { BaseTool, ToolValidationError, validateSchema, MAX_ARGUMENT_BYTES };
