const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let STATE = null;
const nf = new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:3});
const moneyFmt = new Intl.NumberFormat('cs-CZ',{style:'currency',currency:'CZK',maximumFractionDigits:0});
const utilityLabel = {electricity:'Elektřina',cold_water:'Studená voda',hot_water:'Teplá voda',gas:'Plyn',heat:'Teplo'};

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
  const c=$(canvas),r=Math.max(1,window.devicePixelRatio||1),w=Math.max(280,c.clientWidth||700),h=Number(c.getAttribute('height')||260);
  c.style.width='100%';c.style.height=`${h}px`;c.width=Math.floor(w*r);c.height=Math.floor(h*r);
  const x=c.getContext('2d');x.setTransform(r,0,0,r,0,0);x.clearRect(0,0,w,h);x.font='12px Segoe UI';x.textBaseline='alphabetic';
  return {c,x,w,h};
}
function shortText(x,text,maxWidth){
  text=String(text??'');
  if(x.measureText(text).width<=maxWidth)return text;
  let out=text;
  while(out.length>2&&x.measureText(out+'…').width>maxWidth)out=out.slice(0,-1);
  return out+'…';
}
function chartEmpty(x,msg='Zatím není co zobrazit.'){x.fillStyle='#88929c';x.textAlign='left';x.fillText(msg,20,30)}
function axes(x,w,h,max,left=58,bottom=38){
  x.strokeStyle='#e7ebee';x.fillStyle='#75808a';x.lineWidth=1;x.textAlign='right';
  for(let i=0;i<5;i++){const y=18+(h-bottom-18)*i/4;x.beginPath();x.moveTo(left,y);x.lineTo(w-10,y);x.stroke();const n=max*(1-i/4);x.fillText(nf.format(n),left-8,y+4)}
  x.textAlign='left';return {left,bottom,plotW:w-left-10,plotH:h-bottom-18,base:h-bottom};
}
function monthLabel(m){return String(m||'').slice(2).replace('-','/')}
function legend(x,items,startX=58,y=14){
  let px=startX;x.font='11px Segoe UI';
  for(const item of items){x.fillStyle=item.color;x.fillRect(px,y-8,10,10);px+=14;x.fillStyle='#5e6973';x.textAlign='left';const label=shortText(x,item.label,130);x.fillText(label,px,y);px+=x.measureText(label).width+18}
}
function drawCostChart(months){
  const {x,w,h}=ctx('#costChart'),data=months.slice(-10);if(!data.length)return chartEmpty(x);
  const max=Math.max(...data.map(m=>m.total_cost),1),g=axes(x,w,h,max),slot=g.plotW/data.length,bw=Math.max(8,slot*.54);
  legend(x,[{label:'Fixní',color:'#b8c8c5'},{label:'Proměnlivé',color:'#277f72'}]);
  data.forEach((m,i)=>{const cx=g.left+slot*(i+.5),fixed=m.fixed_cost/max*g.plotH,variable=(m.total_cost-m.fixed_cost)/max*g.plotH;let y=g.base;x.fillStyle='#b8c8c5';x.fillRect(cx-bw/2,y-fixed,bw,fixed);y-=fixed;x.fillStyle='#277f72';x.fillRect(cx-bw/2,y-variable,bw,variable);x.fillStyle='#6f7a84';x.textAlign='center';x.fillText(monthLabel(m.month),cx,h-13)});x.textAlign='left';
}
function drawUsageChart(months){
  const {x,w,h}=ctx('#usageChart'),data=months.slice(-10);if(!data.length)return chartEmpty(x);
  const max=Math.max(...data.map(m=>m.measured.electricity),1),g=axes(x,w,h,max),slot=g.plotW/data.length,bw=Math.max(8,slot*.54);
  const items=[{key:'passive',label:'Trvalé spotřebiče',color:'#7aa99f'},{key:'active',label:'Cyklické spotřebiče',color:'#2b8074'},{key:'unassigned',label:'Ostatní používání',color:'#c3a25d'}];
  legend(x,items);
  data.forEach((m,i)=>{const cx=g.left+slot*(i+.5);let y=g.base;for(const item of items){const v=Math.max(0,m[item.key].electricity),hh=v/max*g.plotH;y-=hh;x.fillStyle=item.color;x.fillRect(cx-bw/2,y,bw,hh)}x.fillStyle='#6f7a84';x.textAlign='center';x.fillText(monthLabel(m.month),cx,h-13)});x.textAlign='left';
}
function drawApplianceChart(m){
  const {x,w,h}=ctx('#applianceChart');if(!m)return chartEmpty(x);
  const rows=(m.appliances||[]).map(a=>({name:a.name,value:Number(a.attributed_usage?.electricity??a.usage?.electricity??0)})).filter(r=>r.value>0).sort((a,b)=>b.value-a.value);
  rows.push({name:'Ostatní používání',value:Number(m.unassigned?.electricity||0),other:true});
  const shown=rows.slice(0,8);if(rows.length>8){const rest=rows.slice(8).reduce((s,r)=>s+r.value,0);shown.push({name:'Další spotřebiče',value:rest})}
  const max=Math.max(...shown.map(r=>r.value),1),left=Math.min(150,Math.max(100,w*.28)),top=26,rowH=Math.min(30,(h-top-18)/Math.max(1,shown.length)),barW=w-left-25;
  shown.forEach((r,i)=>{const y=top+i*rowH;x.fillStyle='#5f6b75';x.textAlign='right';x.fillText(shortText(x,r.name,left-18),left-10,y+13);x.fillStyle=r.other?'#c3a25d':'#277f72';x.fillRect(left,y,Math.max(2,r.value/max*barW),15);x.fillStyle='#4f5b65';x.textAlign='left';x.fillText(`${nf.format(r.value)} kWh`,Math.min(w-70,left+r.value/max*barW+6),y+13)});x.textAlign='left';
}
function drawCashflowChart(months){
  const {x,w,h}=ctx('#cashflowChart'),data=months.slice(-10);if(!data.length)return chartEmpty(x);
  const max=Math.max(...data.flatMap(m=>[m.total_cost,m.advance]),1),g=axes(x,w,h,max),slot=g.plotW/data.length,bw=Math.max(5,slot*.27);
  legend(x,[{label:'Náklady',color:'#277f72'},{label:'Zálohy',color:'#9aa9b2'}]);
  data.forEach((m,i)=>{const cx=g.left+slot*(i+.5),hc=m.total_cost/max*g.plotH,ha=m.advance/max*g.plotH;x.fillStyle='#277f72';x.fillRect(cx-bw-2,g.base-hc,bw,hc);x.fillStyle='#9aa9b2';x.fillRect(cx+2,g.base-ha,bw,ha);x.fillStyle='#6f7a84';x.textAlign='center';x.fillText(monthLabel(m.month),cx,h-13)});x.textAlign='left';
}
function drawBalanceTrendChart(months){
  const {x,w,h}=ctx('#balanceTrendChart'),data=months.slice(-12);if(!data.length)return chartEmpty(x);
  let cumulative=0;const points=data.map(m=>({month:m.month,value:(cumulative+=Number(m.balance||0))}));
  const abs=Math.max(...points.map(p=>Math.abs(p.value)),1),left=58,bottom=38,top=22,plotW=w-left-12,plotH=h-bottom-top,mid=top+plotH/2;
  x.strokeStyle='#dfe5e8';x.beginPath();x.moveTo(left,mid);x.lineTo(w-12,mid);x.stroke();x.fillStyle='#75808a';x.textAlign='right';x.fillText(money(abs),left-7,top+4);x.fillText('0',left-7,mid+4);x.fillText(money(-abs),left-7,h-bottom+2);
  x.strokeStyle='#277f72';x.lineWidth=2;x.beginPath();points.forEach((p,i)=>{const px=left+(points.length===1?plotW/2:plotW*i/(points.length-1)),py=mid-(p.value/abs)*(plotH/2);if(i===0)x.moveTo(px,py);else x.lineTo(px,py);x.fillStyle='#6f7a84';x.textAlign='center';x.fillText(monthLabel(p.month),px,h-13)});x.stroke();x.textAlign='left';
}
function drawHeatingTrendChart(months){
  const {x,w,h}=ctx('#heatingTrendChart'),data=months.slice(-12);if(!data.length)return chartEmpty(x);
  const max=Math.max(...data.map(m=>Number(m.measured?.heat||0)),1),g=axes(x,w,h,max),slot=g.plotW/data.length,bw=Math.max(7,slot*.5);
  data.forEach((m,i)=>{const v=Number(m.measured?.heat||0),cx=g.left+slot*(i+.5),hh=v/max*g.plotH;x.fillStyle='#8a6f5a';x.fillRect(cx-bw/2,g.base-hh,bw,hh);x.fillStyle='#6f7a84';x.textAlign='center';x.fillText(monthLabel(m.month),cx,h-13)});x.textAlign='left';
}
function drawExpenseTreeChart(months,billing){
  const {x,w,h}=ctx('#expenseTreeChart');if(!billing?.start)return chartEmpty(x);
  const selected=months.filter(m=>m.month>=billing.start&&m.month<=billing.end),keys=['electricity','cold_water','hot_water','gas','heat'];
  const rows=keys.map(k=>({name:utilityLabel[k],value:selected.reduce((s,m)=>s+Number(m.utility_costs?.[k]||0),0)})).filter(r=>r.value>0).sort((a,b)=>b.value-a.value);
  const total=rows.reduce((s,r)=>s+r.value,0);if(total<=0)return chartEmpty(x);
  const colors=['#277f72','#5f9a91','#87aaa4','#a9956c','#8a6f5a'];let px=0;
  rows.forEach((r,i)=>{const ww=i===rows.length-1?w-px:Math.round(w*r.value/total);x.fillStyle=colors[i%colors.length];x.fillRect(px,0,ww,h);if(ww>76){x.fillStyle='#fff';x.textAlign='left';x.font='700 13px Segoe UI';x.fillText(shortText(x,r.name,ww-18),px+9,24);x.font='12px Segoe UI';x.fillText(shortText(x,money(r.value),ww-18),px+9,44);x.fillText(`${Math.round(r.value/total*100)} %`,px+9,62)}px+=ww});x.textAlign='left';x.font='12px Segoe UI';
}
function drawWaterfall(b){
  const {x,w,h}=ctx('#waterfallChart');if(!b.start)return chartEmpty(x);
  const values=[b.paid,-Math.max(0,b.actual_cost),b.current_balance],labels=['Zálohy','Náklady','Zůstatek'],max=Math.max(...values.map(v=>Math.abs(v)),1),mid=h/2;
  x.strokeStyle='#dfe5e8';x.beginPath();x.moveTo(45,mid);x.lineTo(w-10,mid);x.stroke();
  values.forEach((v,i)=>{const cx=80+(w-150)*i/(values.length-1),bw=Math.min(110,(w-130)/4),hh=Math.abs(v)/max*(h*.34);x.fillStyle=v>=0?'#2c8175':'#c56a6a';x.fillRect(cx-bw/2,v>=0?mid-hh:mid,bw,hh);x.fillStyle='#53606b';x.textAlign='center';x.fillText(shortText(x,labels[i],bw+20),cx,h-18);x.fillText(shortText(x,money(v),bw+32),cx,v>=0?mid-hh-8:mid+hh+14)});x.textAlign='left';
}

async function connectionCheck(){
  try{await api('/health');if(document.visibilityState==='visible'&&STATE===null)await reloadState()}catch(_){}
}
window.setInterval(connectionCheck,30000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')reloadState().catch(()=>{})});
window.addEventListener('focus',()=>connectionCheck());
document.addEventListener('app-language-change',()=>STATE&&renderDashboard());

window.addEventListener('resize',()=>STATE&&renderDashboard());
renderKindFields(); setDateDefaults();
reloadState().catch(err=>toast(err.message));
