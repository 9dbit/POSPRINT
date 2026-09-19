import express from 'express';
import pg from 'pg';

const { Pool } = pg;
const app = express();
const port = process.env.PORT || 3000;
const isRailwayInternalDb = (process.env.DATABASE_URL || '').includes('.railway.internal');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL && !isRailwayInternalDb ? { rejectUnauthorized: false } : false });

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

const STATUSES = ['PAID','FILE_PREP','READY_TO_PRINT','PRINTING','FINISHING','QC','READY_FOR_PICKUP','PICKED_UP'];
const ACTIVE_STATUSES = STATUSES.filter(s => !['READY_FOR_PICKUP','PICKED_UP'].includes(s));

async function initDb() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      sku TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      material_category TEXT NOT NULL,
      machine_category TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'pcs',
      cost_price NUMERIC(14,2) NOT NULL DEFAULT 0,
      sell_price NUMERIC(14,2) NOT NULL DEFAULT 0,
      stock_qty NUMERIC(14,3) NOT NULL DEFAULT 0,
      min_stock NUMERIC(14,3) NOT NULL DEFAULT 0,
      waste_percent NUMERIC(6,2) NOT NULL DEFAULT 3,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE products ADD COLUMN IF NOT EXISTS waste_percent NUMERIC(6,2) NOT NULL DEFAULT 3;

    CREATE TABLE IF NOT EXISTS addons (
      id SERIAL PRIMARY KEY,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'job',
      cost_price NUMERIC(14,2) NOT NULL DEFAULT 0,
      sell_price NUMERIC(14,2) NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      UNIQUE(category, name)
    );

    CREATE TABLE IF NOT EXISTS machines (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'AVAILABLE',
      hourly_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
      notes TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      order_no TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT,
      status TEXT NOT NULL DEFAULT 'PAID',
      payment_status TEXT NOT NULL DEFAULT 'PAID',
      payment_method TEXT NOT NULL DEFAULT 'CASH',
      subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
      addon_total NUMERIC(14,2) NOT NULL DEFAULT 0,
      grand_total NUMERIC(14,2) NOT NULL DEFAULT 0,
      cost_estimate NUMERIC(14,2) NOT NULL DEFAULT 0,
      actual_cost NUMERIC(14,2),
      notes TEXT,
      due_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      picked_up_at TIMESTAMPTZ,
      stock_posted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'CASH';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS actual_cost NUMERIC(14,2);

    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      qty NUMERIC(14,3) NOT NULL,
      width NUMERIC(14,3),
      height NUMERIC(14,3),
      unit_price NUMERIC(14,2) NOT NULL,
      unit_cost NUMERIC(14,2) NOT NULL,
      line_total NUMERIC(14,2) NOT NULL,
      line_cost NUMERIC(14,2) NOT NULL,
      file_name TEXT,
      file_url TEXT
    );

    CREATE TABLE IF NOT EXISTS order_addons (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      addon_id INTEGER NOT NULL REFERENCES addons(id),
      qty NUMERIC(14,3) NOT NULL DEFAULT 1,
      unit_price NUMERIC(14,2) NOT NULL,
      unit_cost NUMERIC(14,2) NOT NULL,
      line_total NUMERIC(14,2) NOT NULL,
      line_cost NUMERIC(14,2) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_events (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      actor TEXT,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id),
      order_id INTEGER REFERENCES orders(id),
      movement_type TEXT NOT NULL,
      qty NUMERIC(14,3) NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS inventory_reservations (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id),
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      qty NUMERIC(14,3) NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      released_at TIMESTAMPTZ,
      UNIQUE(product_id, order_id)
    );

    CREATE TABLE IF NOT EXISTS production_jobs (
      id SERIAL PRIMARY KEY,
      order_id INTEGER UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      machine_id INTEGER REFERENCES machines(id),
      file_operator TEXT,
      print_operator TEXT,
      finishing_operator TEXT,
      qc_operator TEXT,
      prepress_approved BOOLEAN NOT NULL DEFAULT FALSE,
      print_started_at TIMESTAMPTZ,
      print_finished_at TIMESTAMPTZ,
      qc_passed_at TIMESTAMPTZ,
      reprint_count INTEGER NOT NULL DEFAULT 0,
      reprint_reason TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS qc_checks (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      check_key TEXT NOT NULL,
      label TEXT NOT NULL,
      passed BOOLEAN NOT NULL DEFAULT FALSE,
      note TEXT,
      checked_by TEXT,
      checked_at TIMESTAMPTZ,
      UNIQUE(order_id, check_key)
    );
  `);

  const seedAddons = [
    ['Print Art Paper','Finish Cutting Manual','job',2500,5000],
    ['Print Art Paper','Cutting Die Cut','job',8000,15000],
    ['Print Art Paper','Laminating','sheet',1500,3000],
    ['Print Art Paper','Laminasi 1 Sisi','sheet',1200,2500],
    ['Print Art Paper','Laminasi 2 Sisi','sheet',2200,4500],
    ['Print Art Paper','Lipat 1','sheet',500,1200],
    ['Print Art Paper','Lipat 2','sheet',700,1500],
    ['Print Art Paper','Perforasi','sheet',500,1200],
    ['Print Outdoor','Seaming Keliling','meter',2500,5000],
    ['Print Outdoor','Ring Banner','pcs',1000,2500],
    ['Print Outdoor','Seaming Sambungan','meter',3000,6000],
    ['Print Outdoor','Selongsong','meter',3000,6500],
    ['Print Sticker Large Format','Cutting Kiss Cut','meter',6000,12000],
    ['Print Sticker Large Format','Transfer Sticker','meter',7000,14000]
  ];
  for (const a of seedAddons) {
    await pool.query(`INSERT INTO addons(category,name,unit,cost_price,sell_price) VALUES($1,$2,$3,$4,$5) ON CONFLICT(category,name) DO NOTHING`, a);
  }

  const machineSeeds = [
    ['DP-01','Digital Press 01','Digital Press',65000],
    ['LF-OUT-01','Large Format Outdoor 01','Large Format Outdoor',95000],
    ['LF-ECO-01','Eco Solvent 01','Large Format Eco Solvent',85000],
    ['CUT-01','Cutting / Finishing Station','Finishing',45000]
  ];
  for (const m of machineSeeds) {
    await pool.query(`INSERT INTO machines(code,name,category,hourly_cost) VALUES($1,$2,$3,$4) ON CONFLICT(code) DO NOTHING`, m);
  }

  const count = await pool.query('SELECT COUNT(*)::int AS count FROM products');
  if (!count.rows[0].count) {
    await pool.query(`INSERT INTO products(sku,name,material_category,machine_category,unit,cost_price,sell_price,stock_qty,min_stock,waste_percent) VALUES
      ('ART260-A3','Art Paper 260gsm A3+','Art Paper','Digital Press','sheet',1800,4500,1500,300,3),
      ('FLEX280','Flexi 280gsm','Outdoor','Large Format Outdoor','m2',12000,35000,220,40,5),
      ('STK-VINYL','Sticker Vinyl Glossy','Sticker Large Format','Large Format Eco Solvent','m2',18000,50000,180,30,5)
    `);
  }
}

function num(v) { return Number(v || 0); }
function orderNo() { return `PP-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${Math.floor(1000 + Math.random()*9000)}`; }
function reserveQty(qty, wastePercent) { return Number((num(qty) * (1 + num(wastePercent) / 100)).toFixed(3)); }

async function seedQc(client, orderId) {
  const checks = [
    ['FILE_SIZE','Ukuran file & bleed sesuai'],
    ['COLOR','Warna / profile sesuai approval'],
    ['PRINT_SURFACE','Tidak ada banding, scratch, noda'],
    ['DIMENSION','Ukuran hasil akhir sesuai order'],
    ['FINISHING','Finishing lengkap dan rapi'],
    ['QTY','Jumlah hasil sesuai order']
  ];
  for (const c of checks) {
    await client.query(`INSERT INTO qc_checks(order_id,check_key,label) VALUES($1,$2,$3) ON CONFLICT(order_id,check_key) DO NOTHING`, [orderId,c[0],c[1]]);
  }
}

app.get('/health', (_, res) => res.json({ ok: true, service: 'POSPRINT', version: '0.2.0' }));
app.get('/admin', (_, res) => res.sendFile(process.cwd() + '/public/admin.html'));
app.get('/operator', (_, res) => res.sendFile(process.cwd() + '/public/operator.html'));

app.get('/api/meta', async (_, res) => {
  const [p,a,m] = await Promise.all([
    pool.query(`SELECT p.*, COALESCE(r.reserved_qty,0) reserved_qty, p.stock_qty-COALESCE(r.reserved_qty,0) available_qty
      FROM products p LEFT JOIN (
        SELECT product_id,SUM(qty) reserved_qty FROM inventory_reservations WHERE status='ACTIVE' GROUP BY product_id
      ) r ON r.product_id=p.id WHERE p.active=TRUE ORDER BY p.material_category,p.name`),
    pool.query('SELECT * FROM addons WHERE active=TRUE ORDER BY category,name'),
    pool.query('SELECT * FROM machines WHERE active=TRUE ORDER BY category,name')
  ]);
  res.json({ statuses: STATUSES, products: p.rows, addons: a.rows, machines: m.rows });
});

app.post('/api/products', async (req,res) => {
  const b=req.body;
  const q=await pool.query(`INSERT INTO products(sku,name,material_category,machine_category,unit,cost_price,sell_price,stock_qty,min_stock,waste_percent)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[b.sku,b.name,b.material_category,b.machine_category,b.unit||'pcs',num(b.cost_price),num(b.sell_price),num(b.stock_qty),num(b.min_stock),num(b.waste_percent||3)]);
  res.status(201).json(q.rows[0]);
});

