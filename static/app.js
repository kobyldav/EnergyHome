const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let STATE = null;
let SVG_ANALYTICS_RANGE = 'billing';
const nf = new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:3});
const moneyFmt = new Intl.NumberFormat('cs-CZ',{style:'currency',currency:'CZK',maximumFractionDigits:0});
const utilityLabel = {electricity:'Elektřina',cold_water:'Studená voda',hot_water:'Teplá voda',gas:'Plyn',heat:'Teplo'};
const utilitySvgMeta = {
  electricity:{unit:'kWh',color:'#277f72',soft:'#d9ebe7'},
  cold_water:{unit:'m³',color:'#4d8fa8',soft:'#dcecf2'},
  hot_water:{unit:'m³',color:'#b76b59',soft:'#f1e0dc'},
  gas:{unit:'m³',color:'#aa874a',soft:'#efe6d4'},
  heat:{unit:'jedn.',color:'#806b5a',soft:'#e8e1dc'}
};
function tr(text){ return window.t ? window.t(text) : text; }

function money(v){ return moneyFmt.format(Number(v||0)); }
function escapeHtml(s=''){ return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c])); }
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2600); }
function saveState(text='Ukládám…'){ $('#saveState').textContent=text; }
function formatDateTime(v){ if(!v)return '—'; return String(v).replace('T',' '); }

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(url,options={}){
  options.headers={...(options.headers||{}),'Content-Type':'application/json'};
  let lastError;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const res=await fetch(url,{...options,cache:'no-store'});
      const body=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(body.error||`Chyba ${res.status}`);
      return body;
    }catch(err){
      lastError=err;
      if(attempt<2) await sleep(350+attempt*650);
    }
  }
  throw lastError;
}
async function reloadState(){ saveState('Načítám…'); STATE=await api('/api/state'); renderAll(); saveState('Připraveno'); }

const titles={dashboard:'Dashboard',readings:'Měřidla a odečty',appliances:'Spotřebiče',heating:'Topení a radiátory',tariffs:'Ceníky',advances:'Zálohy',settings:'Nastavení'};
function openTab(name){
  $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  $$('.tab-panel').forEach(p=>p.classList.toggle('active',p.id===`tab-${name}`));
  $('#pageTitle').textContent=titles[name]||name;
  window.scrollTo({top:0,behavior:'smooth'});
}
$$('.nav-btn').forEach(b=>b.addEventListener('click',()=>openTab(b.dataset.tab)));

const monthsCz=['Leden','Únor','Březen','Duben','Květen','Červen','Červenec','Srpen','Září','Říjen','Listopad','Prosinec'];
$('#billingStartMonth').innerHTML=monthsCz.map((m,i)=>`<option value="${i+1}">${m}</option>`).join('');
$('#applianceKind').addEventListener('change',renderKindFields);
$('#cycleForm').elements.month.addEventListener('change',renderCycleFields);
function renderKindFields(){ const passive=$('#applianceKind').value==='passive'; $('#activeFields').classList.toggle('hidden',passive); $('#passiveFields').classList.toggle('hidden',!passive); }

function setDateDefaults(){
  const now=new Date(); const local=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString();
  $$('input[type="date"]').forEach(i=>{ if(!i.value) i.value=local.slice(0,10); });
  $$('input[type="month"]').forEach(i=>{ if(!i.value) i.value=local.slice(0,7); });
}

function renderAll(){
  renderDashboard(); renderMeters(); renderMeterReadings(); renderAppliances(); renderCycleFields();
  renderHeatAllocators(); renderHeatAllocatorReadings(); renderHeatRoomSummary();
  renderTariffs(); renderAdvances(); renderSettings(); renderSelects(); setDateDefaults();
}

function renderDashboard(){
  const d=STATE.dashboard, m=d.latest;
  $('#emptyHint').classList.toggle('hidden',!!m);
  if(!m) $('#emptyHint').innerHTML='<strong>Začněte přidáním měřidla.</strong> Nastavte jeho skutečný počáteční stav a potom zadávejte jednotlivé odečty.';
  const hasMeter=u=>(STATE.data.meters||[]).some(x=>x.utility===u);
  $('#kpiElectricity').textContent=m&&hasMeter('electricity')?`${nf.format(m.measured.electricity)} kWh`:'—';
  $('#kpiColdWater').textContent=m&&hasMeter('cold_water')?`${nf.format(m.measured.cold_water)} m³`:'—';
  $('#kpiHotWater').textContent=m&&hasMeter('hot_water')?`${nf.format(m.measured.hot_water)} m³`:'—';
  $('#kpiGas').textContent=m&&hasMeter('gas')?`${nf.format(m.measured.gas)} m³`:'—';
  const hasHeat=(STATE.data.heat_allocators||[]).length>0||hasMeter('heat');
  $('#kpiHeat').textContent=m&&hasHeat?`${nf.format(m.measured.heat)} jedn.`:'—';
  $('#kpiCost').textContent=m?money(m.total_cost):'—'; $('#kpiMonth').textContent=m?m.month:'bez dat';
  const b=d.billing; $('#billingPeriod').textContent=b.start?`${b.start} → ${b.end}`:'—';
  $('#currentBalance').textContent=b.start?money(b.current_balance):'—'; $('#projectedBalance').textContent=b.start?money(b.projected_balance):'—';
  $('#paidTotal').textContent=b.start?money(b.paid):'—'; $('#actualCost').textContent=b.start?money(b.actual_cost):'—';
  const balance=Number(b.projected_balance||0), max=Math.max(1000,Math.abs(balance)*1.2), pct=Math.min(50,Math.abs(balance)/max*50);
  const fill=$('#thermoFill'); fill.style.width=`${pct}%`; fill.style.left=balance>=0?'50%':`${50-pct}%`; fill.style.background=balance>=0?'#1f8a5b':'#c94b4b';
  const alerts=[...(m?.alerts||[])];
  if(d.contract_review?.due) alerts.push({
    severity:'warning',
    text:`Od poslední kontroly/ceníku uplynulo alespoň ${d.contract_review.interval_months} měsíců. Zvažte porovnání smluv a aktuálních nabídek dodavatelů.`,
    action:'contract-review'
  });
  if(d.finance_notes?.heat_advance_without_cost) alerts.push({severity:'info',text:'Je evidovaná záloha na teplo, ale chybí cena tepla. Celková spotřeba tepla se nyní provizorně definuje jako součet přepočtených přírůstků všech radiátorových měřičů.'});
  if(d.finance_notes?.heat_definition_provisional) alerts.push({severity:'info',text:'Teplo je nyní provizorně počítáno jako součet všech radiátorových měřičů. Výsledná jednotka není ověřená GJ; později lze přidat přesný převod.'});
  $('#alerts').innerHTML=alerts.length?alerts.map(a=>`<div class="alert ${a.severity}"><span>${escapeHtml(a.text)}</span>${a.action==='contract-review'?'<button class="btn secondary small alert-action" onclick="markContractReviewed()">Označit jako zkontrolováno</button>':''}</div>`).join(''):'<div class="alert ok">Žádná mimořádná odchylka v posledním období.</div>';
  renderHeatAllocatorDashboard(d.heat_allocators||{});
  drawCostChart(d.months||[]);
  drawUsageChart(d.months||[]);
  drawApplianceChart(m);
  drawCashflowChart(d.months||[]);
  drawBalanceTrendChart(d.months||[]);
  drawHeatingTrendChart(d.months||[]);
  drawExpenseTreeChart(d.months||[],b);
  drawWaterfall(b);
  renderSvgAnalytics(d.months||[],b);
}

