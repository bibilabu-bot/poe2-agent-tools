"use strict";

class ModelProvider {
  async listModels() { throw new Error("listModels() is not implemented"); }
  async complete() { throw new Error("complete() is not implemented"); }
}

module.exports = { ModelProvider };