app.post('/api/machines', async (req,res) => {
  const b=req.body;
  const q=await pool.query(`INSERT INTO machines(code,name,category,hourly_cost,notes) VALUES($1,$2,$3,$4,$5) RETURNING *`,[b.code,b.name,b.category,num(b.hourly_cost),b.notes||null]);
  res.status(201).json(q.rows[0]);
});

app.get('/api/orders', async (_,res) => {
  const q=await pool.query(`SELECT o.*, pj.machine_id, m.name machine_name, pj.file_operator, pj.print_operator, pj.finishing_operator, pj.qc_operator,
    pj.prepress_approved, pj.reprint_count,
    COALESCE(json_agg(DISTINCT jsonb_build_object('id',oi.id,'name',p.name,'qty',oi.qty,'unit',p.unit,'file_name',oi.file_name,'material_category',p.material_category,'machine_category',p.machine_category)) FILTER (WHERE oi.id IS NOT NULL),'[]') items
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id=o.id
    LEFT JOIN products p ON p.id=oi.product_id
    LEFT JOIN production_jobs pj ON pj.order_id=o.id
    LEFT JOIN machines m ON m.id=pj.machine_id
    GROUP BY o.id,pj.id,m.name ORDER BY o.created_at DESC LIMIT 300`);
  res.json(q.rows);
});