function renderHeatAllocatorDashboard(summary){
  const box=$('#heatAllocatorDashboard');
  const devices=summary.devices||[], rooms=summary.rooms||[];
  if(!devices.length){
    box.innerHTML='<p class="help heat-empty">Zatím nejsou přidané měřiče na radiátorech. Přidejte každý radiátor samostatně a zadávejte jeho kumulovaný stav.</p>';
    return;
  }
  const roomRows=rooms.map(r=>`<tr><td><b>${escapeHtml(r.room)}</b></td><td>${r.devices}</td><td>${nf.format(r.latest_adjusted_usage)} jednotek</td><td>${nf.format(r.total_adjusted_usage)} jednotek</td></tr>`).join('');
  const deviceRows=devices.map(d=>{
    const li=d.latest_interval, latest=d.latest;
    const delta=li&&li.valid?nf.format(li.adjusted_usage):'—';
    const period=li?`${li.from_date||'začátek'} → ${li.to_date}`:'bez odečtu';
    return `<tr><td>${escapeHtml(d.room||'Bez místnosti')}</td><td><b>${escapeHtml(d.name)}</b><small class="table-sub">${escapeHtml(d.serial_number||'bez čísla')}</small></td><td>${latest?`${nf.format(latest.value)} ${escapeHtml(d.unit||'jednotek')}`:'—'}</td><td><b>${delta}</b><small class="table-sub">${escapeHtml(period)}</small></td><td>${nf.format(d.total_adjusted_usage)} ${escapeHtml(d.unit||'jednotek')}</td></tr>`;
  }).join('');
  box.innerHTML=`<div class="heat-summary-strip"><div><span>Radiátory</span><strong>${devices.length}</strong></div><div><span>Místnosti</span><strong>${rooms.length}</strong></div><div><span>Součet posledních přírůstků</span><strong>${nf.format(summary.latest_adjusted_usage||0)} jednotek</strong></div><div><span>Celkem od založení</span><strong>${nf.format(summary.total_adjusted_usage||0)} jednotek</strong></div></div><div class="heat-dashboard-columns"><div><h3>Podle místností</h3><div class="table-wrap dashboard-table"><table><thead><tr><th>Místnost</th><th>Radiátory</th><th>Poslední přírůstek</th><th>Celkem</th></tr></thead><tbody>${roomRows}</tbody></table></div></div><div><h3>Jednotlivé radiátory</h3><div class="table-wrap dashboard-table"><table><thead><tr><th>Místnost</th><th>Měřič</th><th>Stav</th><th>Od minule</th><th>Celkem</th></tr></thead><tbody>${deviceRows}</tbody></table></div></div></div>`;
}

function renderMeters(){
  const list=STATE.data.meters||[];
  $('#meterList').innerHTML=list.map(m=>`<div class="item"><div><h3>${escapeHtml(m.name)}</h3><p>${utilityLabel[m.utility]} · počáteční stav ${nf.format(m.base_value)} ${m.unit} k ${m.base_date}</p></div><div class="item-actions"><button class="btn secondary small" onclick="editMeter('${m.id}')">Upravit</button><button class="btn danger small" onclick="deleteMeter('${m.id}')">Smazat</button></div></div>`).join('')||'<p class="help">Zatím žádná měřidla.</p>';
}
function renderMeterReadings(){
  const meters=Object.fromEntries((STATE.data.meters||[]).map(m=>[m.id,m]));
  const rows=[...(STATE.data.meter_readings||[])].sort((a,b)=>b.date.localeCompare(a.date));
  $('#meterReadingsTable').innerHTML=rows.map(r=>{const m=meters[r.meter_id]; return `<tr><td>${r.date}</td><td><b>${escapeHtml(m?.name||'Neznámé')}</b></td><td>${nf.format(r.value)} ${m?.unit||''}</td><td><button class="btn danger small" onclick="deleteMeterReading('${r.id}')">Smazat</button></td></tr>`}).join('')||'<tr><td colspan="4">Zatím žádné odečty.</td></tr>';
}
function renderSelects(){
  const meterOpts=(STATE.data.meters||[]).map(m=>`<option value="${m.id}">${escapeHtml(m.name)} · ${utilityLabel[m.utility]}</option>`).join('');
  $('#readingMeter').innerHTML=meterOpts||'<option value="">Nejdřív přidejte měřidlo</option>';
  const heatOpts=(STATE.data.heat_allocators||[]).map(h=>`<option value="${h.id}">${escapeHtml(h.room||'Bez místnosti')} · ${escapeHtml(h.name)}</option>`).join('');
  $('#heatAllocatorReadingSelect').innerHTML=heatOpts||'<option value="">Nejdřív přidejte topný měřič</option>';
}

function renderAppliances(){
  const list=STATE.data.appliances||[];
  $('#applianceList').innerHTML=list.map(a=>{ const desc=a.kind==='passive'?`trvale · ${nf.format(a.electricity_kwh_per_day||0)} kWh/den · SV ${nf.format(a.cold_water_l_per_day||0)} l/den · TV ${nf.format(a.hot_water_l_per_day||0)} l/den`:`cyklicky · ${nf.format(a.electricity_kwh_per_cycle||0)} kWh/cyklus · SV ${nf.format(a.cold_water_l_per_cycle||0)} l · TV ${nf.format(a.hot_water_l_per_cycle||0)} l`; return `<div class="item"><div><h3>${escapeHtml(a.name)}</h3><p>${desc}</p></div><div class="item-actions"><button class="btn secondary small" onclick="editAppliance('${a.id}')">Upravit</button><button class="btn danger small" onclick="deleteAppliance('${a.id}')">Smazat</button></div></div>`}).join('')||'<p class="help">Zatím žádné profily.</p>';
}
function renderCycleFields(){
  const active=(STATE?.data.appliances||[]).filter(a=>a.kind==='active');
  const month=$('#cycleForm').elements.month.value;
  const cmap=new Map((STATE?.data.cycles||[]).filter(c=>c.month===month).map(c=>[c.appliance_id,c.cycles]));
  $('#cycleFields').innerHTML=active.length?active.map(a=>`<label class="cycle-grid"><span>${escapeHtml(a.name)}</span><input type="number" min="0" step="1" data-cycle-id="${a.id}" value="${cmap.get(a.id)||0}"></label>`).join(''):'<p class="help">Nejdřív přidejte aktivní spotřebiče, například pračku nebo myčku.</p>';
}

