// Dependency-free integration smoke for the month-first overlay.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "templates", "index.html"), "utf8");
assert(html.includes('id="dashboardMonthPicker"'), "Global month selector must exist");
assert(html.includes('/static/monthly.js'), "Month-first code must load after app.js");
assert(!html.includes("Predikce konce období"), "A forecast must not be presented as actual");

const elements = new Map();
const listeners = [];
function element(name) {
  const obj = {
    name, value: "", textContent: "", innerHTML: "", style: {}, dataset: {},
    classList: { toggle() {}, add() {}, remove() {} }, disabled: false,
    setAttribute() {}, getAttribute() { return null; },
    addEventListener(type, callback) { listeners.push({name, type, callback}); },
    elements: new Proxy({}, {get(target, key) {
      if (!target[key]) target[key] = element(name+"."+String(key));
      return target[key];
    }})
  };
  for (const field of ["household_name", "billing_start_month", "currency",
                       "unassigned_alert_ratio_pct", "contract_review_interval_months"])
    obj[field] = {value:""};
  return obj;
}
const $ = name => {
  if (!elements.has(name)) elements.set(name, element(name));
  return elements.get(name);
};
$("#dashboardMonthPicker").value = "2026-10";
const document = {
  visibilityState: "hidden", querySelector: $,
  querySelectorAll(selector) {
    return selector === 'input[type="month"]' ? [$("#dashboardMonthPicker")] : [];
  },
  addEventListener() {}
};
const sampleData = {
  settings: {}, meters: [{id:"meter", name:"Electric", utility:"electricity",
                          base_value:0, base_date:"2026-09-30"}],
  meter_readings: [], appliances: [], cycles: [], tariffs: [], advances: [],
  heat_allocators: [], heat_allocator_readings: [], sensors: [], sensor_readings: []
};
const dashboard = {
  months: [], latest: {month:"2026-10"}, billing:{},
  heat_allocators:{devices:[],rooms:[]}, settings:{}, contract_review:{},
  finance_notes:{}
};
const utilities = ["electricity","cold_water","hot_water","gas","heat"];
let calls = 0;
async function fetch(url) {
  calls++;
  let body;
  if (url === "/api/state") body = {data:sampleData,dashboard};
  else if (url.startsWith("/api/month-actual?month=")) {
    const month = decodeURIComponent(url.split("=")[1]);
    body = {
      month, start:month+"-01",end:month+"-31",as_of:month+"-31",
      status:Object.fromEntries(utilities.map(u=>[u,u==="electricity"?"complete":"missing"])),
      measured:{electricity:100,cold_water:null,hot_water:null,gas:null,heat:null},
      coverage:{electricity:[{to:month+"-31"}]},
      fixed_costs:Object.fromEntries(utilities.map(u=>[u,u==="electricity"?5:0])),
      variable_costs:Object.fromEntries(utilities.map(u=>[u,u==="electricity"?200:0])),
      utility_costs:Object.fromEntries(utilities.map(u=>[u,u==="electricity"?205:0])),
      total_cost:205,advance:250,balance:45,
      cost_incomplete:month==='2026-09',
      heat_cost_estimate:{
        mode:month==='2026-10'?'allocator_unit_estimate':'missing_allocator_rate',
        quantity:5,rate:month==='2026-10'?5:0,
        variable_cost:month==='2026-10'?25:0,
        fixed_cost:10,total_cost:month==='2026-10'?35:10
      },
      days:Array.from({length:10},(_,i)=>({
        day:i+1,date:month+'-'+String(i+1).padStart(2,'0'),
        measured:{electricity:10,cold_water:0,hot_water:0,gas:0,heat:0},
        readings:{electricity:i===9?1:0},
        has_allocation:{electricity:true},
      })),
      monthly_devices:[{utility:'electricity',id:'meter',name:'Electric',amount:100,has_data:true}],
      events:Object.fromEntries(utilities.map(u=>[u,u==="electricity"
        ? [{name:"Electric",from:"2026-09-30",date:month+"-31",amount:100}] : []])),
    };
  } else body={configured:false,conflicts:[]};
  return {ok:true,json:async()=>body};
}
const context = {
  document, fetch, window:{addEventListener(){},setInterval(){},scrollTo(){}},
  setTimeout() {}, clearTimeout() {}, confirm(){return false;},
  Intl, Date, Math, JSON, Number, Object, String, Array, Map, Set, console
};
const root = path.join(__dirname,"..","static");
vm.runInNewContext(
  fs.readFileSync(path.join(root,"app.js"),"utf8")+"\n"+
  fs.readFileSync(path.join(root,"monthly.js"),"utf8"),
  context, {filename:"EnergyHome frontend",timeout:2500}
);
async function flush() {
  for(let i=0;i<12;i++) await new Promise(resolve=>setImmediate(resolve));
}
(async()=>{
  await flush();
  assert.equal($("#kpiElectricity").textContent,"100 kWh");
  assert.equal($("#kpiColdWater").textContent,"—");
  assert($("#actualCost").textContent.includes("205"),"Confirmed costs should be visible");
  assert($("#billingPeriod").textContent.includes("2026"),"Financial card shares month");
  assert($("#heatCostDetails").innerHTML.includes("orientační náklady"),"Configured radiator unit price has visible breakdown");
  assert($("#heatCostDetails").innerHTML.includes("spotřební část"),"Variable heat cost must appear in finance");
  assert($("#mediaChart-electricity").innerHTML.includes(" L "),"Cumulative interpolated line must connect daily points");
  assert(!$("#mediaChart-electricity").innerHTML.includes(" H "),"Chart must not use staircase H commands");
  assert(!$("#mediaChart-gas").innerHTML.includes("svg-grid-line"),"Missing readings have no axes");
  const handler=listeners.find(x=>x.name==="#dashboardMonthPicker"&&x.type==="change");
  assert(handler,"Period control must update dashboard");
  $("#dashboardMonthPicker").value="2026-09";
  handler.callback();
  await flush();
  assert($("#billingPeriod").textContent.includes("Září 2026"),"All panels update together");
  assert.equal($("#currentBalance").textContent,"Neúplné","Missing heat rate must not show complete balance");
  assert($("#heatCostDetails").innerHTML.includes("chybí cena dílku"),"Missing rate explained");
  assert(calls>=3,"Month and application data should be requested");
  console.log("Month-first frontend integration smoke passed");
})().catch(err=>{console.error(err);process.exitCode=1});