app.get('/api/orders/:id', async (req,res) => {
  const [o,items,addons,events,qc] = await Promise.all([
    pool.query(`SELECT o.*,pj.*,m.name machine_name FROM orders o LEFT JOIN production_jobs pj ON pj.order_id=o.id LEFT JOIN machines m ON m.id=pj.machine_id WHERE o.id=$1`,[req.params.id]),
    pool.query(`SELECT oi.*,p.name,p.sku,p.unit,p.material_category,p.machine_category,p.waste_percent FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=$1`,[req.params.id]),
    pool.query(`SELECT oa.*,a.name,a.category,a.unit FROM order_addons oa JOIN addons a ON a.id=oa.addon_id WHERE oa.order_id=$1`,[req.params.id]),
    pool.query(`SELECT * FROM order_events WHERE order_id=$1 ORDER BY created_at`,[req.params.id]),
    pool.query(`SELECT * FROM qc_checks WHERE order_id=$1 ORDER BY id`,[req.params.id])
  ]);
  if(!o.rowCount) return res.status(404).json({error:'Order not found'});
  res.json({order:o.rows[0],items:items.rows,addons:addons.rows,events:events.rows,qc:qc.rows});
});

app.post('/api/orders', async (req,res) => {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const {customer_name,customer_phone,notes,due_at,payment_method,items=[],addon_ids=[]}=req.body;
    let subtotal=0, addonTotal=0, cost=0;
    const productRows=[];
    for (const item of items) {
      const p=(await client.query('SELECT * FROM products WHERE id=$1 AND active=TRUE FOR UPDATE',[item.product_id])).rows[0];
      if(!p) throw new Error('Product not found');
      const qty=num(item.qty); const reserved=reserveQty(qty,p.waste_percent);
      const currentReserved=num((await client.query(`SELECT COALESCE(SUM(qty),0) qty FROM inventory_reservations WHERE product_id=$1 AND status='ACTIVE'`,[p.id])).rows[0].qty);
      if(num(p.stock_qty)-currentReserved < reserved) throw new Error(`Insufficient available stock for ${p.name}`);
      const total=qty*num(p.sell_price); const lineCost=reserved*num(p.cost_price);
      subtotal+=total; cost+=lineCost; productRows.push({item,p,qty,reserved,total,lineCost});
    }
    const addonRows=[];
    for (const selected of addon_ids) {
      const addonId=typeof selected==='object'?selected.id:selected;
      const aq=(await client.query('SELECT * FROM addons WHERE id=$1 AND active=TRUE',[addonId])).rows[0];
      if(!aq) continue;
      const qty=typeof selected==='object'?num(selected.qty||1):1;
      addonTotal+=qty*num(aq.sell_price); cost+=qty*num(aq.cost_price); addonRows.push({a:aq,qty});
    }
    const oq=await client.query(`INSERT INTO orders(order_no,customer_name,customer_phone,status,payment_status,payment_method,subtotal,addon_total,grand_total,cost_estimate,notes,due_at)
      VALUES($1,$2,$3,'PAID','PAID',$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[orderNo(),customer_name||'Walk-in',customer_phone,payment_method||'CASH',subtotal,addonTotal,subtotal+addonTotal,cost,notes,due_at||null]);
    const order=oq.rows[0];
    for(const r of productRows){
      await client.query(`INSERT INTO order_items(order_id,product_id,qty,unit_price,unit_cost,line_total,line_cost,file_name,file_url,width,height) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[order.id,r.p.id,r.qty,r.p.sell_price,r.p.cost_price,r.total,r.lineCost,r.item.file_name||null,r.item.file_url||null,r.item.width||null,r.item.height||null]);
      await client.query(`INSERT INTO inventory_reservations(product_id,order_id,qty,status) VALUES($1,$2,$3,'ACTIVE') ON CONFLICT(product_id,order_id) DO UPDATE SET qty=EXCLUDED.qty,status='ACTIVE',released_at=NULL`,[r.p.id,order.id,r.reserved]);
      await client.query(`INSERT INTO inventory_movements(product_id,order_id,movement_type,qty,note) VALUES($1,$2,'RESERVATION',$3,$4)`,[r.p.id,order.id,r.reserved,`Reserved for ${order.order_no} incl. waste factor`]);
    }
    for(const r of addonRows) await client.query(`INSERT INTO order_addons(order_id,addon_id,qty,unit_price,unit_cost,line_total,line_cost) VALUES($1,$2,$3,$4,$5,$6,$7)`,[order.id,r.a.id,r.qty,r.a.sell_price,r.a.cost_price,r.qty*num(r.a.sell_price),r.qty*num(r.a.cost_price)]);
    await client.query(`INSERT INTO production_jobs(order_id) VALUES($1) ON CONFLICT(order_id) DO NOTHING`,[order.id]);
    await seedQc(client,order.id);
    await client.query(`INSERT INTO order_events(order_id,status,actor,note) VALUES($1,'PAID',$2,'Payment confirmed and stock reserved')`,[order.id,req.body.actor||'Cashier']);
    await client.query('COMMIT'); res.status(201).json(order);
  } catch(e){ await client.query('ROLLBACK'); res.status(400).json({error:e.message}); } finally{ client.release(); }
});