function heatSummaryDeviceMap(){ return new Map((STATE.dashboard.heat_allocators?.devices||[]).map(d=>[d.id,d])); }
function renderHeatAllocators(){
  const summary=heatSummaryDeviceMap();
  const list=STATE.data.heat_allocators||[];
  $('#heatAllocatorList').innerHTML=list.map(h=>{const s=summary.get(h.id), total=s?.total_adjusted_usage||0; return `<div class="item"><div><h3>${escapeHtml(h.room||'Bez místnosti')} · ${escapeHtml(h.name)}</h3><p>počáteční stav ${nf.format(h.base_value)} ${escapeHtml(h.unit||'jednotek')} k ${h.base_date} · koeficient ${nf.format(h.coefficient||1)} · celkem ${nf.format(total)} přepočtených jednotek${h.serial_number?` · č. ${escapeHtml(h.serial_number)}`:''}</p></div><div class="item-actions"><button class="btn secondary small" onclick="editHeatAllocator('${h.id}')">Upravit</button><button class="btn danger small" onclick="deleteHeatAllocator('${h.id}')">Smazat</button></div></div>`}).join('')||'<p class="help">Zatím žádné topné měřiče.</p>';
}
function renderHeatAllocatorReadings(){
  const allocators=Object.fromEntries((STATE.data.heat_allocators||[]).map(h=>[h.id,h]));
  const summary=heatSummaryDeviceMap();
  const deltaMap=new Map();
  for(const d of (STATE.dashboard.heat_allocators?.devices||[])) (d.intervals||[]).forEach((iv,i)=>{ const matching=(STATE.data.heat_allocator_readings||[]).filter(r=>r.allocator_id===d.id).sort((a,b)=>a.date.localeCompare(b.date)); if(matching[i]) deltaMap.set(matching[i].id,iv); });
  const rows=[...(STATE.data.heat_allocator_readings||[])].sort((a,b)=>b.date.localeCompare(a.date));
  $('#heatAllocatorReadingsTable').innerHTML=rows.map(r=>{const h=allocators[r.allocator_id], iv=deltaMap.get(r.id); const delta=iv&&iv.valid?`${nf.format(iv.adjusted_usage)} ${escapeHtml(h?.unit||'jednotek')}`:'—'; return `<tr><td>${r.date}${r.reset?' <span class="reset-tag">reset</span>':''}</td><td><b>${escapeHtml(h?.room||'Neznámá místnost')} · ${escapeHtml(h?.name||'Neznámé')}</b></td><td>${nf.format(r.value)} ${escapeHtml(h?.unit||'')}</td><td>${delta}</td><td><button class="btn danger small" onclick="deleteHeatAllocatorReading('${r.id}')">Smazat</button></td></tr>`}).join('')||'<tr><td colspan="5">Zatím žádné odečty topení.</td></tr>';
}
function renderHeatRoomSummary(){
  const rows=STATE.dashboard.heat_allocators?.rooms||[];
  $('#heatRoomSummaryTable').innerHTML=rows.map(r=>`<tr><td><b>${escapeHtml(r.room)}</b></td><td>${r.devices}</td><td>${nf.format(r.latest_adjusted_usage)} jednotek</td><td>${nf.format(r.total_adjusted_usage)} jednotek</td></tr>`).join('')||'<tr><td colspan="4">Zatím nejsou data z radiátorových měřičů.</td></tr>';
}

function renderTariffs(){
  const list=[...(STATE.data.tariffs||[])].sort((a,b)=>b.effective_from.localeCompare(a.effective_from));
  $('#tariffList').innerHTML=list.map(t=>{const fixedTotal=Number(t.electricity_fixed_monthly||0)+Number(t.cold_water_fixed_monthly||0)+Number(t.hot_water_fixed_monthly||0)+Number(t.gas_fixed_monthly||0)+Number(t.heat_fixed_monthly||0);return `<div class="item tariff-item"><div><h3>Platí od ${t.effective_from}</h3><p><b>Jednotkové ceny:</b> elektřina ${nf.format(t.electricity_per_kwh)} Kč/kWh · SV ${nf.format(t.cold_water_per_m3)} Kč/m³ · TV ${nf.format(t.hot_water_per_m3)} Kč/m³ · plyn ${nf.format(t.gas_per_m3)} Kč/m³ · teplo ${nf.format(t.heat_per_gj)} Kč/jedn.</p><p><b>Fixy:</b> elektřina ${money(t.electricity_fixed_monthly)} · SV ${money(t.cold_water_fixed_monthly)} · TV ${money(t.hot_water_fixed_monthly)} · plyn ${money(t.gas_fixed_monthly)} · teplo ${money(t.heat_fixed_monthly)} · celkem <b>${money(fixedTotal)}</b></p></div><div class="item-actions"><button class="btn secondary small" onclick="editTariff('${t.id}')">Upravit</button><button class="btn danger small" onclick="deleteTariff('${t.id}')">Smazat</button></div></div>`}).join('')||'<p class="help">Zatím žádný ceník. Fyzická spotřeba se bude počítat, finanční cena zatím ne.</p>';
}
function renderAdvances(){
  const list=[...(STATE.data.advances||[])].sort((a,b)=>b.effective_from.localeCompare(a.effective_from));
  $('#advanceList').innerHTML=list.map(a=>`<div class="item"><div><h3>Platí od ${a.effective_from}</h3><p>Elektřina ${money(a.electricity_monthly)} · studená voda ${money(a.cold_water_monthly)} · teplá voda ${money(a.hot_water_monthly)} · plyn ${money(a.gas_monthly)} · teplo ${money(a.heat_monthly)} · celkem <b>${money(Number(a.electricity_monthly||0)+Number(a.cold_water_monthly||0)+Number(a.hot_water_monthly||0)+Number(a.gas_monthly||0)+Number(a.heat_monthly||0))}</b></p></div><div class="item-actions"><button class="btn secondary small" onclick="editAdvance('${a.id}')">Upravit</button><button class="btn danger small" onclick="deleteAdvance('${a.id}')">Smazat</button></div></div>`).join('')||'<p class="help">Zatím nejsou zadané žádné zálohy.</p>';
}
function renderSettings(){ const s=STATE.data.settings||{}, f=$('#settingsForm'); f.household_name.value=s.household_name||''; f.billing_start_month.value=s.billing_start_month||1; f.currency.value=s.currency||'CZK'; f.unassigned_alert_ratio_pct.value=Math.round(Number(s.unassigned_alert_ratio||.3)*100); if(f.contract_review_interval_months)f.contract_review_interval_months.value=s.contract_review_interval_months||6; }
async function markContractReviewed(){try{await api('/api/contract-review',{method:'POST',body:JSON.stringify({})});toast('Kontrola smluv označena jako hotová');await reloadState()}catch(err){toast(err.message)}}

