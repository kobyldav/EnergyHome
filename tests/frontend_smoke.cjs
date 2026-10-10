// Minimal dependency-free browser bootstrap smoke test.
// It specifically detects DOM API misuse that "node --check" cannot catch,
// such as calling Array.prototype.forEach on querySelector()'s single element.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const listeners = [];
function element(name = "element") {
  return {
    name,
    dataset: { financeRange: name, analyticsRange: name, tab: name },
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    elements: { month: { value: "", addEventListener() {} }, repo: { value: "" }, token: { value: "" } },
    addEventListener(type, handler) { listeners.push({ name, type, handler }); },
    removeEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    innerHTML: "",
    textContent: "",
    value: "",
    disabled: false,
  };
}
const elements = new Map();
const financeButtons = ["billing", "month", "custom"].map(element);
const graphButtons = ["billing", "12m"].map(element);
const dom = {
  visibilityState: "hidden",
  querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, element(selector));
    return elements.get(selector);
  },
  querySelectorAll(selector) {
    if (selector === "[data-finance-range]") return financeButtons;
    if (selector === "[data-analytics-range]") return graphButtons;
    return [];
  },
  addEventListener() {},
};
const fetchCalls = [];
const sampleData = {
  settings: {},
  meters: [{ id: "meter-1", name: "Smoke test meter", utility: "electricity",
             unit: "kWh", base_value: 0, base_date: "2026-10-01" }],
  meter_readings: [], appliances: [], cycles: [], tariffs: [], advances: [],
  heat_allocators: [], heat_allocator_readings: [], sensors: [], sensor_readings: []
};
const exampleResponse = {
  data: sampleData,
  dashboard: {
    months: [], latest: null, billing: {}, heat_allocators: {devices:[],rooms:[]},
    settings: {}, contract_review: {}, finance_notes: {}
  }
};
const sandbox = {
  document: dom,
  window: { addEventListener() {}, setInterval() {}, scrollTo() {} },
  fetch: async url => {
    fetchCalls.push(url);
    return { ok: true, json: async () => url === "/api/state" ? exampleResponse : {} };
  },
  Intl, Date, Math, JSON, Number, Object, String, Array, Map, Set,
  setTimeout() {}, clearTimeout() {}, console,
  confirm: () => false,
};
const source = fs.readFileSync(path.join(__dirname, "..", "static", "app.js"), "utf8");
vm.runInNewContext(source, sandbox, { filename: "static/app.js", timeout: 2000 });
for (const name of ["billing", "month", "custom"]) {
  assert(listeners.some(listener => listener.name === name && listener.type === "click"),
    "Finance period button " + name + " is not connected");
}
for (const name of ["12m"]) {
  assert(listeners.some(listener => listener.name === name && listener.type === "click"),
    "Graph range button " + name + " is not connected");
}
setImmediate(() => {
  try {
    assert(fetchCalls.includes("/api/state"), "Application did not begin loading persisted data");
    assert(elements.get("#meterList")?.innerHTML.includes("Smoke test meter"),
      "Persisted meter records were not rendered in the UI");
    assert.equal(elements.get("#saveState")?.textContent, "Připraveno",
      "Dashboard rendering did not finish successfully");
    console.log("Frontend initialization and persisted-data rendering smoke test passed.");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
});
