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
              {label:'Ostatní',color:colors.other}],86).replace(/i="32"/g,'i="32"')+
      line(measured,observed,chart,colors.measured)+
      (passiveRate>0?line(passive,observed,chart,colors.passive,'5 4'):'')+
      (activeRate>0?line(active,observed,chart,colors.active,'5 4'):'')+
      line(other,observed,chart,colors.other,'3 4')+
      dots(rows,measured,observed,chart,colors.measured,'Elektroměr','kWh')+
      labels(rows,chart,9);
    const note=document.querySelector('#usageChartNote');
    if(note)note.textContent='Plná čára = spotřeba rozpočítaná ze skutečných odečtů. Přerušované čáry = odhady podle profilů spotřebičů. Neznámé dny se nedopočítávají.';
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
    const max=Math.max(1,...measured.filter((v,i)=>valid[i]))*1.17;
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
    target.innerHTML=a.baseSVG+areas+
      legend([{label:'Trvalé (model)',color:colors.passive},
              {label:'Cyklické (model)',color:colors.active},
              {label:'Zbytek',color:colors.other},
              {label:'Celkem měřeno',color:colors.measured}],80)+
      line(measured,valid,a,colors.measured)+
      dots(labelsRows,measured,valid,a,colors.measured,'Naměřená elektřina','kWh')+
      labelsRows.map((m,i)=>'<text class="svg-axis-text" x="'+a.x(i,list.length)+
        '" y="294" text-anchor="middle">'+svg(m.short)+'</text>').join('');
    const note=document.querySelector('#applianceChartNote');
    if(note)note.textContent='Za '+range()+' měsíců zpět od zvoleného měsíce. Barevné vrstvy jsou modelová spotřeba trvalých a cyklických spotřebičů a dopočtený zbytek. Základ tvoří odečty elektroměru.'+
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
  function rooms(history){
    const select=document.querySelector('#heatRoomFilter');
    if(!select)return;
    const previous=select.value||'all';
    const unique=[...new Set((history?.months||[]).flatMap(m=>(m.heat_devices||[]).map(d=>d.room)))].filter(Boolean).sort((a,b)=>a.localeCompare(b,'cs'));
    select.innerHTML='<option value="all">Všechny místnosti</option>'+
      unique.map(room=>'<option value="'+escapeHtml(room)+'">'+escapeHtml(room)+'</option>').join('');
    select.value=unique.includes(previous)?previous:'all';
  }
  function renderAll(monthData,history){
    renderDaily(monthData,history);
    rooms(history);
    renderElectricHistory(history);
    renderHeatHistory(history);
  }
  function renderHistory(history){
    renderElectricHistory(history);
    renderHeatHistory(history);
  }
  return {renderAll,renderHistory};
})();