$('#meterForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/meters',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))});e.target.reset();e.target.elements.id.value='';saveState();toast('Měřidlo uloženo');await reloadState()}catch(err){toast(err.message)}});
$('#meterReadingForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/meter-readings',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))});const keep=e.target.elements.meter_id.value;e.target.reset();await reloadState();$('#readingMeter').value=keep;setDateDefaults();toast('Odečet uložen')}catch(err){toast(err.message)}});
$('#applianceForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/appliances',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))});e.target.reset();e.target.elements.id.value='';$('#applianceKind').value='active';renderKindFields();toast('Profil uložen');await reloadState()}catch(err){toast(err.message)}});
$('#cycleForm').addEventListener('submit',async e=>{e.preventDefault();try{const month=e.target.elements.month.value;if(!month)throw new Error('Vyberte měsíc.');for(const input of $$('[data-cycle-id]'))await api('/api/cycles',{method:'POST',body:JSON.stringify({month,appliance_id:input.dataset.cycleId,cycles:input.value})});toast('Cykly uloženy');await reloadState()}catch(err){toast(err.message)}});
$('#heatAllocatorForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/heat-allocators',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))});e.target.reset();e.target.elements.id.value='';e.target.elements.unit.value='jednotek';e.target.elements.coefficient.value='1';setDateDefaults();toast('Topný měřič uložen');await reloadState()}catch(err){toast(err.message)}});
$('#heatAllocatorReadingForm').addEventListener('submit',async e=>{e.preventDefault();try{const p=Object.fromEntries(new FormData(e.target).entries());p.reset=e.target.elements.reset.checked;const keep=e.target.elements.allocator_id.value;await api('/api/heat-allocator-readings',{method:'POST',body:JSON.stringify(p)});e.target.reset();await reloadState();$('#heatAllocatorReadingSelect').value=keep;setDateDefaults();toast('Odečet topení uložen')}catch(err){toast(err.message)}});
$('#tariffForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/tariffs',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))});e.target.reset();e.target.elements.id.value='';toast('Ceník uložen');await reloadState()}catch(err){toast(err.message)}});
$('#advanceForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/advances',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))});e.target.reset();e.target.elements.id.value='';toast('Zálohy uloženy');await reloadState()}catch(err){toast(err.message)}});
$('#settingsForm').addEventListener('submit',async e=>{e.preventDefault();try{const p=Object.fromEntries(new FormData(e.target).entries());p.unassigned_alert_ratio=Number(p.unassigned_alert_ratio_pct||30)/100;await api('/api/settings',{method:'POST',body:JSON.stringify(p)});toast('Nastavení uloženo');await reloadState()}catch(err){toast(err.message)}});

async function del(url,msg){if(!confirm(msg))return;try{await api(url,{method:'DELETE'});await reloadState()}catch(err){toast(err.message)}}
function deleteMeter(id){del(`/api/meters/${id}`,'Smazat měřidlo i všechny jeho odečty?')}
function deleteMeterReading(id){del(`/api/meter-readings/${id}`,'Smazat tento odečet?')}
function deleteAppliance(id){del(`/api/appliances/${id}`,'Smazat spotřebič i jeho uložené cykly?')}
function deleteHeatAllocator(id){del(`/api/heat-allocators/${id}`,'Smazat topný měřič i všechny jeho odečty?')}
function deleteHeatAllocatorReading(id){del(`/api/heat-allocator-readings/${id}`,'Smazat tento odečet topení?')}
function deleteTariff(id){del(`/api/tariffs/${id}`,'Smazat tuto verzi ceníku?')}
function deleteAdvance(id){del(`/api/advances/${id}`,'Smazat tuto změnu záloh?')}

function fillForm(formId,obj){const f=$(formId);Object.entries(obj).forEach(([k,v])=>{if(f.elements[k])f.elements[k].value=v??''});}
function editMeter(id){const x=STATE.data.meters.find(v=>v.id===id);if(!x)return;fillForm('#meterForm',x);openTab('readings')}
function editAppliance(id){const x=STATE.data.appliances.find(v=>v.id===id);if(!x)return;fillForm('#applianceForm',x);$('#applianceKind').value=x.kind;renderKindFields();openTab('appliances')}
function editHeatAllocator(id){const x=STATE.data.heat_allocators.find(v=>v.id===id);if(!x)return;fillForm('#heatAllocatorForm',x);openTab('heating')}
function editTariff(id){const x=STATE.data.tariffs.find(v=>v.id===id);if(!x)return;fillForm('#tariffForm',x);openTab('tariffs')}
function editAdvance(id){const x=STATE.data.advances.find(v=>v.id===id);if(!x)return;fillForm('#advanceForm',x);openTab('advances')}

