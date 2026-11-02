/* EnergyHome insights: reading-backed time series and separate appliance models.
   All input arrives from the locally hosted EnergyHome backend; no external API. */
window.EnergyInsights = (() => {
  const colors = {
    measured: '#176f64',
    passive: '#799fba',
    active: '#c28b45',
    other: '#7d858c',
    heat: '#937454',
    area: '#dcece8'
  };
  const svg = (v) => svgSafe(String(v));
  const labelMonth = (month) => month.slice(5) + '/' + month.slice(2,4);
  const number = (n) => nf.format(n);
  const range = () => Number(document.querySelector('#insightRange')?.value || 12);
  const axis = (W,H,max,unit,margin) => {
    const left = margin || 76, right = 18, top = 54, bottom = 39;
    const base = H-bottom, height=base-top, width=W-right-left;
    const y = value => base - Math.max(0,value)/max*height;
    const x = (i,n) => n <= 1 ? left+width/2 : left+width*i/(n-1);
    let grid='';
    for(let i=0;i<=4;i++){
      const yy=top+height*i/4,v=max*(1-i/4);
      grid+='<line class="svg-grid-line" x1="'+left+'" y1="'+yy+'" x2="'+(W-right)+'" y2="'+yy+'"></line>'+
        '<text class="svg-axis-text" x="'+(left-9)+'" y="'+(yy+4)+'" text-anchor="end">'+
          svg(number(v))+'</text>';
    }
    const baseSVG='<rect class="svg-chart-bg" x="0" y="0" width="'+W+'" height="'+H+'"></rect>'+grid+
      '<text class="svg-unit-label" x="'+left+'" y="17">'+svg(unit)+'</text>';
    return {x,y,base,baseSVG,left,width,height,top};
  };
  const legend = (items, left=84) => items.map((it,i)=> {
    const x=left+i*153;
    return '<line x1="'+x+'" y1="32" x2="'+(x+19)+'" y2="32" stroke="'+it.color+'" stroke-width="3"></line>'+
      '<text class="svg-axis-text" x="'+(x+26)+'" y="36">'+svg(it.label)+'</text>';
  }).join('');
  const line = (values, valid, axis, color, dash='') => {
    let d='',previous=false;
    values.forEach((v,i)=>{
      if(!valid[i] || !Number.isFinite(v)){previous=false;return;}
      d+=(previous?' L ':' M ')+axis.x(i,values.length).toFixed(2)+' '+axis.y(v).toFixed(2);
      previous=true;
    });
    return d ? '<path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"'+(dash?' stroke-dasharray="'+dash+'"':'')+'></path>' : '';
  };
  const dots = (rows, values, valid, axis, color, label, unit) => values.map((v,i)=>{
    if(!valid[i]||!Number.isFinite(v))return '';
    const cx=axis.x(i,values.length),cy=axis.y(v);
    return '<circle cx="'+cx+'" cy="'+cy+'" r="3" fill="'+color+'"><title>'+
      svg(rows[i].label+' · '+label+': '+number(v)+' '+unit)+'</title></circle>';
  }).join('');
  const labels = (rows, axis, limit=9) => {
    const step=Math.max(1,Math.ceil(rows.length/limit));
    return rows.map((r,i)=>{
      if(i%step!==0 && i!==rows.length-1)return '';
      return '<text class="svg-axis-text" x="'+axis.x(i,rows.length)+'" y="274" text-anchor="middle">'+svg(r.short)+'</text>';
    }).join('');
  };

  function current(history, month) {
    return history?.months?.find(x=>x.month===month) || null;
  }

  function renderDaily(monthData, history){
    const target=document.querySelector('#usageChart');
    if(!target)return;
    const currentMonth=current(history,monthData.month);
    const days=(monthData.days||[]).filter(d=>d.date<=currentLocalIsoDate());
    const observed=days.map(d=>Boolean(d.has_allocation?.electricity));
    if(!observed.some(Boolean)){
      svgChartEmpty('#usageChart','Pro vybraný měsíc chybí navazující odečty elektroměru.',760,280);
      return;
    }
    const passiveRate=(currentMonth?.appliances||[]).filter(a=>a.kind==='passive')
      .reduce((sum,a)=>sum+Number(a.daily_kwh||0),0);
    const activeRate=(currentMonth?.appliances||[]).filter(a=>a.kind==='active')
      .reduce((sum,a)=>sum+Number(a.daily_kwh||0),0);
    const measured=days.map(d=>Number(d.measured?.electricity||0));
    const passive=days.map(()=>passiveRate);
    const active=days.map(()=>activeRate);
    const other=days.map((d,i)=>Math.max(0,measured[i]-passive[i]-active[i]));
    const max=Math.max(0.02,...measured.filter((_,i)=>observed[i]),
      ...(passiveRate>0?[passiveRate]:[]),...(activeRate>0?[activeRate]:[]))*1.18;
    const chart=axis(760,280,max,'kWh / den',86);
    const rows=days.map(d=>({label:d.date,short:String(d.day)}));
    target.innerHTML=chart.baseSVG+
      legend([{label:'Elektroměr',color:colors.measured},
              {label:'Trvalé (profil)',color:colors.passive},
              {label:'Cyklické (profil)',color:colors.active},
              {label:'Ostatní',color:colors.other}],86)+
      line(measured,observed,chart,colors.measured)+
      (passiveRate>0?line(passive,observed,chart,colors.passive,'5 4'):'')+
      (activeRate>0?line(active,observed,chart,colors.active,'5 4'):'')+
      line(other,observed,chart,colors.other,'3 4')+
      dots(rows,measured,observed,chart,colors.measured,'Elektroměr','kWh')+
      labels(rows,chart,9);
    const note=document.querySelector('#usageChartNote');
    if(note){
      const passiveNames=(currentMonth?.appliances||[]).filter(a=>a.kind==='passive').map(a=>a.name);
      const activeNames=(currentMonth?.appliances||[]).filter(a=>a.kind==='active').map(a=>a.name);
      const excess=measured.some((v,i)=>observed[i] && passiveRate+activeRate>v+0.001);
      note.textContent='Plná čára: elektroměr. Trvalé: '+(passiveNames.join(', ')||'žádné zadané')+
        '. Cyklické: '+(activeNames.join(', ')||'žádné zadané')+
        '. Přerušované čáry jsou profilové odhady (aktivní cykly rovnoměrně za měsíc), nikoli měření jednotlivých spotřebičů. Bez odečtů se nepředpovídá.'+
        (excess?' V některých dnech model spotřebičů převyšuje celkový odečet; do měřené spotřeby se nepřičítá.':'');
    }
  }

  function renderElectricHistory(history){
    const target=document.querySelector('#applianceChart');
    if(!target)return;
    const list=(history?.months||[]).slice(-range());
    if(!list.some(m=>m.electricity_kwh!==null&&m.electricity_kwh!==undefined)){
      svgChartEmpty('#applianceChart','Zatím chybí měřené měsíční údaje o elektřině.',760,300);
      return;
    }
    const valid=list.map(m=>m.electricity_kwh!==null&&m.electricity_kwh!==undefined);
    const measured=list.map(m=>Number(m.electricity_kwh||0));
    const passive=list.map(m=>Math.min(Number(m.passive_kwh||0),Number(m.electricity_kwh||0)));
    const active=list.map((m,i)=>Math.min(Number(m.active_kwh||0),Math.max(0,measured[i]-passive[i])));
    const other=list.map((m,i)=>Math.max(0,measured[i]-passive[i]-active[i]));
    const focus=document.querySelector('#applianceFocus')?.value||'all';
    const selectedProfile=focus==='all'?null:(list.flatMap(m=>m.appliances||[]).find(a=>a.id===focus)||null);
    const applianceValues=selectedProfile?list.map(m=>{
      const entry=(m.appliances||[]).find(a=>a.id===focus);
      return Number(entry?.estimated_kwh||0);
    }):[];
    const max=Math.max(1,...measured.filter((v,i)=>valid[i]),
      ...(selectedProfile?applianceValues.filter((v,i)=>valid[i]):[]))*1.17;
    const a=axis(760,300,max,'kWh / měsíc',80);
    let areas='';
    // Fill only neighboring months both supported by real readings. Do not
    // connect through months without data.
    const series=[
      {values:passive,color:'#d9e7f2',lower:()=>0,label:'Trvalé spotřebiče'},
      {values:active,color:'#f5e6cd',lower:i=>passive[i],label:'Cyklické spotřebiče'},
      {values:other,color:'#dbe8e5',lower:i=>passive[i]+active[i],label:'Ostatní elektřina'}
    ];
    for(const part of series){
      for(let i=1;i<list.length;i++){
        if(!valid[i-1]||!valid[i])continue;
        const x1=a.x(i-1,list.length),x2=a.x(i,list.length);
        const lo1=part.lower(i-1),lo2=part.lower(i);
        const hi1=lo1+part.values[i-1],hi2=lo2+part.values[i];
        areas+='<path d="M '+x1+' '+a.y(lo1)+' L '+x1+' '+a.y(hi1)+' L '+x2+' '+a.y(hi2)+
          ' L '+x2+' '+a.y(lo2)+' Z" fill="'+part.color+'"><title>'+
          svg(list[i-1].month+' – '+list[i].month+' · '+part.label)+'</title></path>';
      }
    }
    const labelsRows=list.map(m=>({label:m.month,short:labelMonth(m.month)}));
    const overflow=list.some(m=>Number(m.model_excess_kwh||0)>0.001);
    target.innerHTML=a.baseSVG+(selectedProfile?'':areas)+
      (selectedProfile
        ? legend([{label:'Celkem elektroměr',color:colors.measured},
                  {label:selectedProfile.name.slice(0,19)+' (profil)',color:colors.active}],80)
        : legend([{label:'Trvalé (model)',color:colors.passive},
              {label:'Cyklické (model)',color:colors.active},
              {label:'Zbytek',color:colors.other},
              {label:'Celkem měřeno',color:colors.measured}],80))+
      line(measured,valid,a,colors.measured)+
      (selectedProfile?line(applianceValues,valid,a,colors.active,'5 4')+
        dots(labelsRows,applianceValues,valid,a,colors.active,selectedProfile.name+' (profil)','kWh'):'')+
      dots(labelsRows,measured,valid,a,colors.measured,'Naměřená elektřina','kWh')+
      labelsRows.map((m,i)=>'<text class="svg-axis-text" x="'+a.x(i,list.length)+
        '" y="294" text-anchor="middle">'+svg(m.short)+'</text>').join('');
    const note=document.querySelector('#applianceChartNote');
    if(note)note.textContent=(selectedProfile?
      'Za '+range()+' měsíců · '+selectedProfile.name+' je odhad podle '+(selectedProfile.kind==='passive'?'denního profilu':'zadaných cyklů')+
      ', zatímco celková elektřina vychází z elektroměru.':
      'Za '+range()+' měsíců zpět od zvoleného měsíce. Barevné vrstvy jsou modelová spotřeba trvalých a cyklických spotřebičů a dopočtený zbytek. Základ tvoří odečty elektroměru.')+
      (overflow?' Pozor: v některých měsících model spotřebičů přesahuje naměřenou spotřebu; přebytek není přičten k celku.':'');
  }

  function renderHeatHistory(history){
    const target=document.querySelector('#heatingTrendChart');
    if(!target)return;
    const list=(history?.months||[]).slice(-range());
    const room=document.querySelector('#heatRoomFilter')?.value||'all';
    const values=list.map(m=>{
      if(room==='all')return m.heat_units;
      const devices=(m.heat_devices||[]).filter(d=>d.room===room&&d.has_data);
      return devices.length?devices.reduce((s,d)=>s+Number(d.amount||0),0):null;
    });
    const valid=values.map(x=>x!==null&&x!==undefined);
    if(!valid.some(Boolean)){
      svgChartEmpty('#heatingTrendChart','Pro tuto místnost zatím chybí navazující odečty.',760,280);
      return;
    }
    const numeric=values.map(x=>Number(x||0)),max=Math.max(1,...numeric.filter((v,i)=>valid[i]))*1.16;
    const a=axis(760,280,max,'radiátorové dílky / měsíc',89);
    const months=list.map(m=>({label:m.month,short:labelMonth(m.month)}));
    let fill='';
    for(let i=1;i<numeric.length;i++){
      if(!valid[i-1]||!valid[i])continue;
      const xa=a.x(i-1,numeric.length),xb=a.x(i,numeric.length);
      fill+='<path d="M '+xa+' '+a.base+' L '+xa+' '+a.y(numeric[i-1])+
        ' L '+xb+' '+a.y(numeric[i])+' L '+xb+' '+a.base+
        ' Z" fill="#e8e1dc" opacity=".9"></path>';
    }
    target.innerHTML=a.baseSVG+fill+
      line(numeric,valid,a,colors.heat)+dots(months,numeric,valid,a,colors.heat,'Topení','dílků')+
      months.map((m,i)=>'<text class="svg-axis-text" x="'+a.x(i,months.length)+
        '" y="274" text-anchor="middle">'+svg(m.short)+'</text>').join('');
    const note=document.querySelector('#heatingTrendNote');
    if(note)note.textContent='Historie rozpočítaných odečtů za '+range()+' měsíců · '+
      (room==='all'?'všechny radiátory':room)+'. Měsíce bez navazujících odečtů zůstávají prázdné.';
  }
  function appliances(history){
    const select=document.querySelector('#applianceFocus');
    if(!select)return;
    const previous=select.value||'all';
    const found=new Map();
    for(const m of history?.months||[])
      for(const p of m.appliances||[])
        found.set(p.id,p.name);
    const list=[...found].sort((a,b)=>a[1].localeCompare(b[1],'cs'));
    select.innerHTML='<option value="all">Celý rozpad</option>'+
      list.map(([id,name])=>'<option value="'+escapeHtml(id)+'">'+escapeHtml(name)+'</option>').join('');
    select.value=found.has(previous)?previous:'all';
  }
    function rooms(history){
    const select=document.querySelector('#heatRoomFilter');
    if(!select)return;
    const previous=select.value||'all';
    const unique=[...new Set((history?.months||[]).flatMap(m=>(m.heat_devices||[]).map(d=>d.room)))].filter(Boolean).sort((a,b)=>a.localeCompare(b,'cs'));
    select.innerHTML='<option value="all">Všechny místnosti</option>'+
      unique.map(room=>'<option value="'+escapeHtml(room)+'">'+escapeHtml(room)+'</option>').join('');
    select.value=unique.includes(previous)?previous:'all';
  }
  const financeSeries = [
    {key:'electricity',label:'Elektřina',color:'#277f72'},
    {key:'cold_water',label:'Studená voda',color:'#4d8fa8'},
    {key:'hot_water',label:'Teplá voda',color:'#b76b59'},
    {key:'gas',label:'Plyn',color:'#aa874a'},
    {key:'heat',label:'Teplo',color:'#806b5a'}
  ];
  function financeView(history){
    return history?.finance_months||[];
  }
  function financeLabels(list,g,H){
    const x=i=>list.length===1?g.left+g.plotW/2:g.left+g.plotW*i/(list.length-1);
    return list.map((v,i)=>{
      const selected=v.month===historyMonth, y=H-13;
      return '<text class="svg-axis-text" x="'+x(i)+'" y="'+y+'" text-anchor="middle"'+
        (selected?' style="font-weight:800;fill:#14685e"':'')+'>'+svg(labelMonth(v.month))+'</text>';
    }).join('');
  }
  let historyMonth='';
  function plotFinanceLines(list,series,W,H,minimum=0){
    const validValues=list.flatMap(r=>r.available?series.map(it=>Number(it.value(r)||0)):[]);
    const max=Math.max(minimum+1,...validValues,0);
    const min=Math.min(minimum,...validValues,0);
    const pad=Math.max(40,(max-min)*0.13);
    const g=svgYAxis(W,H,Math.min(0,min-pad*(min<0?1:0)),max+pad,82,18,80,H===300?42:40,
      v=>Math.round(v).toLocaleString('cs-CZ')+' Kč');
    const x=i=>list.length===1?g.left+g.plotW/2:g.left+g.plotW*i/(list.length-1);
    const selected=list.findIndex(r=>r.month===historyMonth);
    let backdrop='<rect class="svg-chart-bg" x="0" y="0" width="'+W+'" height="'+H+'"></rect>'+g.grid;
    if(selected>=0)backdrop+='<line x1="'+x(selected)+'" x2="'+x(selected)+
      '" y1="'+g.top+'" y2="'+g.base+'" stroke="#b1ccc5" stroke-width="2" stroke-dasharray="4 5"></line>';
    let output='';
    for(const item of series){
      let d='',connected=false;
      for(let i=0;i<list.length;i++){
        const month=list[i];
        const val=month.available?item.value(month):null;
        if(val==null || !Number.isFinite(Number(val))){connected=false;continue;}
        const xx=x(i),yy=g.y(Number(val));
        d+=(connected?' L ':' M ')+xx.toFixed(2)+' '+yy.toFixed(2);
        connected=true;
        output+='<circle cx="'+xx+'" cy="'+yy+'" r="'+(month.month===historyMonth?4.4:3.1)+
          '" fill="'+item.color+'"><title>'+svg(month.month+' · '+item.label+' · '+money(val)+
          (month.partial?' · zatím neúplné období':'')+(month.month===historyMonth?' · vybraný měsíc':'')+
          '</title></circle>';
      }
      if(d)output+='<path d="'+d+'" fill="none" stroke="'+item.color+'" stroke-width="'+
        (item.strong?3.2:2.2)+'" stroke-linejoin="round" stroke-linecap="round"'+
        (item.dash?' stroke-dasharray="6 4"':'')+'></path>';
    }
    if(min<0)backdrop+='<line x1="'+g.left+'" x2="'+(W-g.right)+
      '" y1="'+g.y(0)+'" y2="'+g.y(0)+'" class="svg-zero-line"></line>';
    return {markup:backdrop+output+financeLabels(list,g,H),x};
  }
  function renderFinancial(history){
    const list=financeView(history);
    historyMonth=history?.selected_month||'';
    const cash=document.querySelector('#cashflowChart');
    const balance=document.querySelector('#balanceTrendChart');
    if(!cash||!balance)return;
    if(!list.some(x=>x.available)){
      svgChartEmpty('#cashflowChart','V okolních měsících nejsou doložené finanční údaje.',760,300);
      svgChartEmpty('#balanceTrendChart','V okolních měsících nejsou doložené finanční údaje.',760,280);
      return;
    }
    const total={label:'Náklady celkem',color:'#164a42',strong:true,value:r=>r.total_cost};
    const advances={label:'Předepsané zálohy',color:'#7c8c96',dash:true,strong:true,value:r=>r.advance};
    const mode=document.querySelector('#financeChartMode')?.value||'energy';
    const individual=financeSeries.map(u=>({label:u.label,color:u.color,
      value:r=>r.utility_costs?.[u.key]}));
    const plotted=mode==='energy'?[...individual,total,advances]:[total,advances];
    const legendRows=mode==='energy'?[individual.slice(0,4),[individual[4],total,advances]]:[[total,advances]];
    const legend=legendRows.map((row,idx)=>row.map((it,i)=>{
      const x=82+i*(mode==='energy'?167:225),y=22+idx*23;
      return '<line x1="'+x+'" y1="'+y+'" x2="'+(x+19)+'" y2="'+y+
        '" stroke="'+it.color+'" stroke-width="'+(it.strong?3:2)+'"'+
        (it.dash?' stroke-dasharray="5 3"':'')+'></line>'+
        '<text x="'+(x+25)+'" y="'+(y+4)+'" class="svg-axis-text">'+svg(it.label)+'</text>';
    }).join('')).join('');
    cash.innerHTML=plotFinanceLines(list,plotted,760,300).markup+legend;
    const balanceSeries=[{
      label:'Rozdíl záloh a nákladů',color:'#277f72',strong:true,value:r=>r.balance,
    }];
    balance.innerHTML=plotFinanceLines(list,balanceSeries,760,280,
      Math.min(0,...list.filter(x=>x.available).map(x=>Number(x.balance||0)))).markup;
    const note=document.querySelector('#cashflowChartNote');
    if(note)note.textContent='Zálohy jsou předepsané, nikoli potvrzené bankovní platby. Náklady zahrnují fixní poplatky a spotřebu z odečtů. Tečkovaný svislý pruh označuje vybraný měsíc; budoucnost se nepředpovídá.';
    const balanceNote=document.querySelector('#balanceTrendNote');
    if(balanceNote)balanceNote.textContent='Každý bod = rozdíl záloh a nákladů za příslušný měsíc (ne kumulativní součet). U probíhajícího měsíce jde pouze o dosud známé hodnoty. Chybějící měsíce nejsou vykresleny jako nula.';
  }
  function renderAll(monthData,history){
    renderDaily(monthData,history);
    rooms(history);
    appliances(history);
    renderElectricHistory(history);
    renderHeatHistory(history);
    renderFinancial(history);
  }
  function renderHistory(history){
    renderElectricHistory(history);
    renderHeatHistory(history);
  }
  return {renderAll,renderHistory,renderFinancial};
})();