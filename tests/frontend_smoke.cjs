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
    household_name: { value: "" },
    billing_start_month: { value: "" },
    currency: { value: "" },
    unassigned_alert_ratio_pct: { value: "" },
    contract_review_interval_months: { value: "" },
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

// Chart regression tests: month-to-date totals, dynamic x-scaling,
// future date exclusion and consistent empty-state behavior.
const october = Array.from({ length: 31 }, (_, index) => {
  const day = index + 1;
  return {
    day,
    date: "2026-10-" + String(day).padStart(2, "0"),
    measured: { electricity: day <= 10 ? (day === 1 ? 0.5 : 2) : (day === 12 ? 50 : 0), heat: 0 },
    readings: { electricity: day === 3 || day === 10 || day === 12 ? 1 : 0, heat: 0 },
    estimated: { electricity: day !== 3 && day !== 10, heat: false },
  };
});
const fixture = { month: "2026-10", days: october };
const cumulative = sandbox.cumulativeMediaPoints(fixture, "electricity", "2026-10-10");
assert.equal(cumulative.rows.length, 10, "X axis must end with the last observed day");
assert.equal(cumulative.lastDay, 10);
assert.equal(cumulative.count, 2, "Future readings must not appear in count");
assert.equal(cumulative.total, 18.5);
assert.equal(cumulative.rows[0].value, 0.5);
assert.equal(cumulative.rows[9].value, 18.5);
for (let i = 1; i < cumulative.rows.length; i++) {
  assert(cumulative.rows[i].value >= cumulative.rows[i - 1].value, "Cumulative usage must not decrease");
}
const futureOnly = sandbox.cumulativeMediaPoints({
  month: "2026-10",
  days: october.map(day => ({
    ...day, measured: { electricity: day.day === 12 ? 40 : 0 },
    readings: { electricity: day.day === 12 ? 1 : 0 }
  }))
}, "electricity", "2026-10-10");
assert.equal(futureOnly.rows.length, 0, "Future-only data must not produce axes");
const withoutReadings = sandbox.cumulativeMediaPoints(fixture, "heat", "2026-10-10");
assert.equal(withoutReadings.rows.length, 0);
const earlierMonth = sandbox.cumulativeMediaPoints({
  month: "2026-09",
  days: [1, 2, 3].map(day => ({
    day, date: "2026-09-0" + day,
    measured: { electricity: 1 }, readings: { electricity: 0 },
    estimated: { electricity: true },
  }))
}, "electricity", "2026-10-10");
assert.equal(earlierMonth.lastDay, 3, "Completed-month allocations may be drawn without readings in that same month");
const repeated = sandbox.cumulativeMediaPoints({
  month: "2026-10",
  days: [
    { day: 1, date: "2026-10-01", measured: { electricity: 0 }, readings: { electricity: 0 } },
    { day: 2, date: "2026-10-02", measured: { electricity: 7 }, readings: { electricity: 2 } },
  ]
}, "electricity", "2026-10-10");
assert.equal(repeated.count, 2);
assert.equal(repeated.total, 7);
assert.equal(repeated.lastDay, 2);

// Force a deterministic "today" into the drawing test by limiting this
// fixture's reading dates to the past, with an already-finished month.
const maySeries = { month: "2026-05", days: october.map(row => ({
  ...row, date: "2026-05-" + String(row.day).padStart(2, "0"),
  measured: { electricity: row.day <= 10 ? 2 : 0, heat: 0 },
  readings: { electricity: row.day === 5 || row.day === 10 ? 1 : 0, heat: 0 },
})) };
sandbox.renderDailyMediaSvgChart("electricity", maySeries);
const chartSvg = elements.get("#mediaChart-electricity").innerHTML;
assert(chartSvg.includes("svg-media-line"), "Recorded consumption must draw an increasing line");
assert(chartSvg.includes(">10</text>"), "Last observed day must appear on X axis");
assert(!chartSvg.includes('>31</text>'), "Month-end must not appear when not observed");
assert(chartSvg.includes("CELKEM"), "Y axis must state the cumulative unit");
sandbox.renderDailyMediaSvgChart("heat", maySeries);
const emptySvg = elements.get("#mediaChart-heat").innerHTML;
assert(emptySvg.includes("Zatím není co zobrazit."), "No heat data must show an empty message");
assert(!emptySvg.includes("svg-grid-line"), "No heat data must not show axes or grid");