function ctx(canvas){
  const c=$(canvas);
  const rect=c.getBoundingClientRect();
  const w=Math.max(320,Math.round(rect.width||c.parentElement?.clientWidth||700));
  const h=Number(c.getAttribute('height')||280);
  const dpr=Math.min(2.5,Math.max(1,window.devicePixelRatio||1));

  c.style.display='block';
  c.style.width='100%';
  c.style.height=`${h}px`;
  c.width=Math.round(w*dpr);
  c.height=Math.round(h*dpr);

  const x=c.getContext('2d');
  x.setTransform(dpr,0,0,dpr,0,0);
  x.clearRect(0,0,w,h);
  x.imageSmoothingEnabled=true;
  if('textRendering' in x)x.textRendering='optimizeLegibility';
  x.textBaseline='middle';
  x.font='500 14px "Segoe UI", Arial, sans-serif';
  return {c,x,w,h,dpr};
}
function shortText(x,text,maxWidth){
  text=String(text??'');
  if(x.measureText(text).width<=maxWidth)return text;
  let out=text;
  while(out.length>2&&x.measureText(out+'…').width>maxWidth)out=out.slice(0,-1);
  return out+'…';
}
function chartEmpty(x,msg='Zatím není co zobrazit.'){
  const rect=x.canvas.getBoundingClientRect();
  x.save();
  x.fillStyle='#6d7885';
  x.textAlign='center';
  x.textBaseline='middle';
  x.font='500 14px "Segoe UI", Arial, sans-serif';
  x.fillText(msg,rect.width/2,54);
  x.restore();
}
function axes(x,w,h,max,left=88,bottom=44,formatter=v=>nf.format(v)){
  const top=34;
  const plotH=h-bottom-top;
  x.save();
  x.strokeStyle='#e3e8eb';
  x.fillStyle='#687580';
  x.lineWidth=1;
  x.textAlign='right';
  x.textBaseline='middle';
  x.font='600 13px "Segoe UI", Arial, sans-serif';

  for(let i=0;i<5;i++){
    const y=top+plotH*i/4;
    x.beginPath();x.moveTo(left,y);x.lineTo(w-14,y);x.stroke();
    x.fillText(formatter(max*(1-i/4)),left-10,y);
  }

  x.restore();
  return {left,bottom,top,plotW:w-left-14,plotH,base:h-bottom};
}
function monthLabel(m){return String(m||'').slice(2).replace('-','/')}
function legend(x,items,startX=88,y=17){
  x.save();
  let px=startX;
  x.font='600 13px "Segoe UI", Arial, sans-serif';
  x.textBaseline='middle';
  for(const item of items){
    x.fillStyle=item.color;
    x.fillRect(px,y-6,12,12);
    px+=17;
    x.fillStyle='#5f6b75';
    x.textAlign='left';
    const label=shortText(x,item.label,155);
    x.fillText(label,px,y);
    px+=x.measureText(label).width+22;
  }
  x.restore();
}
function drawCostChart(months){
  const {x,w,h}=ctx('#costChart'),data=months.slice(-10);
  if(!data.length)return chartEmpty(x);

  const max=Math.max(...data.map(m=>Number(m.total_cost||0)),1);
  const g=axes(x,w,h,max,92,46,v=>`${Math.round(v).toLocaleString('cs-CZ')} Kč`);
  const slot=g.plotW/data.length,bw=Math.max(10,slot*.54);

  legend(x,[{label:'Fixní',color:'#b8c8c5'},{label:'Proměnlivé',color:'#277f72'}],92);

  x.save();
  x.font='600 13px "Segoe UI", Arial, sans-serif';
  x.textBaseline='middle';
  data.forEach((m,i)=>{
    const cx=g.left+slot*(i+.5);
    const fixed=Number(m.fixed_cost||0)/max*g.plotH;
    const variable=Math.max(0,Number(m.total_cost||0)-Number(m.fixed_cost||0))/max*g.plotH;
    let y=g.base;
    x.fillStyle='#b8c8c5';x.fillRect(cx-bw/2,y-fixed,bw,fixed);y-=fixed;
    x.fillStyle='#277f72';x.fillRect(cx-bw/2,y-variable,bw,variable);
    x.fillStyle='#65717b';x.textAlign='center';x.fillText(monthLabel(m.month),cx,h-17);
  });
  x.restore();
}
function drawUsageChart(months){
  const {x,w,h}=ctx('#usageChart'),data=months.slice(-10);
  if(!data.length)return chartEmpty(x);

  const measuredMax=Math.max(...data.map(m=>Number(m.measured?.electricity||0)));
  if(measuredMax<=0)return chartEmpty(x,'Zatím není naměřená spotřeba elektřiny.');

  const g=axes(x,w,h,measuredMax,88,46,v=>`${nf.format(v)} kWh`);
  const slot=g.plotW/data.length,bw=Math.max(10,slot*.54);
  const items=[
    {key:'passive',label:'Trvalé spotřebiče',color:'#7aa99f'},
    {key:'active',label:'Cyklické spotřebiče',color:'#2b8074'},
    {key:'unassigned',label:'Ostatní používání',color:'#c3a25d'}
  ];

  legend(x,items,88);

  x.save();
  x.font='600 13px "Segoe UI", Arial, sans-serif';
  x.textBaseline='middle';
  data.forEach((m,i)=>{
    const cx=g.left+slot*(i+.5);let y=g.base;
    for(const item of items){
      const v=Math.max(0,Number(m[item.key]?.electricity||0));
      const hh=v/measuredMax*g.plotH;
      y-=hh;
      x.fillStyle=item.color;
      x.fillRect(cx-bw/2,y,bw,hh);
    }
    x.fillStyle='#65717b';
    x.textAlign='center';
    x.fillText(monthLabel(m.month),cx,h-17);
  });
  x.restore();
}
function drawApplianceChart(m){
  const {x,w,h}=ctx('#applianceChart');
  if(!m)return chartEmpty(x);

  const measured=Number(m.measured?.electricity||0);
  const useEstimate=measured<=0;
  let rows=(m.appliances||[]).map(a=>({
    name:a.name,
    value:Number(useEstimate?(a.estimated_usage?.electricity||0):(a.attributed_usage?.electricity??a.usage?.electricity??0))
  })).filter(r=>r.value>0).sort((a,b)=>b.value-a.value);

  if(!useEstimate){
    const other=Number(m.unassigned?.electricity||0);
    if(other>0)rows.push({name:'Ostatní používání',value:other,other:true});
  }

  if(!rows.length)return chartEmpty(x,'Pro tento měsíc zatím není co zobrazit.');

  const shown=rows.slice(0,8);
  const max=Math.max(...shown.map(r=>r.value),1);
  const left=Math.min(210,Math.max(145,w*.29));
  const top=useEstimate?66:34;
  const rowH=Math.max(32,Math.min(40,(h-top-24)/shown.length));
  const barW=Math.max(100,w-left-115);

  x.save();
  x.textBaseline='middle';

  if(useEstimate){
    x.fillStyle='#6d7885';
    x.font='500 14px "Segoe UI", Arial, sans-serif';
    x.textAlign='center';
    x.fillText(shortText(x,'Odhad profilu bez odečtu elektroměru — nepřičítá se ke spotřebě.',w-48),w/2,28);
  }

  shown.forEach((r,i)=>{
    const y=top+i*rowH;
    x.font='600 14px "Segoe UI", Arial, sans-serif';
    x.fillStyle='#56636e';
    x.textAlign='right';
    x.fillText(shortText(x,r.name,left-28),left-14,y+10);

    const width=Math.max(5,r.value/max*barW);
    x.fillStyle=r.other?'#c3a25d':(useEstimate?'#8fb4ad':'#277f72');
    x.fillRect(left,y,width,20);

    const valueText=`${nf.format(r.value)} kWh`;
    x.font='600 13px "Segoe UI", Arial, sans-serif';
    const tw=x.measureText(valueText).width;
    if(left+width+10+tw<w-10){
      x.fillStyle='#4f5b65';
      x.textAlign='left';
      x.fillText(valueText,left+width+10,y+10);
    }else{
      x.fillStyle='#ffffff';
      x.textAlign='right';
      x.fillText(valueText,left+width-7,y+10);
    }
  });

  x.restore();
}
function drawCashflowChart(months){
  const {x,w,h}=ctx('#cashflowChart'),data=months.slice(-10);
  if(!data.length)return chartEmpty(x);

  const max=Math.max(...data.flatMap(m=>[Number(m.total_cost||0),Number(m.advance||0)]),1);
  const g=axes(x,w,h,max,92,46,v=>`${Math.round(v).toLocaleString('cs-CZ')} Kč`);
  const slot=g.plotW/data.length,bw=Math.max(7,slot*.27);

  legend(x,[{label:'Náklady',color:'#277f72'},{label:'Zálohy',color:'#9aa9b2'}],92);

  x.save();
  x.font='600 13px "Segoe UI", Arial, sans-serif';
  x.textBaseline='middle';
  data.forEach((m,i)=>{
    const cx=g.left+slot*(i+.5);
    const hc=Number(m.total_cost||0)/max*g.plotH;
    const ha=Number(m.advance||0)/max*g.plotH;
    x.fillStyle='#277f72';x.fillRect(cx-bw-3,g.base-hc,bw,hc);
    x.fillStyle='#9aa9b2';x.fillRect(cx+3,g.base-ha,bw,ha);
    x.fillStyle='#65717b';x.textAlign='center';x.fillText(monthLabel(m.month),cx,h-17);
  });
  x.restore();
}
function drawBalanceTrendChart(months){
  const {x,w,h}=ctx('#balanceTrendChart'),data=months.slice(-12);
  if(!data.length)return chartEmpty(x);

  let cumulative=0;
  const points=data.map(m=>({month:m.month,value:(cumulative+=Number(m.balance||0))}));
  const min=Math.min(0,...points.map(p=>p.value));
  const max=Math.max(0,...points.map(p=>p.value));
  const rawSpan=Math.max(1,max-min);
  const pad=Math.max(100,rawSpan*.08);
  const lo=min-pad,hi=max+pad,span=hi-lo;
  const left=96,bottom=46,top=34,plotW=w-left-18,plotH=h-bottom-top;
  const yFor=v=>top+(hi-v)/span*plotH;

  x.save();
  x.font='600 13px "Segoe UI", Arial, sans-serif';
  x.textBaseline='middle';

  for(let i=0;i<5;i++){
    const value=hi-span*i/4,y=yFor(value);
    x.strokeStyle='#e3e8eb';x.lineWidth=1;
    x.beginPath();x.moveTo(left,y);x.lineTo(w-14,y);x.stroke();
    x.fillStyle='#687580';x.textAlign='right';
    x.fillText(`${Math.round(value).toLocaleString('cs-CZ')} Kč`,left-10,y);
  }

  const zeroY=yFor(0);
  x.strokeStyle='#cbd4d9';
  x.beginPath();x.moveTo(left,zeroY);x.lineTo(w-14,zeroY);x.stroke();

  x.strokeStyle='#277f72';x.lineWidth=2.5;
  x.beginPath();
  points.forEach((p,i)=>{
    const px=left+(points.length===1?plotW/2:plotW*i/(points.length-1));
    const py=yFor(p.value);
    if(i===0)x.moveTo(px,py);else x.lineTo(px,py);
  });
  if(points.length>1)x.stroke();

  points.forEach((p,i)=>{
    const px=left+(points.length===1?plotW/2:plotW*i/(points.length-1));
    const py=yFor(p.value);

    x.fillStyle='#277f72';
    x.beginPath();x.arc(px,py,5,0,Math.PI*2);x.fill();

    x.font='600 13px "Segoe UI", Arial, sans-serif';
    x.textAlign='center';x.textBaseline='middle';
    x.fillStyle='#65717b';
    x.fillText(monthLabel(p.month),px,h-17);

    x.font='700 14px "Segoe UI", Arial, sans-serif';
    x.fillStyle='#277f72';
    x.fillText(money(p.value),px,Math.max(top+12,py-17));
  });

  x.restore();
}
function drawHeatingTrendChart(months){
  const {x,w,h}=ctx('#heatingTrendChart'),data=months.slice(-12);
  if(!data.length)return chartEmpty(x);

  const max=Math.max(...data.map(m=>Number(m.measured?.heat||0)));
  if(max<=0)return chartEmpty(x,'Zatím nejsou odečty spotřeby tepla.');

  const g=axes(x,w,h,max,88,46,v=>`${nf.format(v)} jedn.`);
  const slot=g.plotW/data.length,bw=Math.max(9,slot*.5);

  x.save();
  x.font='600 13px "Segoe UI", Arial, sans-serif';
  x.textBaseline='middle';
  data.forEach((m,i)=>{
    const v=Number(m.measured?.heat||0);
    const cx=g.left+slot*(i+.5),hh=v/max*g.plotH;
    x.fillStyle='#8a6f5a';x.fillRect(cx-bw/2,g.base-hh,bw,hh);
    x.fillStyle='#65717b';x.textAlign='center';x.fillText(monthLabel(m.month),cx,h-17);
  });
  x.restore();
}
function drawExpenseTreeChart(months,billing){
  const {x,w,h}=ctx('#expenseTreeChart');
  if(!billing?.start)return chartEmpty(x);

  const selected=months.filter(m=>m.month>=billing.start&&m.month<=billing.end);
  const keys=['electricity','cold_water','hot_water','gas','heat'];
  const rows=keys.map(k=>({
    name:utilityLabel[k],
    value:selected.reduce((s,m)=>s+Number(m.utility_costs?.[k]||0),0)
  })).filter(r=>r.value>0).sort((a,b)=>b.value-a.value);

  const total=rows.reduce((s,r)=>s+r.value,0);
  if(total<=0)return chartEmpty(x);

  const colors=['#277f72','#5f9a91','#87aaa4','#a9956c','#8a6f5a'];
  let px=0;

  x.save();
  x.textBaseline='top';

  rows.forEach((r,i)=>{
    const ww=i===rows.length-1?w-px:Math.round(w*r.value/total);
    x.fillStyle=colors[i%colors.length];
    x.fillRect(px,0,ww,h);

    const pct=Math.round(r.value/total*100);
    const pad=14;
    const usable=ww-pad*2;

    if(usable>=115){
      x.fillStyle='#fff';
      x.textAlign='left';
      x.font='700 15px "Segoe UI", Arial, sans-serif';
      x.fillText(shortText(x,r.name,usable),px+pad,14);
      x.font='600 13px "Segoe UI", Arial, sans-serif';
      x.fillText(shortText(x,money(r.value),usable),px+pad,40);
      x.fillText(`${pct} %`,px+pad,62);
    }else if(usable>=65){
      x.fillStyle='#fff';
      x.textAlign='center';
      x.font='700 13px "Segoe UI", Arial, sans-serif';
      x.fillText(shortText(x,r.name,usable),px+ww/2,16);
      x.font='600 12px "Segoe UI", Arial, sans-serif';
      x.fillText(`${pct} %`,px+ww/2,40);
    }

    px+=ww;
  });

  x.restore();
}
function drawWaterfall(b){
  const {x,w,h}=ctx('#waterfallChart');
  if(!b.start)return chartEmpty(x);

  const paid=Number(b.paid||0),cost=Number(b.actual_cost||0),balance=Number(b.current_balance||0);
  const min=Math.min(0,balance),max=Math.max(1,paid,balance),span=max-min;
  const left=96,right=28,top=36,bottom=50,plotW=w-left-right,plotH=h-top-bottom;
  const yFor=v=>top+(max-v)/span*plotH;

  x.save();
  x.font='600 13px "Segoe UI", Arial, sans-serif';
  x.textBaseline='middle';

  for(let i=0;i<5;i++){
    const value=max-span*i/4,y=yFor(value);
    x.strokeStyle='#e3e8eb';
    x.beginPath();x.moveTo(left,y);x.lineTo(w-right,y);x.stroke();
    x.fillStyle='#687580';x.textAlign='right';
    x.fillText(`${Math.round(value).toLocaleString('cs-CZ')} Kč`,left-10,y);
  }

  const centers=[left+plotW*.18,left+plotW*.5,left+plotW*.82];
  const bw=Math.min(150,plotW*.18);
  const zeroY=yFor(0),paidY=yFor(paid),balanceY=yFor(balance);

  x.fillStyle='#2c8175';x.fillRect(centers[0]-bw/2,paidY,bw,zeroY-paidY);
  x.fillStyle='#c56a6a';x.fillRect(centers[1]-bw/2,Math.min(paidY,balanceY),bw,Math.abs(balanceY-paidY));
  x.fillStyle=balance>=0?'#2c8175':'#c56a6a';x.fillRect(centers[2]-bw/2,Math.min(zeroY,balanceY),bw,Math.abs(balanceY-zeroY));

  const labels=[['Zálohy',paid,paidY],['Náklady',-cost,balanceY],['Zůstatek',balance,balanceY]];
  labels.forEach((item,i)=>{
    x.fillStyle='#53606b';x.textAlign='center';
    x.font='700 14px "Segoe UI", Arial, sans-serif';
    x.fillText(item[0],centers[i],h-19);
    x.font='700 13px "Segoe UI", Arial, sans-serif';
    const labelY=i===0?paidY-14:(i===1?Math.min(paidY,balanceY)-14:Math.min(zeroY,balanceY)-14);
    x.fillText(money(item[1]),centers[i],Math.max(top+10,labelY));
  });

  x.restore();
}

