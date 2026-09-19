const LABELS={PAID:'Paid / Queue',FILE_PREP:'File Prep',READY_TO_PRINT:'Ready to Print',PRINTING:'Printing',FINISHING:'Finishing',QC:'QC',READY_FOR_PICKUP:'Ready for Pickup',PICKED_UP:'Picked Up'};
let statuses=[],meta={machines:[]};
async function req(url,opts){const r=await fetch(url,opts);const j=await r.json();if(!r.ok)throw new Error(j.error||'Request failed');return j}
async function advance(id,status){
  const idx=statuses.indexOf(status),next=statuses[idx+1]; if(!next)return;
  try{
    if(next==='READY_TO_PRINT') await req(`/api/orders/${id}/production`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({prepress_approved:true,file_operator:'Prepress Operator'})});
    await req(`/api/orders/${id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:next,actor:'Production Operator'})});
    await loadBoard();
  }catch(e){alert(e.message)}
}
async function completeQc(id){
  if(!confirm('Confirm all QC checks passed and move this job to Ready for Pickup?'))return;
  try{
    const detail=await req(`/api/orders/${id}`);
    await Promise.all((detail.qc||[]).map(c=>req(`/api/orders/${id}/qc`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({check_key:c.check_key,passed:true,checked_by:'QC Operator'})})));
    await req(`/api/orders/${id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'READY_FOR_PICKUP',actor:'QC Operator',note:'QC checklist completed'})});
    await loadBoard();
  }catch(e){alert(e.message)}
}
async function assignMachine(id,machineId){try{if(!machineId)return;await req(`/api/orders/${id}/production`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({machine_id:Number(machineId),print_operator:'Machine Operator'})});await loadBoard()}catch(e){alert(e.message)}}
async function reprint(id){const reason=prompt('Reason for reprint?','QC issue / color / defect');if(!reason)return;try{await req(`/api/orders/${id}/reprint`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason,actor:'QC Operator'})});await loadBoard()}catch(e){alert(e.message)}}
async function loadBoard(){
  const [m,orders]=await Promise.all([req('/api/meta'),req('/api/orders')]); meta=m; statuses=m.statuses;
  document.querySelector('#board').innerHTML=statuses.map(s=>{const jobs=orders.filter(o=>o.status===s);return `<div class="lane"><h3>${LABELS[s]||s} · ${jobs.length}</h3>${jobs.map(o=>`<div class="job"><strong>${o.order_no}</strong><small>${o.customer_name}</small><div style="margin:8px 0">${o.items.map(i=>`${i.name} × ${i.qty}`).join('<br>')}</div><small>${o.machine_name?`Machine: ${o.machine_name}`:'Machine not assigned'} • Reprints: ${o.reprint_count||0}</small>${['READY_TO_PRINT','PRINTING'].includes(s)?`<select style="width:100%;margin:8px 0" onchange="assignMachine(${o.id},this.value)"><option value="">Assign machine</option>${meta.machines.map(x=>`<option value="${x.id}" ${Number(o.machine_id)===Number(x.id)?'selected':''}>${x.name}</option>`).join('')}</select>`:''}${s==='QC'?`<div style="display:flex;gap:6px;margin-top:8px"><button class="btn" onclick="reprint(${o.id})">Reprint</button><button class="btn green" onclick="completeQc(${o.id})">QC Pass → Ready Pickup</button></div>`:s!=='PICKED_UP'?`<button class="btn" onclick="advance(${o.id},'${s}')">Move to ${LABELS[statuses[statuses.indexOf(s)+1]]||statuses[statuses.indexOf(s)+1]}</button>`:''}</div>`).join('')}</div>`}).join('');
}
loadBoard();setInterval(loadBoard,15000);
