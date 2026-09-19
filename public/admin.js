const rupiah=n=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(n||0));
let meta={products:[],addons:[],machines:[]};
async function get(url,opts){const r=await fetch(url,opts);const j=await r.json();if(!r.ok)throw new Error(j.error||'Request failed');return j}
async function load(){
  meta=await get('/api/meta');
  const d=await get('/api/dashboard');
  const orders=await get('/api/orders');
  document.querySelector('#product').innerHTML=meta.products.map(p=>`<option value="${p.id}">${p.name} • ${rupiah(p.sell_price)}/${p.unit} • avail ${Number(p.available_qty).toLocaleString('id-ID')}</option>`).join('');
  document.querySelector('#addons').innerHTML=meta.addons.map(a=>`<label class="check"><input type="checkbox" value="${a.id}" data-price="${a.sell_price}"><span>${a.name}<br><small>${a.category} • ${rupiah(a.sell_price)}</small></span></label>`).join('');
  document.querySelector('#cards').innerHTML=`
    <div class="card"><div class="label">Active Jobs</div><div class="value">${d.orders.active}</div><small>${d.orders.overdue||0} overdue</small></div>
    <div class="card"><div class="label">Ready Pickup</div><div class="value">${d.orders.ready_pickup||0}</div></div>
    <div class="card"><div class="label">Paid Revenue</div><div class="value">${rupiah(d.finance.revenue)}</div></div>
    <div class="card"><div class="label">Est. Gross Profit</div><div class="value">${rupiah(d.finance.gross_profit)}</div><small>${Number(d.finance.gross_margin_pct||0).toFixed(1)}% margin</small></div>
    <div class="card"><div class="label">Low Stock SKU</div><div class="value">${d.stock.low_stock}</div></div>
    <div class="card"><div class="label">Reserved Material</div><div class="value">${Number(d.stock.reserved_qty||0).toLocaleString('id-ID')}</div></div>`;
  document.querySelector('#orders').innerHTML=orders.map(o=>`<tr><td><strong>${o.order_no}</strong><br><small>${o.machine_name||'Unassigned machine'}</small></td><td>${o.customer_name}</td><td><span class="badge ${o.status}">${o.status.replaceAll('_',' ')}</span></td><td>${rupiah(o.grand_total)}</td><td>${rupiah(o.cost_estimate)}</td><td>${rupiah(Number(o.grand_total)-Number(o.cost_estimate))}</td><td>${new Date(o.created_at).toLocaleString('id-ID')}</td></tr>`).join('');
  document.querySelector('#inventory').innerHTML=meta.products.map(p=>`<tr><td>${p.sku}</td><td>${p.name}</td><td>${p.material_category}</td><td>${p.machine_category}</td><td><strong>${Number(p.stock_qty).toLocaleString('id-ID')} ${p.unit}</strong><br><small>Reserved ${Number(p.reserved_qty).toLocaleString('id-ID')} • Available ${Number(p.available_qty).toLocaleString('id-ID')}</small></td><td>${p.min_stock}</td><td>${rupiah(p.sell_price)}</td></tr>`).join('');
  estimate();
}
function estimate(){
  const p=meta.products.find(x=>String(x.id)===document.querySelector('#product').value);
  let t=p?Number(p.sell_price)*Number(document.querySelector('#qty').value||0):0;
  document.querySelectorAll('#addons input:checked').forEach(x=>t+=Number(x.dataset.price));
  const waste=p?Number(p.waste_percent||0):0;
  document.querySelector('#estimate').textContent=`Estimated total: ${rupiah(t)} • stock reserve includes ${waste}% waste`;
}
document.addEventListener('change',e=>{if(e.target.matches('#product,#qty,#addons input'))estimate()});
document.querySelector('#createOrder').onclick=async()=>{try{
  const addon_ids=[...document.querySelectorAll('#addons input:checked')].map(x=>Number(x.value));
  await get('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customer_name:document.querySelector('#customer').value||'Walk-in',customer_phone:document.querySelector('#phone').value,items:[{product_id:Number(document.querySelector('#product').value),qty:Number(document.querySelector('#qty').value||1)}],addon_ids,actor:'Admin POS',payment_method:'CASH'})});
  await load();
}catch(e){alert(e.message)}};
document.querySelector('#addProduct').onclick=async()=>{try{
  await get('/api/products',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sku:sku.value,name:pname.value,material_category:material.value,machine_category:machine.value,unit:unit.value,cost_price:cost.value,sell_price:sell.value,stock_qty:stock.value,min_stock:0,waste_percent:3})});
  await load();
}catch(e){alert(e.message)}};
load();
