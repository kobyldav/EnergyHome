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

async function api(url,options={}){
  options.headers={...(options.headers||{}),'Content-Type':'application/json'};
  const res=await fetch(url,options); const body=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(body.error||`Chyba ${res.status}`); return body;
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
  if(d.finance_notes?.heat_advance_without_cost) alerts.push({severity:'info',text:'Je evidovaná záloha na teplo, ale chybí cena tepla. Celková spotřeba tepla se nyní provizorně definuje jako součet přepočtených přírůstků všech radiátorových měřičů.'});
  if(d.finance_notes?.heat_definition_provisional) alerts.push({severity:'info',text:'Teplo je nyní provizorně počítáno jako součet všech radiátorových měřičů. Výsledná jednotka není ověřená GJ; později lze přidat přesný převod.'});
  $('#alerts').innerHTML=alerts.length?alerts.map(a=>`<div class="alert ${a.severity}">${escapeHtml(a.text)}</div>`).join(''):'<div class="alert ok">Žádná mimořádná odchylka v posledním období.</div>';
  renderHeatAllocatorDashboard(d.heat_allocators||{});
  drawCostChart(d.months||[]); drawUsageChart(d.months||[]); drawWaterfall(b);
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
function renderSettings(){ const s=STATE.data.settings||{}, f=$('#settingsForm'); f.household_name.value=s.household_name||''; f.billing_start_month.value=s.billing_start_month||1; f.currency.value=s.currency||'CZK'; f.unassigned_alert_ratio_pct.value=Math.round(Number(s.unassigned_alert_ratio||.3)*100); }

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

function ctx(canvas){const c=$(canvas),r=devicePixelRatio||1,w=c.clientWidth||700,h=Number(c.getAttribute('height')||260);c.width=w*r;c.height=h*r;const x=c.getContext('2d');x.scale(r,r);x.clearRect(0,0,w,h);x.font='12px Segoe UI';return {c,x,w,h};}
function axes(x,w,h,max){x.strokeStyle='#e7ebee';x.fillStyle='#75808a';x.lineWidth=1;for(let i=0;i<5;i++){const y=20+(h-55)*i/4;x.beginPath();x.moveTo(45,y);x.lineTo(w-10,y);x.stroke();const n=max*(1-i/4);x.fillText(nf.format(n),4,y+4)}}
function drawCostChart(months){const {x,w,h}=ctx('#costChart');const data=months.slice(-8);if(!data.length){x.fillStyle='#88929c';x.fillText('Zatím není co zobrazit.',20,30);return}const max=Math.max(...data.map(m=>m.total_cost),1);axes(x,w,h,max);const bw=(w-65)/data.length*.58;data.forEach((m,i)=>{const cx=55+(w-65)*(i+.5)/data.length,base=h-35;const fixed=m.fixed_cost/max*(h-55),variable=(m.total_cost-m.fixed_cost)/max*(h-55);x.fillStyle='#b8c8c5';x.fillRect(cx-bw/2,base-fixed,bw,fixed);x.fillStyle='#277f72';x.fillRect(cx-bw/2,base-fixed-variable,bw,variable);x.fillStyle='#6f7a84';x.textAlign='center';x.fillText(m.month.slice(5),cx,h-12)});x.textAlign='left'}
function drawUsageChart(months){const {x,w,h}=ctx('#usageChart');const data=months.slice(-8);if(!data.length){x.fillStyle='#88929c';x.fillText('Zatím není co zobrazit.',20,30);return}const max=Math.max(...data.map(m=>m.measured.electricity),1);axes(x,w,h,max);const bw=(w-65)/data.length*.58;data.forEach((m,i)=>{const cx=55+(w-65)*(i+.5)/data.length,base=h-35;const vals=[Math.max(0,m.passive.electricity),Math.max(0,m.active.electricity),Math.max(0,m.unassigned.electricity)];const cols=['#7aa99f','#2b8074','#c3a25d'];let y=base;vals.forEach((v,j)=>{const hh=v/max*(h-55);y-=hh;x.fillStyle=cols[j];x.fillRect(cx-bw/2,y,bw,hh)});x.fillStyle='#6f7a84';x.textAlign='center';x.fillText(m.month.slice(5),cx,h-12)});x.textAlign='left'}
function drawWaterfall(b){const {x,w,h}=ctx('#waterfallChart');if(!b.start){x.fillStyle='#88929c';x.fillText('Zatím není co zobrazit.',20,30);return}const values=[b.paid,-Math.max(0,b.actual_cost),b.current_balance],labels=['Zálohy','Náklady','Zůstatek'];const max=Math.max(...values.map(v=>Math.abs(v)),1);const mid=h/2;x.strokeStyle='#dfe5e8';x.beginPath();x.moveTo(35,mid);x.lineTo(w-10,mid);x.stroke();values.forEach((v,i)=>{const cx=80+(w-120)*i/(values.length-1),bw=Math.min(120,(w-120)/4),hh=Math.abs(v)/max*(h*.36);x.fillStyle=v>=0?'#2c8175':'#c56a6a';x.fillRect(cx-bw/2,v>=0?mid-hh:mid,bw,hh);x.fillStyle='#53606b';x.textAlign='center';x.fillText(labels[i],cx,h-18);x.fillText(money(v),cx,v>=0?mid-hh-8:mid+hh+14)});x.textAlign='left'}

window.addEventListener('resize',()=>STATE&&renderDashboard());
renderKindFields(); setDateDefaults();
reloadState().catch(err=>toast(err.message));
