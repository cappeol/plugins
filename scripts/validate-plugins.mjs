#!/usr/bin/env node

import { readFileSync, existsSync, readdirSync, realpathSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadJSON(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

const marketplaceSchema = loadJSON(
  resolve(root, "schemas/marketplace.schema.json")
);
const pluginSchema = loadJSON(resolve(root, "schemas/plugin.schema.json"));

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const validateMarketplace = ajv.compile(marketplaceSchema);
const validatePlugin = ajv.compile(pluginSchema);

let errors = 0;

function fail(message) {
  console.error(`ERROR: ${message}`);
  errors++;
}

// 1. Validate marketplace.json
const marketplacePath = resolve(root, ".cursor-plugin/marketplace.json");

if (!existsSync(marketplacePath)) {
  fail(".cursor-plugin/marketplace.json not found");
  process.exit(1);
}

const marketplace = loadJSON(marketplacePath);

if (!validateMarketplace(marketplace)) {
  fail("marketplace.json schema validation failed:");
  for (const err of validateMarketplace.errors) {
    console.error(`  ${err.instancePath || "/"}: ${err.message}`);
  }
}

// 2. Validate each plugin
for (const entry of marketplace.plugins ?? []) {
  const pluginDir = resolve(root, entry.source);
  const pluginJsonPath = resolve(pluginDir, ".cursor-plugin/plugin.json");

  // Check source directory exists
  if (!existsSync(pluginDir)) {
    fail(
      `Plugin "${entry.name}": source directory "${entry.source}" does not exist`
    );
    continue;
  }

  // Check plugin.json exists
  if (!existsSync(pluginJsonPath)) {
    fail(
      `Plugin "${entry.name}": missing .cursor-plugin/plugin.json in "${entry.source}"`
    );
    continue;
  }

  const pluginJson = loadJSON(pluginJsonPath);

  if (!validatePlugin(pluginJson)) {
    fail(
      `Plugin "${entry.name}": plugin.json schema validation failed (${entry.source}/.cursor-plugin/plugin.json):`
    );
    for (const err of validatePlugin.errors) {
      const detail =
        err.keyword === "additionalProperties"
          ? `${err.message}: "${err.params.additionalProperty}"`
          : err.message;
      console.error(`  ${err.instancePath || "/"}: ${detail}`);
    }
  }

  // Check that marketplace name matches plugin name
  if (pluginJson.name && pluginJson.name !== entry.name) {
    fail(
      `Plugin "${entry.name}": marketplace name does not match plugin.json name "${pluginJson.name}"`
    );
  }
}

const claudeMarketplacePath = resolve(root, ".claude-plugin/marketplace.json");
const claudeMarketplace = existsSync(claudeMarketplacePath)
  ? loadJSON(claudeMarketplacePath)
  : { plugins: [] };

for (const entry of claudeMarketplace.plugins ?? []) {
  const pluginDir = resolve(root, entry.source);
  const pluginJsonPath = resolve(pluginDir, ".claude-plugin/plugin.json");

  if (!existsSync(pluginJsonPath)) {
    fail(
      `Plugin "${entry.name}": missing .claude-plugin/plugin.json in "${entry.source}"`
    );
    continue;
  }

  const pluginJson = loadJSON(pluginJsonPath);
  if (pluginJson.name && pluginJson.name !== entry.name) {
    fail(
      `Plugin "${entry.name}": Claude marketplace name does not match .claude-plugin/plugin.json name "${pluginJson.name}"`
    );
  }
}

// Codex uses its own catalog shape, not the Cursor marketplace schema.
const codexPath = resolve(root, ".agents/plugins/marketplace.json");
try {
  const codexMarketplace = loadJSON(codexPath);
  if (codexMarketplace.name !== "pstack-codex" || !codexMarketplace.interface?.displayName ||
      !Array.isArray(codexMarketplace.plugins) || codexMarketplace.plugins.length !== 1) {
    throw new Error("expected named pstack-codex marketplace with displayName and one plugin");
  }
  const [entry] = codexMarketplace.plugins;
  if (entry.name !== "pstack" || entry.source?.source !== "local" ||
      entry.source.path !== "./harness/pstack/codex" ||
      entry.policy?.installation !== "AVAILABLE" || entry.policy?.authentication !== "ON_INSTALL" ||
      entry.category !== "Developer Tools") {
    throw new Error("expected pstack local source ./harness/pstack/codex, AVAILABLE/ON_INSTALL, Developer Tools");
  }
  const pluginDir = resolve(root, entry.source.path);
  if (!realpathSync(pluginDir).startsWith(`${realpathSync(root)}/`)) throw new Error("source escapes marketplace root");
  const portable = loadJSON(resolve(pluginDir, "plugin.json"));
  const overlay = loadJSON(resolve(pluginDir, ".codex-plugin/plugin.json"));
  const upstream = loadJSON(resolve(root, "pstack/plugin.json"));
  for (const [label, manifest] of [["portable", portable], ["compatibility", overlay]]) {
    if (manifest.name !== entry.name || manifest.version !== upstream.version ||
        JSON.stringify(manifest.author) !== JSON.stringify(upstream.author)) {
      fail(`Codex ${label} identity, version or original author differs from pstack/plugin.json`);
    }
  }
  const presentation = portable.extensions?.["com.openai"];
  if (!presentation?.interface?.displayName?.includes("cappeol") ||
      JSON.stringify(presentation.interface) !== JSON.stringify(overlay.interface)) {
    fail("Codex presentation must identify the adaptation and match the compatibility overlay");
  }
  if (presentation?.hooks || overlay.hooks || existsSync(resolve(pluginDir, "hooks"))) fail("Codex first version must ship without hooks");
  const sourceSkills = readdirSync(resolve(root, "pstack/skills"))
    .filter((name) => existsSync(resolve(root, "pstack/skills", name, "SKILL.md")));
  for (const name of [...sourceSkills, "deslop", "control-cli", "control-ui"]) {
    if (!existsSync(resolve(pluginDir, "skills", name, "SKILL.md"))) fail(`Codex missing skill ${name}`);
  }
  const dependencyLicense = resolve(pluginDir, "docs/dependencies/cursor-team-kit-LICENSE");
  if (!existsSync(dependencyLicense) ||
      !readFileSync(dependencyLicense).equals(readFileSync(resolve(root, "cursor-team-kit/LICENSE")))) {
    fail("Codex missing or changed cursor-team-kit license");
  }
} catch (error) {
  fail(`Codex marketplace: ${error.message}`);
}

const manifestPaths = [
  ".cursor-plugin/plugin.json",
  ".claude-plugin/plugin.json",
  "plugin.json",
];
const sources = new Map();
for (const entry of [
  ...(marketplace.plugins ?? []),
  ...(claudeMarketplace.plugins ?? []),
]) {
  sources.set(resolve(root, entry.source), entry.name);
}

for (const [pluginDir, name] of sources) {
  const versions = manifestPaths
    .map((path) => resolve(pluginDir, path))
    .filter((path) => existsSync(path))
    .map((path) => ({ path, version: loadJSON(path).version }))
    .filter(({ version }) => version !== undefined);

  if (new Set(versions.map(({ version }) => version)).size > 1) {
    fail(`Plugin "${name}": manifest versions differ:`);
    for (const { path, version } of versions) {
      console.error(`  ${path.slice(root.length + 1)}: ${version}`);
    }
  }
}

// 3. Report results
if (errors > 0) {
  console.error(`\nValidation failed with ${errors} error(s).`);
  process.exit(1);
} else {
  console.log("All plugins validated successfully.");
  process.exit(0);
}