app.patch('/api/orders/:id/production', async (req,res) => {
  const b=req.body;
  const q=await pool.query(`UPDATE production_jobs SET machine_id=COALESCE($1,machine_id), file_operator=COALESCE($2,file_operator), print_operator=COALESCE($3,print_operator), finishing_operator=COALESCE($4,finishing_operator), qc_operator=COALESCE($5,qc_operator), prepress_approved=COALESCE($6,prepress_approved), updated_at=NOW() WHERE order_id=$7 RETURNING *`,[b.machine_id||null,b.file_operator||null,b.print_operator||null,b.finishing_operator||null,b.qc_operator||null,typeof b.prepress_approved==='boolean'?b.prepress_approved:null,req.params.id]);
  if(!q.rowCount) return res.status(404).json({error:'Production job not found'});
  res.json(q.rows[0]);
});

app.patch('/api/orders/:id/qc', async (req,res) => {
  const {check_key,passed,note,checked_by}=req.body;
  const q=await pool.query(`UPDATE qc_checks SET passed=$1,note=$2,checked_by=$3,checked_at=NOW() WHERE order_id=$4 AND check_key=$5 RETURNING *`,[!!passed,note||null,checked_by||'QC Operator',req.params.id,check_key]);
  if(!q.rowCount) return res.status(404).json({error:'QC check not found'});
  res.json(q.rows[0]);
});

