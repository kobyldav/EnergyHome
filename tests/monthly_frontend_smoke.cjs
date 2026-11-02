// Dependency-free integration smoke for the month-first overlay.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "templates", "index.html"), "utf8");
assert(html.includes('id="dashboardMonthPicker"'), "Global month selector must exist");
assert(html.includes('/static/monthly.js'), "Month-first code must load after app.js");
assert(html.includes('/static/insights.js'), "Insights module must be loaded before monthly charts");
assert(!html.includes('id="heatCostDetails"'), "Detailed heat pricing paragraph was requested removed");
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
$("#insightRange").value = "12";
$("#heatRoomFilter").value = "all";
$("#applianceFocus").value = "all";
$("#financeChartMode").value = "energy";
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
  meter_readings: [],
  appliances: [
    {id:"fridge",name:"Lednička",kind:"passive",electricity_kwh_per_day:0.7},
    {id:"washer",name:"Pračka",kind:"active",electricity_kwh_per_cycle:1}
  ],
  cycles:[{appliance_id:"washer",month:"2026-10",cycles:5}],
  tariffs: [], advances: [],
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
  else if (url.startsWith("/api/insights?month=")) {
    const month=decodeURIComponent(url.split("=")[1]);
    const indexes=Array.from({length:12},(_,i)=>{
      const idx=Number(month.slice(0,4))*12+Number(month.slice(5))-12+i;
      return String(Math.floor(idx/12)).padStart(4,'0')+'-'+String(idx%12+1).padStart(2,'0');
    });
    body={
      selected_month:month,
      finance_months:Array.from({length:5},(_,i)=>{
        const idx=Number(month.slice(0,4))*12+Number(month.slice(5))-1+(i-2);
        const m=String(Math.floor(idx/12)).padStart(4,'0')+'-'+String(idx%12+1).padStart(2,'0');
        return {month:m,available:i!==0&&i!==4,
          total_cost:300+i*10,advance:430+i*10,balance:130,
          utility_costs:{electricity:150+i*10,cold_water:20,hot_water:30,gas:40,heat:60},
          partial:i===3};
      }),
      months:indexes.map((m,i)=>({
        month:m,electricity_kwh:i>=10?i*10:null,
        heat_units:i>=10?i*2:null,
        electricity_status:i>=10?'partial':'missing',
        heat_status:i>=10?'partial':'missing',
        electricity_covered_days:i>=10?10:0,
        heat_devices:[{id:'heat',room:'Kuchyně',name:'Radiátor',amount:i>=10?i*2:0,has_data:i>=10}],
        appliances:[
          {id:'fridge',name:'Lednička',kind:'passive',daily_kwh:0.7,estimated_kwh:i>=10?7:0,cycles:null},
          {id:'washer',name:'Pračka',kind:'active',daily_kwh:0.16,estimated_kwh:i>=10?1.6:0,cycles:i===11?5:null}
        ],
        passive_kwh:i>=10?7:0,active_kwh:i>=10?1.6:0,
        unassigned_kwh:i>=10?i*10-8.6:null,model_excess_kwh:0
      }))
    };
  }
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
  fs.readFileSync(path.join(root,"insights.js"),"utf8")+"\n"+
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
  assert($("#usageChart").innerHTML.includes(" L "),"Daily electricity chart must use connected lines");
  assert($("#usageChart").innerHTML.includes("stroke-dasharray"),"Appliance model lines must be visibly distinct");
  assert($("#usageChartNote").textContent.includes("Lednička"),"Daily model should name the fridge");
  assert($("#usageChartNote").textContent.includes("Pračka"),"Daily model should name the washer");
  assert($("#applianceChart").innerHTML.includes("path"),"Twelve-month appliance breakdown must be drawn");
  assert($("#applianceChartNote").textContent.includes("12 měsíců"),"History chart labels window");
  assert($("#balanceTrendChart").innerHTML.includes("09/26"),"Balance must include September neighbor");
  assert($("#balanceTrendChart").innerHTML.includes("11/26"),"Balance must include November neighbor");
  assert($("#cashflowChart").innerHTML.includes("Elektřina"),"Finance chart has energy legend");
  assert($("#cashflowChart").innerHTML.includes("Předepsané zálohy"),"Finance chart includes advances");
  assert($("#cashflowChart").innerHTML.includes("svg-grid-line"),"Finance chart draws multiple months");
  const financeSwitch=listeners.find(x=>x.name==="#financeChartMode"&&x.type==="change");
  assert(financeSwitch,"Finance selector must be interactive");
  $("#financeChartMode").value="total";
  financeSwitch.callback();
  assert($("#cashflowChart").innerHTML.includes("Náklady celkem"),"Total mode must display costs");
  assert(!$("#cashflowChart").innerHTML.includes("Studená voda"),"Total mode hides per-energy traces");
  $("#financeChartMode").value="energy";
  financeSwitch.callback();
  assert($("#heatingTrendNote").textContent.includes("12 měsíců"),
    "Heat history panel must show timeframe");
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
  assert(!$("#actualCost").textContent.includes("orientační náklady"),"Removed heat detail must not reappear");
  assert(calls>=5,"Month, history and application data should be requested");
  $("#applianceFocus").value="fridge";
  listeners.find(x=>x.name==="#applianceFocus"&&x.type==="change").callback();
  assert($("#applianceChartNote").textContent.includes("Lednička"),"Individual appliance selection works");
  $("#heatRoomFilter").value="Kuchyně";
  listeners.find(x=>x.name==="#heatRoomFilter"&&x.type==="change").callback();
  assert($("#heatingTrendNote").textContent.includes("Kuchyně"),"Room filter works");
  $("#insightRange").value="6";
  listeners.find(x=>x.name==="#insightRange"&&x.type==="change").callback();
  assert($("#applianceChartNote").textContent.includes("6 měsíců"),"Historical period filter works");
  console.log("Month-first frontend integration smoke passed");
})().catch(err=>{console.error(err);process.exitCode=1});