function selectedSvgMonths(months,billing){
  const rows=[...(months||[])];
  if(SVG_ANALYTICS_RANGE==='12m') return rows.slice(-12);
  if(billing?.start&&billing?.end){
    const selected=rows.filter(m=>m.month>=billing.start&&m.month<=billing.end);
    if(selected.length) return selected;
  }
  return rows.slice(-12);
}

function setSvgAnalyticsRange(range){
  if(!['billing','12m'].includes(range))return;
  SVG_ANALYTICS_RANGE=range;
  $('[data-analytics-range]').forEach(btn=>btn.classList.toggle('active',btn.dataset.analyticsRange===range));
  if(STATE) renderSvgAnalytics(STATE.dashboard?.months||[],STATE.dashboard?.billing||{});
}

function svgSafe(value){ return escapeHtml(String(value??'')); }

function renderSvgAnalytics(months,billing){
  const selected=selectedSvgMonths(months,billing);
  for(const utility of Object.keys(utilitySvgMeta)) renderMediaSvgChart(utility,selected);
  renderCostSankey(selected);
}

function renderMediaSvgChart(utility,months){
  const svg=$(`#mediaChart-${utility}`);
  const stat=$(`#mediaStat-${utility}`);
  if(!svg||!stat)return;

  const meta=utilitySvgMeta[utility];
  const rows=(months||[]).map(m=>({
    month:m.month,
    value:Number(m.measured?.[utility]||0),
    cost:Number(m.utility_costs?.[utility]||0)
  }));
  const total=rows.reduce((s,r)=>s+r.value,0);
  const totalCost=rows.reduce((s,r)=>s+r.cost,0);
  const latest=rows.length?rows[rows.length-1].value:0;

  stat.innerHTML=`<span><b>${nf.format(total)}</b> ${svgSafe(meta.unit)}</span><span>${money(totalCost)}</span><span>${tr('Poslední')}: ${nf.format(latest)} ${svgSafe(meta.unit)}</span>`;

  const W=760,H=240,left=68,right=20,top=24,bottom=38;
  const plotW=W-left-right,plotH=H-top-bottom;
  const max=Math.max(...rows.map(r=>r.value),0);

  if(!rows.length||max<=0){
    svg.innerHTML=`<rect class="svg-chart-bg" x="0" y="0" width="${W}" height="${H}"></rect><text class="svg-empty-text" x="${W/2}" y="${H/2}" text-anchor="middle">${svgSafe(tr('Zatím není co zobrazit.'))}</text>`;
    return;
  }

  const y=v=>top+plotH-(v/max)*plotH;
  const x=i=>rows.length===1?left+plotW/2:left+(plotW*i/(rows.length-1));
  const grid=[];
  for(let i=0;i<5;i++){
    const value=max*(1-i/4),gy=top+plotH*i/4;
    grid.push(`<line class="svg-grid-line" x1="${left}" y1="${gy}" x2="${W-right}" y2="${gy}"></line>`);
    grid.push(`<text class="svg-axis-text" x="${left-10}" y="${gy+4}" text-anchor="end">${svgSafe(nf.format(value))}</text>`);
  }

  const points=rows.map((r,i)=>[x(i),y(r.value)]);
  let linePath=`M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
  for(let i=1;i<points.length;i++) linePath+=` L ${points[i][0].toFixed(2)} ${points[i][1].toFixed(2)}`;
  const areaPath=`${linePath} L ${points[points.length-1][0].toFixed(2)} ${(top+plotH).toFixed(2)} L ${points[0][0].toFixed(2)} ${(top+plotH).toFixed(2)} Z`;

  const labelStep=Math.max(1,Math.ceil(rows.length/6));
  const labels=rows.map((r,i)=>{
    if(i%labelStep!==0&&i!==rows.length-1)return '';
    return `<text class="svg-axis-text svg-x-label" x="${x(i)}" y="${H-13}" text-anchor="middle">${svgSafe(monthLabel(r.month))}</text>`;
  }).join('');

  const dots=rows.map((r,i)=>`<circle class="svg-media-point" cx="${x(i)}" cy="${y(r.value)}" r="4" style="fill:${meta.color}"><title>${svgSafe(r.month)} · ${svgSafe(nf.format(r.value))} ${svgSafe(meta.unit)} · ${svgSafe(money(r.cost))}</title></circle>`).join('');

  svg.innerHTML=`
    <rect class="svg-chart-bg" x="0" y="0" width="${W}" height="${H}"></rect>
    ${grid.join('')}
    <path d="${areaPath}" style="fill:${meta.soft};opacity:.78"></path>
    <path class="svg-media-line" d="${linePath}" style="stroke:${meta.color}"></path>
    ${dots}
    ${labels}
    <text class="svg-unit-label" x="${left}" y="15">${svgSafe(meta.unit)}</text>
  `;
}

function sankeyRibbon(x0,y0a,y0b,x1,y1a,y1b){
  const bend=(x1-x0)*.44;
  return `M ${x0} ${y0a} C ${x0+bend} ${y0a}, ${x1-bend} ${y1a}, ${x1} ${y1a} L ${x1} ${y1b} C ${x1-bend} ${y1b}, ${x0+bend} ${y0b}, ${x0} ${y0b} Z`;
}

function renderCostSankey(months){
  const svg=$('#costSankey');
  const summary=$('#sankeySummary');
  if(!svg||!summary)return;

  const utilities=Object.keys(utilitySvgMeta).map(key=>{
    const variable=(months||[]).reduce((s,m)=>s+Number(m.variable_costs?.[key]||0),0);
    const fixed=(months||[]).reduce((s,m)=>s+Number(m.fixed_costs?.[key]||0),0);
    return {key,label:utilityLabel[key],variable,fixed,total:variable+fixed,color:utilitySvgMeta[key].color};
  }).filter(u=>u.total>0);

  const total=utilities.reduce((s,u)=>s+u.total,0);
  summary.textContent=total>0?`${tr('Celkové náklady')}: ${money(total)}`:'';

  const W=960,H=460,top=34,bottom=34,available=H-top-bottom,nodeW=18;
  if(total<=0){
    svg.innerHTML=`<rect class="svg-chart-bg" x="0" y="0" width="${W}" height="${H}"></rect><text class="svg-empty-text" x="${W/2}" y="${H/2}" text-anchor="middle">${svgSafe(tr('Zatím není co zobrazit.'))}</text>`;
    return;
  }

  const leaves=[];
  for(const u of utilities){
    if(u.variable>0)leaves.push({utility:u,key:'variable',label:`${u.label} · ${tr('Spotřeba')}`,value:u.variable,opacity:.92});
    if(u.fixed>0)leaves.push({utility:u,key:'fixed',label:`${u.label} · ${tr('Fixní')}`,value:u.fixed,opacity:.48});
  }

  const utilGap=14,leafGap=8;
  const scale=Math.max(.001,Math.min(
    (available-utilGap*Math.max(0,utilities.length-1))/total,
    (available-leafGap*Math.max(0,leaves.length-1))/total
  ));

  const sourceH=total*scale;
  const sourceY=(H-sourceH)/2;
  const x0=54,x1=360,x2=744;

  const utilHeight=total*scale+utilGap*Math.max(0,utilities.length-1);
  let uy=(H-utilHeight)/2;
  for(const u of utilities){u.y=uy;u.h=u.total*scale;uy+=u.h+utilGap;}

  const leafHeight=total*scale+leafGap*Math.max(0,leaves.length-1);
  let ly=(H-leafHeight)/2;
  for(const leaf of leaves){leaf.y=ly;leaf.h=leaf.value*scale;ly+=leaf.h+leafGap;}

  let sourceCursor=sourceY;
  const sourceLinks=[];
  for(const u of utilities){
    sourceLinks.push({
      d:sankeyRibbon(x0+nodeW,sourceCursor,sourceCursor+u.h,x1,u.y,u.y+u.h),
      color:u.color,label:`${tr('Celkové náklady')} → ${u.label}`,value:u.total
    });
    sourceCursor+=u.h;
  }

  const leafMap=new Map(leaves.map(l=>[`${l.utility.key}:${l.key}`,l]));
  const detailLinks=[];
  for(const u of utilities){
    let cursor=u.y;
    for(const kind of ['variable','fixed']){
      const leaf=leafMap.get(`${u.key}:${kind}`);
      if(!leaf)continue;
      detailLinks.push({
        d:sankeyRibbon(x1+nodeW,cursor,cursor+leaf.h,x2,leaf.y,leaf.y+leaf.h),
        color:u.color,opacity:leaf.opacity,
        label:`${u.label} → ${kind==='variable'?tr('Spotřeba'):tr('Fixní')}`,value:leaf.value
      });
      cursor+=leaf.h;
    }
  }

  const links=[
    ...sourceLinks.map(l=>`<path class="sankey-link" d="${l.d}" style="fill:${l.color};opacity:.23"><title>${svgSafe(l.label)} · ${svgSafe(money(l.value))}</title></path>`),
    ...detailLinks.map(l=>`<path class="sankey-link" d="${l.d}" style="fill:${l.color};opacity:${l.opacity*.32}"><title>${svgSafe(l.label)} · ${svgSafe(money(l.value))}</title></path>`)
  ].join('');

  const utilityNodes=utilities.map(u=>`
    <g class="sankey-node">
      <rect x="${x1}" y="${u.y}" width="${nodeW}" height="${Math.max(2,u.h)}" rx="2" style="fill:${u.color}"><title>${svgSafe(u.label)} · ${svgSafe(money(u.total))}</title></rect>
      <text class="sankey-label sankey-label-mid" x="${x1+nodeW+9}" y="${u.y+u.h/2+4}">${svgSafe(u.label)} · ${svgSafe(money(u.total))}</text>
    </g>`).join('');

  const leafNodes=leaves.map(l=>`
    <g class="sankey-node">
      <rect x="${x2}" y="${l.y}" width="${nodeW}" height="${Math.max(2,l.h)}" rx="2" style="fill:${l.utility.color};opacity:${l.opacity}"><title>${svgSafe(l.label)} · ${svgSafe(money(l.value))}</title></rect>
      <text class="sankey-label" x="${x2+nodeW+9}" y="${l.y+l.h/2+4}">${svgSafe(l.label)} · ${svgSafe(money(l.value))}</text>
    </g>`).join('');

  svg.innerHTML=`
    <rect class="svg-chart-bg" x="0" y="0" width="${W}" height="${H}"></rect>
    ${links}
    <rect x="${x0}" y="${sourceY}" width="${nodeW}" height="${sourceH}" rx="2" class="sankey-source"><title>${svgSafe(tr('Celkové náklady'))} · ${svgSafe(money(total))}</title></rect>
    <text class="sankey-source-label" x="${x0}" y="${Math.max(18,sourceY-10)}">${svgSafe(tr('Celkové náklady'))}</text>
    ${utilityNodes}
    ${leafNodes}
    <g class="sankey-legend">
      <rect x="360" y="438" width="12" height="12" class="sankey-legend-variable"></rect>
      <text x="378" y="448">${svgSafe(tr('Spotřeba'))}</text>
      <rect x="474" y="438" width="12" height="12" class="sankey-legend-fixed"></rect>
      <text x="492" y="448">${svgSafe(tr('Fixní'))}</text>
    </g>
  `;
}

async function connectionCheck(){
  try{await api('/health');if(document.visibilityState==='visible'&&STATE===null)await reloadState()}catch(_){}
}
$('[data-analytics-range]').forEach(btn=>btn.addEventListener('click',()=>setSvgAnalyticsRange(btn.dataset.analyticsRange)));
window.setInterval(connectionCheck,30000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')reloadState().catch(()=>{})});
window.addEventListener('focus',()=>connectionCheck());
document.addEventListener('app-language-change',()=>STATE&&renderDashboard());

window.addEventListener('resize',()=>STATE&&renderDashboard());
renderKindFields(); setDateDefaults();
reloadState().catch(err=>toast(err.message));
