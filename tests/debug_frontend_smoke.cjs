const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html=fs.readFileSync(path.join(__dirname,'../templates/index.html'),'utf8');
assert(html.includes('id="debugOpenBtn"'));
assert(html.includes('id="debugCopyBtn"'));
assert(html.includes('id="debugText"'));
assert(html.includes('/static/debug.js'));
assert(!html.includes('Pouze potvrzená spotřeba + časově příslušné'));

const handlers=new Map();
const els=new Map();
function el(selector){
  const classes=new Set(['hidden']);
  return {
    value:'',textContent:'',disabled:false,
    classList: {add(k){classes.add(k)},remove(k){classes.delete(k)},contains(k){return classes.has(k)}},
    addEventListener(k,fn){handlers.set(selector+':'+k,fn)},
    focus(){},select(){},
  };
}
function $(s){if(!els.has(s))els.set(s,el(s));return els.get(s)}
$('#dashboardMonthPicker').value='2026-10';
const copied=[];
const requests=[];
const context={
  document:{querySelector:$,addEventListener(k,fn){handlers.set('document:'+k,fn)}},
  navigator:{clipboard:{async writeText(s){copied.push(s)}}},
  api:async(url,options)=>{requests.push({url,options});return {text:'ENERGYHOME - DEBUG TXT TEST'}},
  Intl,Date,JSON,String,
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../static/debug.js'),'utf8'),context);
async function flush(){for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve))}
(async()=>{
  handlers.get('#debugOpenBtn:click')();
  await flush();
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'/api/debug/report');
  assert.equal(requests[0].options.method,'POST');
  assert.equal(JSON.parse(requests[0].options.body).month,'2026-10');
  assert.equal($('#debugText').value,'ENERGYHOME - DEBUG TXT TEST');
  assert.equal($('#debugCopyBtn').disabled,false);
  await handlers.get('#debugCopyBtn:click')();
  assert.deepEqual(copied,['ENERGYHOME - DEBUG TXT TEST']);
  handlers.get('#debugCloseBtn:click')();
  assert($('#debugModal').classList.contains('hidden'));
  console.log('Debug UI open, copy and close smoke passed');
})().catch(e=>{console.error(e);process.exitCode=1});
