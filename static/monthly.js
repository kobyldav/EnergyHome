/* Month-first evidence-only dashboard extension.
   Included after app.js so legacy pages/forms stay compatible. */
(() => {
  let displayed = null;
  let history = null;
  let stateIdentity = null;
  let pending = null;
  let serial = 0;
  const picker = document.querySelector('#dashboardMonthPicker');
  if (!picker) return;
  const utilities = Object.keys(utilitySvgMeta);
  const byUtility = {
    electricity: ['#kpiElectricity','kWh'], cold_water: ['#kpiColdWater','m³'],
    hot_water: ['#kpiHotWater','m³'], gas: ['#kpiGas','m³'], heat: ['#kpiHeat','jedn.']
  };
  const monthName = value => value ? monthsCz[Number(value.slice(5,7))-1] + ' ' + value.slice(0,4) : '—';
  const noProjection = '';
  const statusText = (v, utility) => {
    const status = v.status?.[utility];
    if (status === 'complete') return 'Rozpočítáno z odečtů za celý měsíc';
    if (status === 'to_date') return 'Rozpočítáno do posledního odečtu';
    if (status === 'partial') return 'Rozpočítáno podle odečtů · část měsíce chybí';
    return 'Chybí návazné odečty';
  };

  // Advance amounts in the app are configured monthly rules, not bank payments.
  drawFinancialPosition = function(b) {
    $('#billingPeriod').textContent = b ? monthName(b.month) : '—';
    $('#currentBalance').textContent = b ? money(b.balance) : '—';
    $('#paidTotal').textContent = b ? money(b.advance) : '—';
    $('#actualCost').textContent = b ? money(b.total_cost) : '—';
    $('#paidTotalLabel').textContent = 'Předepsané zálohy (nikoli potvrzené platby)';
    $('#financePeriodNote').textContent = '';
    const value = Number(b?.balance||0);
    const pct = Math.min(50, Math.abs(value)/Math.max(1000,Math.abs(value)*1.2)*50);
    const fill = $('#thermoFill');
    fill.style.width = b ? pct+'%' : '0%';
    fill.style.left = value>=0 ? '50%' : (50-pct)+'%';
    fill.style.background = value>=0 ? '#1f8a5b' : '#c94b4b';
  };

  function monthOverview(v) {
    const b = {
      start:v.start, end:v.end, paid:v.advance, actual_cost:v.total_cost,
      current_balance:v.balance
    };
    const displayHeat = v.measured?.heat;
    const m = {
      ...v, fixed_cost:Object.values(v.fixed_costs).reduce((a,b)=>a+Number(b||0),0),
      unassigned:Object.fromEntries(utilities.map(u=>[u,Number(v.measured[u]||0)])),
      passive:Object.fromEntries(utilities.map(u=>[u,0])),
      active:Object.fromEntries(utilities.map(u=>[u,0]))
    };
    const canMeasure = utilities.some(u=>v.status[u]!=='missing');
    $('#emptyHint').classList.toggle('hidden',canMeasure);
    if (!canMeasure) $('#emptyHint').innerHTML =
      '<strong>Pro '+escapeHtml(monthName(v.month))+' zatím chybí odečty.</strong> Zadejte alespoň dva navazující stavy měřidla.';
    for (const [u, [selector,unit]] of Object.entries(byUtility)) {
      const value = v.measured?.[u];
      $(selector).textContent = value == null ? '—' : nf.format(value)+' '+unit;
      const note = $('#kpiNote-'+u);
      if (note) note.textContent = statusText(v,u);
    }
    $('#kpiCost').textContent = money(v.total_cost) + (v.cost_incomplete ? ' + teplo' : '');
    const heatPrice = v.heat_cost_estimate;
    $('#kpiMonth').textContent = monthName(v.month) +
      (v.as_of && v.as_of < v.end ? ' · k '+v.as_of : '') +
      (heatPrice?.mode==='allocator_unit_estimate' ? ' · orientačně' : '');

    drawFinancialPosition(v);
    if(v.cost_incomplete){
      $('#currentBalance').textContent='Neúplné';
      $('#actualCost').textContent=money(v.total_cost)+' + teplo';
      $('#thermoFill').style.width='0%';
    }
    const notes = [];

    if (v.cost_incomplete)
      notes.push({severity:'warning',text:'Spotřeba tepla je započtená v dílcích, ale její cena není zadaná. Finanční výsledek je neúplný. Doplň sazbu za jednotku v Ceníku.'});
    const incomplete = utilities.filter(u=>v.status?.[u]==='partial');
    if(incomplete.length){
      const missing = incomplete.map(u=>{
        const meterDefs = u==='heat' && (STATE.data.heat_allocators||[]).length
          ? STATE.data.heat_allocators
          : (STATE.data.meters||[]).filter(m=>m.utility===u);
        const entries = v.coverage?.[u]||[];
        const expected = v.as_of && v.as_of>=v.start ? Number(v.as_of.slice(-2)) : 0;
        const gaps = meterDefs.filter(m=>(entries.find(e=>e.id===m.id)?.days||0)<expected)
          .map(m=>m.room?m.room+' · '+m.name:m.name);
        const extra = gaps.length ? ' (chybí úplný interval: '+gaps.slice(0,3).join(', ')+(gaps.length>3?' a další':'')+')':'';
        return utilityLabel[u]+extra;
      });
      notes.push({severity:'info',text:'Neúplná data pro '+incomplete.map(u=>utilityLabel[u]).join(', ')+
        ' — '+missing.join('; ')+'. Některé dny nejsou podloženy dvěma odečty+'. Zobrazená spotřeba zahrnuje jen pokryté dny, ne odhad za zbytek měsíce.'});
    }


    if (STATE.dashboard?.contract_review?.due)
      notes.push({severity:'warning',text:'Je čas zkontrolovat platnost smluv a ceníků.'});
    $('#alerts').innerHTML = notes.map(n=>'<div class="alert '+n.severity+'"><span>'+escapeHtml(n.text)+'</span></div>').join('');

    drawCostChart([m]);
    // Appliance share is only a configured model, never an actual device reading.
    window.EnergyInsights?.renderAll(v,history);
    drawCashflowChart([m]);
    drawBalanceTrendChart([m]);

    drawExpenseTreeChart([m],{start:v.month,end:v.month});
    drawWaterfall(b);
    renderCostSankey([m]);
    renderMonthHeat(v);
    for (const u of utilities) drawActualReadingChart(u,v);
  }

  function renderMonthHeat(v){
    const box = $('#heatAllocatorDashboard');
    const devices = (v.monthly_devices || []).filter(d => d.utility === 'heat');
    if(!(STATE.data.heat_allocators || []).length){
      box.innerHTML='<p class="help">Zatím nejsou evidované radiátorové měřiče.</p>';
      return;
    }
    const current = devices.filter(d=>d.has_data);
    if(!current.length){
      box.innerHTML='<p class="help">Pro vybraný měsíc zatím nelze rozpočítat spotřebu radiátorů. Jsou potřeba dva odečty.</p>';
      return;
    }
    const grouped = new Map();
    for(const d of current){
      const room = d.room || 'Bez místnosti';
      const obj = grouped.get(room) || {room,devices:0,value:0};
      obj.devices++;
      obj.value += Number(d.amount || 0);
      grouped.set(room,obj);
    }
    const roomRows=[...grouped.values()].sort((a,b)=>a.room.localeCompare(b.room,'cs')).map(r=>
      '<tr><td><b>'+escapeHtml(r.room)+'</b></td><td>'+r.devices+'</td><td><b>'+nf.format(r.value)+' jedn.</b></td></tr>').join('');
    const rows=current.sort((a,b)=>a.room.localeCompare(b.room,'cs')).map(d=>
      '<tr><td>'+escapeHtml(d.room)+'</td><td>'+escapeHtml(d.name)+'</td><td><b>'+nf.format(d.amount)+' jedn.</b></td></tr>').join('');
    box.innerHTML='<div class="table-wrap dashboard-table"><table><thead><tr><th>Místnost</th><th>Radiátory</th><th>Spotřeba za vybraný měsíc</th></tr></thead><tbody>'+
      roomRows+'</tbody></table></div>'+
      '<h3 class="heat-interval-heading">Jednotlivé radiátory</h3>'+
      '<div class="table-wrap dashboard-table"><table><thead><tr><th>Místnost</th><th>Měřič</th><th>Rozpočítané dílky</th></tr></thead><tbody>'+
      rows+'</tbody></table></div>';
  }

  // Connected, linearly interpolated cumulative usage between actual readings.
  // Linear slopes reflect average intervals, not direct daily measurements.
  function drawActualReadingChart(utility,v){
    const svg=$('#mediaChart-'+utility),stat=$('#mediaStat-'+utility);
    if(!svg||!stat)return;
    const days=(v.days||[]).filter(d=>d.date<=currentLocalIsoDate());
    const observed=days.filter(d=>Boolean(d.has_allocation?.[utility]));
    const meta=utilitySvgMeta[utility],W=760,H=240,left=82,right=24,top=28,bottom=43;
    const total=observed.reduce((sum,d)=>sum+Number(d.measured?.[utility]||0),0);
    const count=days.reduce((sum,d)=>sum+Number(d.readings?.[utility]||0),0);
    stat.innerHTML=observed.length
      ? '<span><b>'+nf.format(total)+'</b> '+svgSafe(meta.unit)+'</span>'+
        '<span>'+observed.length+' pokrytých dnů</span><span>'+count+' odečtů</span>'
      : '<span>Bez navazujících odečtů</span>';
    if(!observed.length){
      svgChartEmpty('#mediaChart-'+utility,'Zatím nejsou dostupné odečty.',W,H);
      return;
    }
    const first=observed[0].day,last=observed[observed.length-1].day;
    const scaleMax=Math.max(0.001,total*1.12);
    const plotW=W-left-right,plotH=H-top-bottom;
    const x=day=>first===last?left+plotW/2:left+(day-first)/(last-first)*plotW;
    const y=value=>top+plotH-(value/scaleMax)*plotH;
    const grid=[];
    for(let i=0;i<=4;i++){
      const val=scaleMax*(1-i/4),gy=top+plotH*i/4;
      grid.push('<line class="svg-grid-line" x1="'+left+'" x2="'+(W-right)+'" y1="'+gy+'" y2="'+gy+'"></line>');
      grid.push('<text class="svg-axis-text" x="'+(left-9)+'" y="'+(gy+4)+'" text-anchor="end">'+svgSafe(nf.format(val))+'</text>');
    }
    let cumulative=0,lastCovered=null,path='',markers='';
    for(const d of days){
      if(!d.has_allocation?.[utility]){lastCovered=null;continue;}
      cumulative+=Number(d.measured?.[utility]||0);
      const xx=x(d.day),yy=y(cumulative);
      path+=(lastCovered===d.day-1?' L ':' M ')+xx.toFixed(2)+' '+yy.toFixed(2);
      lastCovered=d.day;
      if(Number(d.readings?.[utility]||0)>0){
        markers+='<circle cx="'+xx+'" cy="'+yy+'" r="4.5" style="fill:'+meta.color+'"><title>'+
          svgSafe(d.date+' · kumulativně '+nf.format(cumulative)+' '+meta.unit)+'</title></circle>';
      }
    }
    const labelStep=Math.max(1,Math.ceil((last-first+1)/9));
    const labels=observed.filter(d=>d.day===first||d.day===last||(d.day-first)%labelStep===0).map(d=>
      '<text class="svg-axis-text" x="'+x(d.day)+'" y="'+(H-12)+'" text-anchor="middle">'+d.day+'</text>').join('');
    svg.innerHTML='<rect class="svg-chart-bg" x="0" y="0" width="'+W+'" height="'+H+'"></rect>'+
      grid.join('')+
      '<path class="svg-media-line" d="'+path+'" style="stroke:'+meta.color+'"></path>'+
      markers+labels+
      '<text class="svg-unit-label" x="'+left+'" y="14">'+svgSafe(meta.unit)+' · KUMULATIVNĚ</text>';
  }

  let requestedKey='';
  async function refreshMonth() {
    if (!STATE) return;
    const state=STATE,month=picker.value;
    const key=month+'@'+serial;
    if(pending===key)return;
    pending=key;
    try {
      const [actualResult,historyResult]=await Promise.allSettled([
        api('/api/month-actual?month='+encodeURIComponent(month)),
        api('/api/insights?month='+encodeURIComponent(month))
      ]);
      if(actualResult.status==='rejected')throw actualResult.reason;
      if(state===STATE && picker.value===month && pending===key) {
        displayed=actualResult.value;
        history=historyResult.status==='fulfilled'?historyResult.value:null;
        renderDashboard();
        if(historyResult.status==='rejected')
          toast('Historické grafy nejsou dostupné: '+historyResult.reason.message);
      }
    } catch(err) {
      if(pending===key) {
        $('#financePeriodNote').textContent=err.message;
        toast(err.message);
      }
    } finally {
      if(pending===key)pending=null;
    }
  }

  renderDashboard = function(){
    if(!STATE)return;
    if(stateIdentity!==STATE){
      stateIdentity=STATE;displayed=null;history=null;serial++;
    }
    if(!picker.value) picker.value=STATE.dashboard.latest?.month||currentLocalIsoDate().slice(0,7);
    if(!displayed || displayed.month!==picker.value) {
      for(const [, [selector]] of Object.entries(byUtility))$(selector).textContent='—';
      $('#kpiCost').textContent='—';
      drawFinancialPosition(null);
      for(const u of utilities) {
        svgChartEmpty('#mediaChart-'+u,'Načítám skutečné odečty…',760,240);
        $('#mediaStat-'+u).textContent='';
      }
      const other=['costChart','usageChart','applianceChart','cashflowChart','balanceTrendChart',
        'heatingTrendChart','expenseTreeChart','waterfallChart','costSankey'];
      for(const id of other)svgChartEmpty('#'+id,'Načítám data za měsíc…',id==='expenseTreeChart'||id==='waterfallChart'||id==='costSankey'?960:760,280);
      refreshMonth();
      return;
    }
    monthOverview(displayed);
  };
  $('#insightRange')?.addEventListener('change',()=>{if(history)window.EnergyInsights?.renderHistory(history);});
  $('#heatRoomFilter')?.addEventListener('change',()=>{if(history)window.EnergyInsights?.renderHistory(history);});
  picker.addEventListener('change',()=>{
    displayed=null;history=null;serial++;pending=null;
    if(STATE)renderDashboard();
  });
})();