// Cost ranking shows every utility with a stable row and separate components.
sandbox.drawExpenseTreeChart([{
  month:"2026-10",
  fixed_costs:{electricity:100,heat:200,cold_water:0,hot_water:0,gas:0},
  variable_costs:{electricity:300,heat:600,cold_water:100,hot_water:0,gas:0},
  measured:{electricity:20,heat:30,cold_water:5,hot_water:null,gas:null},
  status:{electricity:"complete",heat:"complete",cold_water:"complete",hot_water:"missing",gas:"missing"}
}],{start:"2026-10",end:"2026-10"});
const expense=elements.get("#expenseTreeChart").innerHTML;
assert(expense.indexOf('data-expense-utility="heat"')<expense.indexOf('data-expense-utility="electricity"'),"Largest expense is first");
assert.equal((expense.match(/data-expense-utility=/g)||[]).length,5,"Even small and unknown utility categories retain a row");
assert(expense.includes("Fixní")&&expense.includes("Proměnlivé")&&expense.includes("Podíl"),"Components and shares visible");
assert(expense.includes("61,5 %"),"Share is calculated against all known expenses");
assert(expense.includes("Teplo · Fixní "+sandbox.money(200)+" · Proměnlivé "+sandbox.money(600)),"Exact component tooltip");
assert(expense.includes("Plyn · Fixní — · Proměnlivé —"),"Missing utility costs are not presented as zero");
sandbox.drawExpenseTreeChart([{month:"2026-11",fixed_costs:{heat:20},variable_costs:{heat:0},
  measured:{heat:12},status:{heat:"partial"},cost_incomplete:true}],{start:"2026-11",end:"2026-11"});
assert(elements.get("#expenseTreeChart").innerHTML.includes("neúplné"),"Unpriced heat is identified as incomplete");

// The settlement waterfall reconciles all categories and crosses zero.
const wfMonths=[{month:"2026-10",utility_costs:{electricity:800,cold_water:100,hot_water:200,gas:0,heat:500},
  fixed_costs:{electricity:100,heat:100},variable_costs:{electricity:700,cold_water:100,hot_water:200,heat:400}}];
sandbox.drawWaterfall({start:"2025-10-01",end:"2025-10-31",paid:1000,actual_cost:1600},wfMonths);
let waterfall=elements.get("#waterfallChart").innerHTML;
for(const key of ["advance","electricity","cold_water","hot_water","gas","heat","balance"])
  assert(waterfall.includes('data-waterfall-step="'+key+'"'),"Waterfall shows "+key);
assert(waterfall.includes("Náklady nad zálohami"),"Negative balance is identified");
assert(waterfall.includes(sandbox.money(-600)),"Deficit value is exact");
assert(waterfall.includes("svg-zero-line")&&!waterfall.includes("NaN"),"Deficit uses valid axis");
assert(!waterfall.includes('data-waterfall-step="other"'),"No invented cost categories");
sandbox.drawWaterfall({start:"2025-10-01",end:"2025-10-31",paid:2000,actual_cost:1600},wfMonths);
waterfall=elements.get("#waterfallChart").innerHTML;
assert(waterfall.includes("Přebytek záloh")&&waterfall.includes("+"+sandbox.money(400)),"Positive result");
sandbox.drawWaterfall({start:"2025-10-01",end:"2025-10-31",paid:2000,actual_cost:1600,cost_incomplete:true},
  [{...wfMonths[0],cost_incomplete:true}]);
waterfall=elements.get("#waterfallChart").innerHTML;
assert(waterfall.includes("Neúplný rozdíl")&&!waterfall.includes("Přebytek záloh"),"Unpriced heat never looks like final surplus");
sandbox.drawWaterfall({start:"2025-10-01",end:"2025-10-31",paid:0,actual_cost:50},[]);
assert(elements.get("#waterfallChart").innerHTML.includes('data-waterfall-step="other"'),"Missing legacy breakdown reconciles to total");

setImmediate(() => {
  try {
    assert(fetchCalls.includes("/api/state"), "Application did not begin loading persisted data");
    assert(elements.get("#meterList")?.innerHTML.includes("Smoke test meter"),
      "Persisted meter records were not rendered in the UI");
    assert.equal(elements.get("#saveState")?.textContent, "Připraveno",
      "Dashboard rendering did not finish successfully. Error: "+
      (elements.get("#toast")?.textContent || "no toast"));
    console.log("Frontend initialization and persisted-data rendering smoke test passed.");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
});
