/* Month-first evidence-only dashboard extension.
   Included after app.js so legacy pages/forms stay compatible. */
(() => {
  let displayed = null;
  let mediaMode = 'cumulative';
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
    if (utility==='heat' && v.coverage?.heat?.some(entry=>entry.assumed_zero))
      return 'Spotřeba radiátorů · vypnuté jsou nastavené na 0';
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
      current_balance:v.balance,as_of:v.as_of,cost_incomplete:v.cost_incomplete
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
      notes.push({severity:'info',text:'Neúplná data: '+missing.join('; ')+
        '. Některé dny nemají navazující odečty. Součet obsahuje pouze skutečně pokryté intervaly, ne předpověď za chybějící dny.'});
    }


    if (STATE.dashboard?.contract_review?.due)
      notes.push({severity:'warning',text:'Je čas zkontrolovat platnost smluv a ceníků.'});
    $('#alerts').innerHTML = notes.map(n=>'<div class="alert '+n.severity+'"><span>'+escapeHtml(n.text)+'</span></div>').join('');

    // Appliance share is only a configured model, never an actual device reading.
    window.EnergyInsights?.renderAll(v,history);
    // Historical finance lines are rendered by EnergyInsights from neighbor months.

    drawExpenseTreeChart([m],{start:v.month,end:v.month});
    // The waterfall compares equal date ranges, independently of the
    // month-to-today KPI cards. Never reuse their mixed-period totals.
    const settlement=v.settlement;
    if(settlement?.available){
      drawWaterfall({start:settlement.start,end:settlement.end,as_of:settlement.as_of,
        paid:settlement.advance,actual_cost:settlement.total_cost,current_balance:settlement.balance,
        cost_incomplete:settlement.cost_incomplete,aligned:true,heat_provisional:settlement.heat_provisional},[settlement]);
    }else{
      svgChartEmpty('#waterfallChart',settlement?.reason||'Chybí srovnatelné odečty.',960,350);
    }
    renderCostSankey([m]);
    renderMonthHeat(v);
    renderMediaDetail(v);
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
      '<tr><td>'+escapeHtml(d.room)+'</td><td>'+escapeHtml(d.name)+
      (d.assumed_zero?' · vypnutý':'')+'</td><td><b>'+nf.format(d.amount)+' jedn.</b>'+
      (d.assumed_zero?' (nastaveno)':'')+'</td></tr>').join('');
    box.innerHTML='<div class="table-wrap dashboard-table"><table><thead><tr><th>Místnost</th><th>Radiátory</th><th>Spotřeba za vybraný měsíc</th></tr></thead><tbody>'+
      roomRows+'</tbody></table></div>'+
      '<h3 class="heat-interval-heading">Jednotlivé radiátory</h3>'+
      '<div class="table-wrap dashboard-table"><table><thead><tr><th>Místnost</th><th>Měřič</th><th>Rozpočítané dílky</th></tr></thead><tbody>'+
      rows+'</tbody></table></div>';
  }

  const mediaPriceKeys={electricity:'electricity_per_kwh',cold_water:'cold_water_per_m3',
    hot_water:'hot_water_per_m3',gas:'gas_per_m3',heat:'heat_per_gj'};
  const mediaFixedKeys={electricity:'electricity_fixed_monthly',cold_water:'cold_water_fixed_monthly',
    hot_water:'hot_water_fixed_monthly',gas:'gas_fixed_monthly',heat:'heat_fixed_monthly'};
  const mediaUnit=(u,v)=>u==='heat'&&v?.heat_cost_estimate?.mode==='metered_gj'?'GJ':utilitySvgMeta[u].unit;
  function mediaCostInfo(u,v){
    const fixed=Number(v.fixed_costs?.[u]||0), variable=Number(v.variable_costs?.[u]||0);
    const measured=v.measured?.[u]!=null&&v.status?.[u]!=='missing';
    const tariffKnown=Boolean(v.tariff?.effective_from&&v.tariff.effective_from!=='0000-00-00');
    const unpriced=u==='heat'&&v.cost_incomplete;
    const fixedKnown=fixed!==0||(tariffKnown&&measured)||(tariffKnown&&Number(v.tariff?.[mediaFixedKeys[u]]||0)!==0);
    const variableKnown=!unpriced&&measured&&(variable!==0||(tariffKnown&&Number(v.tariff?.[mediaPriceKeys[u]]||0)>0));
    const known=fixedKnown||variableKnown;
    const partial=unpriced||(known&&Number(v.tariff?.[mediaPriceKeys[u]]||0)>0&&v.status?.[u]!=='complete'&&v.status?.[u]!=='to_date')||(fixedKnown&&measured&&!variableKnown&&Number(v.measured?.[u])>0);
    return {fixed,variable,fixedKnown,variableKnown,known,partial,total:fixed+variable};
  }
  function mediaStatus(u,v){
    if(u==='heat'&&v.coverage?.heat?.some(entry=>entry.assumed_zero)&&v.status?.heat==='complete')return 'Včetně vypnutých radiátorů';
    return ({complete:'Úplné odečty',to_date:'Průběžné odečty',partial:'Částečné odečty',missing:'Bez odečtů'})[v.status?.[u]]||'Bez odečtů';
  }
  function updateMediaMode(){
    for(const [id,mode] of [['mediaModeCumulative','cumulative'],['mediaModeDaily','daily']]){
      const btn=$('#'+id),active=mediaMode===mode;
      btn?.classList.toggle('active',active);
      btn?.setAttribute('aria-pressed',String(active));
    }
  }
  function mediaDays(v){
    return (v.days||[]).filter(d=>d.date<=currentLocalIsoDate()&&(!v.as_of||d.date<=v.as_of));
  }
  function mediaLastDay(v){
    return mediaDays(v).reduce((last,d)=>utilities.some(u=>d.has_allocation?.[u])?Math.max(last,d.day):last,0);
  }
  function renderMediaDetail(v){
    $('#mediaDetailMonth').textContent=monthName(v.month);
    for(const u of utilities){
      const value=v.measured?.[u],cost=mediaCostInfo(u,v);
      $('#mediaValue-'+u).textContent=value==null?'—':nf.format(value)+' '+mediaUnit(u,v);
      $('#mediaCost-'+u).textContent=cost.known?money(cost.total)+(cost.partial?' · neúplné':''):'— Kč';
      $('#mediaStatus-'+u).textContent=mediaStatus(u,v);
      drawActualReadingChart(u,v);
    }
    updateMediaMode();
  }
  function chooseMediaMode(mode){
    mediaMode=mode;updateMediaMode();
    if(displayed)for(const u of utilities)drawActualReadingChart(u,displayed);
  }
  // Daily allocations and cumulative totals use the same observed intervals.
  function drawActualReadingChart(utility,v){
    const svg=$('#mediaChart-'+utility),stat=$('#mediaStat-'+utility);
    if(!svg||!stat)return;
    const days=mediaDays(v);
    const observed=days.filter(d=>Boolean(d.has_allocation?.[utility]));
    const meta=utilitySvgMeta[utility],unit=mediaUnit(utility,v),W=520,H=190,left=58,right=17,top=22,bottom=28;
    const total=observed.reduce((sum,d)=>sum+Number(d.measured?.[utility]||0),0);
    const count=days.reduce((sum,d)=>sum+Number(d.readings?.[utility]||0),0);
    const cost=mediaCostInfo(utility,v);
    const safe=svgSafe;
    const metrics=[
      ['Průměr / pokrytý den',observed.length?nf.format(total/observed.length)+' '+unit:'—'],
      ['Fixní / proměnlivé',(cost.fixedKnown?money(cost.fixed):'—')+' / '+(cost.variableKnown?money(cost.variable):'—')],
      ['Pokryté dny / odečty',observed.length?observed.length+' / '+days.length+' · '+count:'— / '+count]
    ];
    stat.innerHTML=metrics.map(([label,value])=>'<div class="media-metric"><small>'+safe(label)+'</small><strong>'+safe(value)+'</strong></div>').join('');
    if(!observed.length){
      svgChartEmpty('#mediaChart-'+utility,'Zatím nejsou dostupné odečty.',W,H);
      return;
    }
    // All media use the same calendar domain for direct comparison. Never extend past observed data.
    const first=1,last=Math.max(1,mediaLastDay(v));
    const daily=mediaMode==='daily';
    const plotW=W-left-right,plotH=H-top-bottom,base=H-bottom;
    const values=observed.map(d=>Number(d.measured?.[utility]||0));
    const highest=daily?Math.max(...values):total;
    const scaleMax=highest>0?highest*1.12:1;
    const dayWidth=plotW/Math.max(1,last-first+1);
    const x=day=>left+(day-first+.5)*dayWidth;
    const y=value=>base-value/scaleMax*plotH;
    let grid='',labels='',path='',markers='',bars='',fills='',hits='',cumulative=0,lastCovered=null,segment=[];
    const axisFmt=new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:scaleMax<.1?4:scaleMax<10?2:1});
    for(let i=0;i<=4;i++){
      const val=scaleMax*(1-i/4),gy=top+plotH*i/4;
      grid+='<line class="svg-grid-line" x1="'+left+'" x2="'+(W-right)+'" y1="'+gy+'" y2="'+gy+'"></line>'+
        '<text class="svg-axis-text" x="'+(left-9)+'" y="'+(gy+4)+'" text-anchor="end">'+safe(axisFmt.format(val))+'</text>';
    }
    function closeArea(){
      if(segment.length>1)fills+='<path d="M '+segment[0][0]+' '+base+' L '+segment.map(p=>p.join(' ')).join(' L ')+' L '+segment[segment.length-1][0]+' '+base+' Z" fill="'+meta.soft+'" opacity=".65"></path>';
      segment=[];
    }
    for(const d of days){
      if(!d.has_allocation?.[utility]){lastCovered=null;closeArea();continue;}
      const increment=Number(d.measured?.[utility]||0);
      cumulative+=increment;
      const xx=x(d.day),yy=y(daily?increment:cumulative);
      if(daily){
        bars+='<rect x="'+(xx-dayWidth*.34)+'" y="'+yy+'" width="'+(dayWidth*.68)+'" height="'+Math.max(0,base-yy)+'" rx="2" fill="'+meta.color+'" opacity=".85"></rect>';
      }else{
        const connected=lastCovered===d.day-1;
        path+=(connected?' L ':' M ')+xx.toFixed(2)+' '+yy.toFixed(2);
        if(!connected)closeArea();
        segment.push([xx,yy]);
        const next=days.find(row=>row.day===d.day+1);
        if(Number(d.readings?.[utility]||0)>0||!connected||!next?.has_allocation?.[utility])
          markers+='<circle cx="'+xx+'" cy="'+yy+'" r="'+(Number(d.readings?.[utility]||0)>0?4:2.5)+'" fill="'+meta.color+'" stroke="white" stroke-width="1.3"></circle>';
      }
      lastCovered=d.day;
      const title=d.date+' · '+nf.format(increment)+' '+unit+' / den · '+nf.format(cumulative)+' '+unit+' celkem'+
        (d.estimated?.[utility]?' · rozpočítáno mezi odečty':'');
      hits+='<rect x="'+(xx-dayWidth/2)+'" y="'+top+'" width="'+dayWidth+'" height="'+plotH+'" fill="transparent" pointer-events="all"><title>'+safe(title)+'</title></rect>';
    }
    closeArea();
    const step=Math.max(1,Math.ceil((last-first+1)/7));
    for(let day=first;day<=last;day++){
      if(day!==first&&day!==last&&(day-first)%step!==0)continue;
      labels+='<text class="svg-axis-text" x="'+x(day)+'" y="'+(H-12)+'" text-anchor="middle">'+day+'</text>';
    }
    svg.innerHTML='<rect class="svg-chart-bg" x="0" y="0" width="'+W+'" height="'+H+'"></rect>'+
      grid+(daily?bars:fills+'<path class="svg-media-line" d="'+path+'" style="stroke:'+meta.color+'"></path>'+markers)+labels+hits+
      '<text class="svg-unit-label" x="'+left+'" y="14">'+safe(unit+(daily?' / den':' · kumulativně'))+'</text>';
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
        svgChartEmpty('#mediaChart-'+u,'Načítám skutečné odečty…',520,190);
        $('#mediaStat-'+u).textContent='';
        $('#mediaValue-'+u).textContent='—';
        $('#mediaCost-'+u).textContent='—';
        $('#mediaStatus-'+u).textContent='Načítám…';
      }
      $('#mediaDetailMonth').textContent=monthName(picker.value);
      updateMediaMode();
      const other=['costChart','usageChart','applianceChart','cashflowChart','balanceTrendChart',
        'heatingTrendChart','expenseTreeChart','waterfallChart','costSankey'];
      for(const id of other)svgChartEmpty('#'+id,'Načítám data za měsíc…',id==='expenseTreeChart'||id==='waterfallChart'||id==='costSankey'?960:760,id==='expenseTreeChart'?320:id==='waterfallChart'?350:280);
      refreshMonth();
      return;
    }
    monthOverview(displayed);
  };
  $('#mediaModeCumulative')?.addEventListener('click',()=>chooseMediaMode('cumulative'));
  $('#mediaModeDaily')?.addEventListener('click',()=>chooseMediaMode('daily'));
  $('#financeChartMode')?.addEventListener('change',()=>{if(history)window.EnergyInsights?.renderFinancial(history);});
  $('#insightRange')?.addEventListener('change',()=>{if(history)window.EnergyInsights?.renderHistory(history);});
  $('#heatRoomFilter')?.addEventListener('change',()=>{if(history)window.EnergyInsights?.renderHistory(history);});
  $('#applianceFocus')?.addEventListener('change',()=>{if(history)window.EnergyInsights?.renderHistory(history);});
  picker.addEventListener('change',()=>{
    displayed=null;history=null;serial++;pending=null;
    if(STATE)renderDashboard();
  });
})();
