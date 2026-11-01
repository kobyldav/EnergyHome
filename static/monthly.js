/* Month-first evidence-only dashboard extension.
   Included after app.js so legacy pages/forms stay compatible. */
(() => {
  let displayed = null;
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
  const noProjection = 'Bez predikcí: započítávají se pouze rozdíly mezi skutečně zadanými odečty uvnitř měsíce. Intervaly přes hranici měsíce nelze bez dalšího odečtu přesně rozdělit.';
  const statusText = (v, utility) => {
    const status = v.status?.[utility];
    if (status === 'complete') return 'Úplný měsíc potvrzený odečty';
    if (status === 'to_date') return 'Potvrzeno k ' + (v.coverage[utility]?.map(x=>x.to).sort().at(-1)||v.as_of);
    if (status === 'partial') return 'Jen potvrzené intervaly – část měsíce chybí';
    return 'Chybí dva navazující odečty v měsíci';
  };

  // Advance amounts in the app are configured monthly rules, not bank payments.
  drawFinancialPosition = function(b) {
    $('#billingPeriod').textContent = b ? monthName(b.month) : '—';
    $('#currentBalance').textContent = b ? money(b.balance) : '—';
    $('#paidTotal').textContent = b ? money(b.advance) : '—';
    $('#actualCost').textContent = b ? money(b.total_cost) : '—';
    $('#paidTotalLabel').textContent = 'Předepsané zálohy (nikoli potvrzené platby)';
    $('#financePeriodNote').textContent = b
      ? 'Pouze potvrzená spotřeba + časově příslušné fixní poplatky dle ceníku. Nejde o částku z faktury; zálohy nejsou ověřené platby.'
      : 'Vyberte měsíc pro zobrazení doložených hodnot.';
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
    const m = {
      ...v, fixed_cost:Object.values(v.fixed_costs).reduce((a,b)=>a+Number(b||0),0),
      unassigned:Object.fromEntries(utilities.map(u=>[u,Number(v.measured[u]||0)])),
      passive:Object.fromEntries(utilities.map(u=>[u,0])),
      active:Object.fromEntries(utilities.map(u=>[u,0]))
    };
    const canMeasure = utilities.some(u=>v.status[u]!=='missing');
    $('#emptyHint').classList.toggle('hidden',canMeasure);
    if (!canMeasure) $('#emptyHint').innerHTML =
      '<strong>Pro '+escapeHtml(monthName(v.month))+' chybí potvrzený rozdíl odečtů.</strong> Zadejte stavy měřidel v tomto měsíci; pro úplnou měsíční spotřebu také stav k poslednímu dni předchozího měsíce a poslednímu dni vybraného měsíce.';
    for (const [u, [selector,unit]] of Object.entries(byUtility)) {
      $(selector).textContent = v.measured[u] == null ? '—' : nf.format(v.measured[u])+' '+unit;
      const note = $('#kpiNote-'+u);
      if (note) note.textContent = statusText(v,u);
    }
    $('#kpiCost').textContent = money(v.total_cost);
    $('#kpiMonth').textContent = monthName(v.month) + (v.as_of && v.as_of < v.end ? ' · k '+v.as_of : '');
    drawFinancialPosition(v);
    const notes = [];
    notes.push({severity:'info',text:noProjection});
    if (utilities.some(u=>v.status[u]==='partial'))
      notes.push({severity:'warning',text:'Některé odečty pokrývají jen část zvoleného měsíce. Součet není jeho celková spotřeba.'});
    if (STATE.dashboard?.finance_notes?.heat_definition_provisional)
      notes.push({severity:'info',text:'Radiátorové dílky nejsou jednotky GJ a náklady na teplo mohou vyžadovat vyúčtování.'});
    if (STATE.dashboard?.contract_review?.due)
      notes.push({severity:'warning',text:'Je čas zkontrolovat platnost smluv a ceníků.'});
    $('#alerts').innerHTML = notes.map(n=>'<div class="alert '+n.severity+'"><span>'+escapeHtml(n.text)+'</span></div>').join('');

    drawCostChart([m]);
    // Appliance share is only a configured model, never an actual device reading.
    svgChartEmpty('#usageChart','Rozdělení podle spotřebičů nelze ověřit bez jejich samostatných měřidel.',760,280);
    svgChartEmpty('#applianceChart','Odhady spotřebičů jsou skryté. Zde se zobrazují jen ověřitelné odečty.',760,300);
    drawCashflowChart([m]);
    drawBalanceTrendChart([m]);
    drawHeatingTrendChart([m]);
    drawExpenseTreeChart([m],{start:v.month,end:v.month});
    drawWaterfall(b);
    renderCostSankey([m]);
    renderMonthHeat(v);
    for (const u of utilities) drawActualReadingChart(u,v);
  }

  function renderMonthHeat(v){
    const box=$('#heatAllocatorDashboard');
    const heat=v.events?.heat||[];
    const entities=STATE.data.heat_allocators||[];
    if(!entities.length) {
      box.innerHTML='<p class="help">Zatím nejsou založené radiátorové měřiče.</p>';
      return;
    }
    const grouped=new Map();
    for(const item of heat) {
      const found=entities.find(e=>e.name===item.name);
      const room=found?.room||'Bez místnosti';
      const row=grouped.get(room)||{room, amount:0, count:0};
      row.amount+=Number(item.amount||0);row.count++;grouped.set(room,row);
    }
    if(!heat.length){
      box.innerHTML='<p class="help">V tomto měsíci nejsou potvrzené přírůstky mezi dvěma odečty radiátorových měřičů.</p>';
      return;
    }
    box.innerHTML='<div class="table-wrap dashboard-table"><table><thead><tr><th>Místnost</th><th>Potvrzené odečty</th><th>Naměřený přírůstek</th></tr></thead><tbody>'+
      [...grouped.values()].map(r=>'<tr><td>'+escapeHtml(r.room)+'</td><td>'+r.count+'</td><td>'+nf.format(r.amount)+' jedn.</td></tr>').join('')+
      '</tbody></table></div>';
  }

  function drawActualReadingChart(utility,v){
    const svg=$('#mediaChart-'+utility),stat=$('#mediaStat-'+utility);
    if(!svg||!stat)return;
    const events=(v.events?.[utility]||[]).filter(x=>x.date<=currentLocalIsoDate())
      .sort((a,b)=>a.date.localeCompare(b.date));
    const meta=utilitySvgMeta[utility],W=760,H=240,left=82,right=26,top=30,bottom=45;
    const total=events.reduce((s,e)=>s+Number(e.amount||0),0);
    stat.innerHTML = events.length
      ? '<span><b>'+nf.format(total)+'</b> '+svgSafe(meta.unit)+'</span><span>'+events.length+' potvrzených intervalů</span>'
      : '<span>Bez potvrzených odečtů</span>';
    if(!events.length) {
      svgChartEmpty('#mediaChart-'+utility,'Bez navazujících odečtů ve vybraném měsíci.',W,H);
      return;
    }
    const max=Math.max(0.001,total*1.15),lastDay=Math.max(1,...events.map(x=>Number(x.date.slice(-2))));
    const g=svgYAxis(W,H,0,max,left,right,top,bottom,v=>nf.format(v));
    const x=day=>lastDay===1?left+g.plotW/2:left+(day-1)/Math.max(1,lastDay-1)*g.plotW;
    let cumulative=0,graph='M '+x(1)+' '+g.y(0),markers='';
    for(const e of events){
      const day=Number(e.date.slice(-2));
      const xx=x(day);
      graph+=' H '+xx;
      cumulative+=Number(e.amount||0);
      graph+=' V '+g.y(cumulative);
      const tip=e.name+': '+e.from+' → '+e.date+' · '+nf.format(e.amount)+' '+meta.unit;
      markers+='<circle cx="'+xx+'" cy="'+g.y(cumulative)+'" r="5" class="svg-reading-marker" style="fill:'+meta.color+'"><title>'+svgSafe(tip)+'</title></circle>';
    }
    const ticks=[...new Set([1,...events.map(e=>Number(e.date.slice(-2)))])];
    svg.innerHTML='<rect class="svg-chart-bg" x="0" y="0" width="'+W+'" height="'+H+'"></rect>'+
      g.grid+'<path class="svg-media-line" d="'+graph+'" style="stroke:'+meta.color+'"></path>'+markers+
      ticks.map(day=>'<text class="svg-axis-text" x="'+x(day)+'" y="'+(H-12)+'" text-anchor="middle">'+day+'</text>').join('')+
      '<text class="svg-unit-label" x="'+left+'" y="15">'+svgSafe(meta.unit)+' · ODEČTY</text>';
  }

  let requestedKey='';
  async function refreshMonth() {
    if (!STATE) return;
    const state=STATE,month=picker.value;
    const key=month+'@'+serial;
    if(pending===key)return;
    pending=key;
    try {
      const next=await api('/api/month-actual?month='+encodeURIComponent(month));
      if(state===STATE && picker.value===month && pending===key) {
        displayed=next;
        renderDashboard();
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
      stateIdentity=STATE;displayed=null;serial++;
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
  picker.addEventListener('change',()=>{
    displayed=null;serial++;pending=null;
    if(STATE)renderDashboard();
  });
})();
