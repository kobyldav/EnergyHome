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
    $('#kpiCost').textContent = money(v.total_cost);
    $('#kpiMonth').textContent = monthName(v.month) + (v.as_of && v.as_of < v.end ? ' · k '+v.as_of : '');
    drawFinancialPosition(v);
    const notes = [];

    if (utilities.some(u=>v.status[u]==='partial'))
      notes.push({severity:'warning',text:'Některé odečty pokrývají jen část zvoleného měsíce. Součet není jeho celková spotřeba.'});


    if (STATE.dashboard?.contract_review?.due)
      notes.push({severity:'warning',text:'Je čas zkontrolovat platnost smluv a ceníků.'});
    $('#alerts').innerHTML = notes.map(n=>'<div class="alert '+n.severity+'"><span>'+escapeHtml(n.text)+'</span></div>').join('');

    drawCostChart([m]);
    // Appliance share is only a configured model, never an actual device reading.
    drawElectricIntervals(v);
    drawElectricMeters(v);
    drawCashflowChart([m]);
    drawBalanceTrendChart([m]);
    drawHeatingTrendChart([m]);
    drawExpenseTreeChart([m],{start:v.month,end:v.month});
    drawWaterfall(b);
    renderCostSankey([m]);
    renderMonthHeat(v);
    for (const u of utilities) drawActualReadingChart(u,v);
  }

  // The bars show actual between-reading deltas, not estimated appliance use.
  function drawElectricIntervals(v){
    const svg=$('#usageChart'),W=760,H=280,left=82,right=24,top=38,bottom=49;
    const grouped=new Map();
    for(const e of (v.events?.electricity||[])){
      const key=e.date;
      grouped.set(key,(grouped.get(key)||0)+Number(e.amount||0));
    }
    const rows=[...grouped].sort((a,b)=>a[0].localeCompare(b[0]));
    if(!rows.length){svgChartEmpty('#usageChart','Nejsou potvrzené přírůstky elektřiny za měsíc.',W,H);return;}
    const max=Math.max(0.001,...rows.map(r=>r[1]));
    const g=svgYAxis(W,H,0,max*1.08,left,right,top,bottom,val=>nf.format(val)+' kWh');
    const slot=g.plotW/rows.length,bw=Math.min(48,slot*.55);
    const bars=rows.map(([day,value],i)=>{
      const cx=left+(i+.5)*slot,hh=value/(max*1.08)*g.plotH;
      const label=rows.length<=10||i%Math.max(1,Math.ceil(rows.length/10))===0 ? day.slice(-2)+'.' : '';
      return '<rect class="svg-bar-primary" x="'+(cx-bw/2)+'" y="'+(g.base-hh)+'" width="'+bw+'" height="'+hh+'"><title>'+svgSafe(day)+' · '+svgSafe(nf.format(value))+' kWh</title></rect>'+
        (label?'<text class="svg-axis-text" x="'+cx+'" y="'+(H-15)+'" text-anchor="middle">'+label+'</text>':'');
    }).join('');
    svg.innerHTML='<rect class="svg-chart-bg" x="0" y="0" width="'+W+'" height="'+H+'"></rect>'+g.grid+bars+
      '<text class="svg-unit-label" x="'+left+'" y="18">Z ROZDÍLŮ ODEČTŮ</text>';
  }

  function drawElectricMeters(v){
    const svg=$('#applianceChart'),W=760,H=300,left=205,right=95,top=31;
    const grouped=new Map();
    for(const e of (v.events?.electricity||[])){
      const key=e.id||e.name;
      const current=grouped.get(key)||{name:e.name,amount:0};
      current.amount+=Number(e.amount||0);
      grouped.set(key,current);
    }
    const rows=[...grouped.values()].sort((a,b)=>b.amount-a.amount);
    if(!rows.length){svgChartEmpty('#applianceChart','Bez potvrzených odečtů elektroměrů.',W,H);return;}
    const max=Math.max(0.001,...rows.map(r=>r.amount));
    const rh=Math.min(35,(H-top-18)/rows.length),width=W-left-right;
    const lines=rows.slice(0,8).map((r,i)=>{
      const y=top+i*rh,barWidth=width*r.amount/max;
      return '<text class="svg-category-label" x="'+(left-12)+'" y="'+(y+17)+'" text-anchor="end">'+svgSafe(r.name)+'</text>'+
        '<rect x="'+left+'" y="'+(y+4)+'" width="'+barWidth+'" height="21" class="svg-bar-primary"><title>'+svgSafe(r.name)+' · '+nf.format(r.amount)+' kWh</title></rect>'+
        '<text class="svg-value-label" x="'+Math.min(W-85,left+barWidth+8)+'" y="'+(y+19)+'">'+nf.format(r.amount)+' kWh</text>';
    }).join('');
    svg.innerHTML='<rect class="svg-chart-bg" x="0" y="0" width="'+W+'" height="'+H+'"></rect>'+lines;
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