app.post('/api/orders/:id/reprint', async (req,res) => {
  const {reason,actor}=req.body;
  const q=await pool.query(`UPDATE production_jobs SET reprint_count=reprint_count+1,reprint_reason=$1,updated_at=NOW() WHERE order_id=$2 RETURNING *`,[reason||'QC reprint',req.params.id]);
  if(!q.rowCount) return res.status(404).json({error:'Production job not found'});
  await pool.query(`UPDATE orders SET status='PRINTING',updated_at=NOW() WHERE id=$1`,[req.params.id]);
  await pool.query(`INSERT INTO order_events(order_id,status,actor,note) VALUES($1,'PRINTING',$2,$3)`,[req.params.id,actor||'QC Operator',`Reprint requested: ${reason||'QC issue'}`]);
  res.json(q.rows[0]);
});

app.patch('/api/orders/:id/status', async (req,res) => {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const order=(await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
    if(!order) throw new Error('Order not found');
    const next=req.body.status;
    const fromIdx=STATUSES.indexOf(order.status), toIdx=STATUSES.indexOf(next);
    if(toIdx<0) throw new Error('Invalid status');
    if(toIdx>fromIdx+1 && !req.body.force) throw new Error(`Next allowed status is ${STATUSES[fromIdx+1]}`);
    if(toIdx<fromIdx && !req.body.force) throw new Error('Backward status change requires force=true');

    if(next==='READY_TO_PRINT'){
      const job=(await client.query('SELECT * FROM production_jobs WHERE order_id=$1',[order.id])).rows[0];
      if(!job?.prepress_approved) throw new Error('Prepress approval is required before Ready to Print');
    }
    if(next==='PRINTING') await client.query(`UPDATE production_jobs SET print_started_at=COALESCE(print_started_at,NOW()),updated_at=NOW() WHERE order_id=$1`,[order.id]);
    if(next==='FINISHING') await client.query(`UPDATE production_jobs SET print_finished_at=COALESCE(print_finished_at,NOW()),updated_at=NOW() WHERE order_id=$1`,[order.id]);

    if(next==='READY_FOR_PICKUP' && !order.stock_posted_at){
      const failed=(await client.query(`SELECT COUNT(*)::int count FROM qc_checks WHERE order_id=$1 AND passed=FALSE`,[order.id])).rows[0].count;
      if(failed>0) throw new Error('All QC checks must pass before Ready for Pickup');
      const reservations=(await client.query(`SELECT * FROM inventory_reservations WHERE order_id=$1 AND status='ACTIVE' FOR UPDATE`,[order.id])).rows;
      for(const r of reservations){
        const upd=await client.query('UPDATE products SET stock_qty=stock_qty-$1 WHERE id=$2 AND stock_qty >= $1 RETURNING stock_qty',[r.qty,r.product_id]);
        if(!upd.rowCount) throw new Error('Insufficient physical stock to finish job');
        await client.query(`UPDATE inventory_reservations SET status='CONSUMED',released_at=NOW() WHERE id=$1`,[r.id]);
        await client.query(`INSERT INTO inventory_movements(product_id,order_id,movement_type,qty,note) VALUES($1,$2,'PRODUCTION_CONSUMPTION',$3,$4)`,[r.product_id,order.id,-num(r.qty),`Consumed when ${order.order_no} reached READY_FOR_PICKUP`]);
      }
      await client.query(`UPDATE production_jobs SET qc_passed_at=NOW(),updated_at=NOW() WHERE order_id=$1`,[order.id]);
    }
    const q=await client.query(`UPDATE orders SET status=$1, updated_at=NOW(), finished_at=CASE WHEN $1='READY_FOR_PICKUP' THEN COALESCE(finished_at,NOW()) ELSE finished_at END, picked_up_at=CASE WHEN $1='PICKED_UP' THEN COALESCE(picked_up_at,NOW()) ELSE picked_up_at END, stock_posted_at=CASE WHEN $1='READY_FOR_PICKUP' THEN COALESCE(stock_posted_at,NOW()) ELSE stock_posted_at END WHERE id=$2 RETURNING *`,[next,order.id]);
    await client.query('INSERT INTO order_events(order_id,status,actor,note) VALUES($1,$2,$3,$4)',[order.id,next,req.body.actor||'Operator',req.body.note||null]);
    await client.query('COMMIT'); res.json(q.rows[0]);
  }catch(e){await client.query('ROLLBACK');res.status(400).json({error:e.message});}finally{client.release();}
});

