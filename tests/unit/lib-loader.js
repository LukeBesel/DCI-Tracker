// Loads a docs/lib/*.js browser module into a bare sandbox and returns the
// `window` globals it defined. The lib files are plain IIFE scripts with no
// DOM or fetch dependencies — that's the contract that keeps them testable.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadLib(file) {
  const code = fs.readFileSync(path.join(__dirname, "..", "..", "docs", "lib", file), "utf8");
  const sandbox = { window: {}, Date, Map, Set, Object, Array, JSON, Math, Infinity, isNaN, String, Number, URL, console };
  vm.runInNewContext(code, sandbox, { filename: file });
  return sandbox.window;
}

module.exports = { loadLib };
