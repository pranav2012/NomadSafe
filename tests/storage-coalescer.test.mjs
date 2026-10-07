import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

function loadModule(entryPoint) {
  const output = buildSync({
    entryPoints: [entryPoint],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    write: false,
  }).outputFiles[0].text;
  const module = { exports: {} };
  new Function("exports", "module", output)(module.exports, module);
  return module.exports;
}

const { createWriteCoalescer } = loadModule("src/modules/storage/writeCoalescer.ts");

function setup(defer = true) {
  const data = new Map();
  const writes = [];
  const timers = [];
  const backend = {
    get: (name) => data.get(name),
    set: (name, value) => {
      writes.push(name);
      data.set(name, value);
    },
    remove: (name) => data.delete(name),
  };
  const coalescer = createWriteCoalescer(backend, {
    delayMs: 300,
    shouldDefer: () => defer,
    schedule: (run) => {
      const timer = { run, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancel: (timer) => {
      timer.cancelled = true;
    },
  });
  const tick = () => timers.filter((timer) => !timer.cancelled).splice(0).forEach((timer) => ((timer.cancelled = true), timer.run()));
  return { data, writes, timers, coalescer, tick };
}

test("a burst of writes to one key becomes one write of the latest value", () => {
  const { data, writes, coalescer, tick } = setup();
  coalescer.setItem("a", "1");
  coalescer.setItem("a", "2");
  coalescer.setItem("a", "3");
  assert.equal(writes.length, 0);
  assert.equal(coalescer.getItem("a"), "3");
  tick();
  assert.deepEqual(writes, ["a"]);
  assert.equal(data.get("a"), "3");
});

test("reads fall back to the backend and see pending empty strings", () => {
  const { data, coalescer } = setup();
  data.set("b", "stored");
  assert.equal(coalescer.getItem("b"), "stored");
  assert.equal(coalescer.getItem("missing"), null);
  coalescer.setItem("b", "");
  assert.equal(coalescer.getItem("b"), "");
});

test("flush writes everything pending and cancels the timer", () => {
  const { data, timers, coalescer, tick } = setup();
  coalescer.setItem("a", "1");
  coalescer.setItem("b", "2");
  assert.equal(timers.length, 1);
  coalescer.flush();
  assert.equal(data.get("a"), "1");
  assert.equal(data.get("b"), "2");
  assert.equal(timers[0].cancelled, true);
  assert.equal(coalescer.hasPending(), false);
  tick();
});

test("remove drops a pending write and removes the stored value", () => {
  const { data, coalescer, tick } = setup();
  data.set("a", "old");
  coalescer.setItem("a", "new");
  coalescer.removeItem("a");
  assert.equal(coalescer.getItem("a"), null);
  tick();
  assert.equal(data.has("a"), false);
});

test("discard drops pending writes", () => {
  const { data, coalescer, tick } = setup();
  coalescer.setItem("a", "1");
  coalescer.discard();
  tick();
  assert.equal(data.has("a"), false);
});

test("writes go straight through when not deferring", () => {
  const { data, timers, coalescer } = setup(false);
  coalescer.setItem("a", "1");
  assert.equal(data.get("a"), "1");
  assert.equal(timers.length, 0);
});