app.post('/api/inventory/adjust', async (req,res)=>{
  const {product_id,qty,note}=req.body;
  const q=await pool.query('UPDATE products SET stock_qty=stock_qty+$1 WHERE id=$2 RETURNING *',[num(qty),product_id]);
  if(!q.rowCount) return res.status(404).json({error:'Product not found'});
  await pool.query(`INSERT INTO inventory_movements(product_id,movement_type,qty,note) VALUES($1,'MANUAL_ADJUSTMENT',$2,$3)`,[product_id,num(qty),note||'Manual adjustment']);
  res.json(q.rows[0]);
});

app.get('/api/dashboard', async (_,res)=>{
  const [orders,stock,finance,workload,machines]=await Promise.all([
    pool.query(`SELECT COUNT(*)::int total, COUNT(*) FILTER(WHERE status = ANY($1))::int active, COUNT(*) FILTER(WHERE status='READY_FOR_PICKUP')::int ready_pickup, COUNT(*) FILTER(WHERE status='PICKED_UP')::int picked_up, COUNT(*) FILTER(WHERE due_at<NOW() AND status NOT IN ('READY_FOR_PICKUP','PICKED_UP'))::int overdue FROM orders`,[ACTIVE_STATUSES]),
    pool.query(`SELECT COUNT(*) FILTER(WHERE (stock_qty-COALESCE(r.reserved_qty,0))<=min_stock)::int low_stock, COALESCE(SUM(stock_qty*cost_price),0) inventory_value, COALESCE(SUM(r.reserved_qty),0) reserved_qty FROM products p LEFT JOIN (SELECT product_id,SUM(qty) reserved_qty FROM inventory_reservations WHERE status='ACTIVE' GROUP BY product_id) r ON r.product_id=p.id WHERE p.active=TRUE`),
    pool.query(`SELECT COALESCE(SUM(grand_total),0) revenue, COALESCE(SUM(cost_estimate),0) estimated_cogs, COALESCE(SUM(grand_total-cost_estimate),0) gross_profit, CASE WHEN COALESCE(SUM(grand_total),0)=0 THEN 0 ELSE ROUND((SUM(grand_total-cost_estimate)/SUM(grand_total))*100,2) END gross_margin_pct FROM orders WHERE payment_status='PAID'`),
    pool.query(`SELECT status,COUNT(*)::int count FROM orders GROUP BY status ORDER BY count DESC`),
    pool.query(`SELECT status,COUNT(*)::int count FROM machines WHERE active=TRUE GROUP BY status`)
  ]);
  res.json({orders:orders.rows[0],stock:stock.rows[0],finance:finance.rows[0],workload:workload.rows,machines:machines.rows});
});

initDb().then(()=>app.listen(port,()=>console.log(`POSPRINT listening on ${port}`))).catch(err=>{console.error(err);process.exit(1);});
