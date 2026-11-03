import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, chmodSync, statSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const generator = "scripts/generate-pstack-harness-trees.mjs";
const validator = "scripts/validate-plugins.mjs";
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "pstack-harness-"));
  cpSync(root, dir, { recursive: true, filter: (path) => ![".git", "node_modules", ".audit"].includes(relative(root, path).split("/")[0]) });
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "dir");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function run(dir, script, ...args) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8" });
  assert.ifError(result.error);
  return { status: result.status, output: result.stdout + result.stderr };
}
function good(result) { assert.equal(result.status, 0, result.output); }
function bad(result, message) { assert.notEqual(result.status, 0, result.output); assert.match(result.output, message); }
function snapshot(dir) {
  const tree = join(dir, "harness/pstack");
  return walk(tree).map((path) => [relative(tree, path), readFileSync(path).toString("base64"), statSync(path).mode & 0o111]);
}
function json(dir, path, edit) {
  const full = join(dir, path);
  const value = JSON.parse(readFileSync(full, "utf8"));
  edit(value);
  writeFileSync(full, JSON.stringify(value));
}

test("write regenerates both targets deterministically with source bytes and modes", (t) => {
  const dir = fixture(t);
  good(run(dir, generator));
  const first = snapshot(dir);
  good(run(dir, generator));
  assert.deepEqual(snapshot(dir), first);
  good(run(dir, generator, "--check"));
  const canonical = JSON.parse(readFileSync(join(dir, "pstack/plugin.json")));
  for (const target of ["claude-code", "codex"]) {
    const base = join(dir, "harness/pstack", target);
    assert.deepEqual(readFileSync(join(base, "LICENSE")), readFileSync(join(dir, "pstack/LICENSE")));
    const manifest = JSON.parse(readFileSync(join(base, "plugin.json")));
    assert.equal(manifest.version, canonical.version);
    assert.deepEqual(manifest.author, canonical.author);
    const skill = readFileSync(join(base, "skills/poteto-mode/SKILL.md"), "utf8");
    assert.match(skill, new RegExp(`docs/harness/${target}\\.md`));
    const script = "skills/statechart/scripts/statechart";
    assert.deepEqual(readFileSync(join(base, script)), readFileSync(join(dir, "pstack", script)));
    assert.equal(statSync(join(base, script)).mode & 0o111, statSync(join(dir, "pstack", script)).mode & 0o111);
  }
  for (const name of ["deslop", "control-cli", "control-ui"]) {
    const source = join(dir, "cursor-team-kit/skills", name);
    for (const path of walk(source)) {
      const bundled = join(dir, "harness/pstack/codex/skills", name, relative(source, path));
      assert.deepEqual(readFileSync(bundled), readFileSync(path));
      assert.equal(statSync(bundled).mode & 0o111, statSync(path).mode & 0o111);
    }
    assert.equal(readdirSync(join(dir, "harness/pstack/claude-code/skills")).includes(name), false);
  }
  assert.deepEqual(readFileSync(join(dir, "harness/pstack/codex/docs/dependencies/cursor-team-kit-LICENSE")), readFileSync(join(dir, "cursor-team-kit/LICENSE")));
  good(run(dir, validator));
});

test("check catches bytes, missing/extra files and executable drift in either target without writes", (t) => {
  const dir = fixture(t);
  for (const target of ["claude-code", "codex"]) {
    for (const kind of ["bytes", "missing", "extra", "mode"]) {
      good(run(dir, generator));
      const path = join(dir, "harness/pstack", target, "LICENSE");
      if (kind === "bytes") writeFileSync(path, "drift");
      if (kind === "missing") rmSync(path);
      if (kind === "extra") writeFileSync(join(dirname(path), "unexpected.txt"), "extra");
      if (kind === "mode") chmodSync(path, 0o755);
      const before = snapshot(dir);
      bad(run(dir, generator, "--check"), /out of date/);
      assert.deepEqual(snapshot(dir), before, "--check must not repair drift");
    }
  }
});

test("missing Cursor vocabulary mapping and invalid skill metadata fail before generation", (t) => {
  const dir = fixture(t);
  const adapter = join(dir, "pstack/docs/harness/codex.md");
  writeFileSync(adapter, readFileSync(adapter, "utf8").replaceAll("AskQuestion", "removed-term"));
  bad(run(dir, generator), /Codex adapter has no row for `AskQuestion`/);
  cpSync(join(root, "pstack/docs/harness/codex.md"), adapter);
  const skill = join(dir, "pstack/skills/poteto-mode/SKILL.md");
  writeFileSync(skill, readFileSync(skill, "utf8").replace("name: poteto-mode", "name: wrong"));
  bad(run(dir, generator), /not its folder name/);
});

test("validator rejects Codex catalog, identity, version, hooks and missing skills", (t) => {
  const dir = fixture(t);
  const catalog = ".agents/plugins/marketplace.json";
  const original = readFileSync(join(dir, catalog));
  writeFileSync(join(dir, catalog), "{invalid json");
  bad(run(dir, validator), /Codex marketplace/);
  for (const edit of [
    (value) => { value.name = "cursor-plugins"; },
    (value) => { value.plugins = {}; },
    (value) => { value.plugins[0].source = "./pstack"; },
    (value) => { value.plugins[0].source.path = "../escape"; },
    (value) => { delete value.plugins[0].policy; },
    (value) => { value.plugins[0].category = "wrong"; },
  ]) {
    writeFileSync(join(dir, catalog), original);
    json(dir, catalog, edit);
    bad(run(dir, validator), /Codex marketplace/);
  }
  writeFileSync(join(dir, catalog), original);
  for (const path of ["plugin.json", ".codex-plugin/plugin.json"]) {
    good(run(dir, generator));
    json(dir, `harness/pstack/codex/${path}`, (value) => { value.version = "0.0.0"; });
    bad(run(dir, validator), /version/);
  }
  good(run(dir, generator));
  json(dir, "harness/pstack/codex/plugin.json", (value) => { value.extensions["com.openai"].hooks = "./hooks.json"; });
  bad(run(dir, validator), /without hooks/);
  good(run(dir, generator));
  rmSync(join(dir, "harness/pstack/codex/skills/poteto-mode/SKILL.md"));
  bad(run(dir, validator), /missing skill poteto-mode/);
  for (const name of ["deslop", "control-cli", "control-ui"]) {
    good(run(dir, generator));
    rmSync(join(dir, "harness/pstack/codex/skills", name, "SKILL.md"));
    bad(run(dir, validator), new RegExp(`missing skill ${name}`));
  }
  for (const action of ["remove", "change"]) {
    good(run(dir, generator));
    const license = join(dir, "harness/pstack/codex/docs/dependencies/cursor-team-kit-LICENSE");
    if (action === "remove") rmSync(license);
    else writeFileSync(license, "wrong license");
    bad(run(dir, validator), /cursor-team-kit license/);
  }
  good(run(dir, generator));
  good(run(dir, validator));
});
