import express from 'express';
import pg from 'pg';

const { Pool } = pg;
const app = express();
const port = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined });

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

const STATUSES = ['PAID','FILE_PREP','PRINTING','FINISHING','QC','FINISHED','PICKED_UP'];

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
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
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
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      order_no TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT,
      status TEXT NOT NULL DEFAULT 'PAID',
      payment_status TEXT NOT NULL DEFAULT 'PAID',
      subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
      addon_total NUMERIC(14,2) NOT NULL DEFAULT 0,
      grand_total NUMERIC(14,2) NOT NULL DEFAULT 0,
      cost_estimate NUMERIC(14,2) NOT NULL DEFAULT 0,
      notes TEXT,
      due_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      picked_up_at TIMESTAMPTZ,
      stock_posted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
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

  const count = await pool.query('SELECT COUNT(*)::int AS count FROM products');
  if (!count.rows[0].count) {
    await pool.query(`INSERT INTO products(sku,name,material_category,machine_category,unit,cost_price,sell_price,stock_qty,min_stock) VALUES
      ('ART260-A3','Art Paper 260gsm A3+','Art Paper','Digital Press','sheet',1800,4500,1500,300),
      ('FLEX280','Flexi 280gsm','Outdoor','Large Format Outdoor','m2',12000,35000,220,40),
      ('STK-VINYL','Sticker Vinyl Glossy','Sticker Large Format','Large Format Eco Solvent','m2',18000,50000,180,30)
    `);
  }
}

function num(v) { return Number(v || 0); }
function orderNo() { return `PP-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${Math.floor(1000 + Math.random()*9000)}`; }

app.get('/health', (_, res) => res.json({ ok: true, service: 'POSPRINT' }));
app.get('/admin', (_, res) => res.sendFile(process.cwd() + '/public/admin.html'));
app.get('/operator', (_, res) => res.sendFile(process.cwd() + '/public/operator.html'));

app.get('/api/meta', async (_, res) => {
  const [p,a] = await Promise.all([
    pool.query('SELECT * FROM products WHERE active=TRUE ORDER BY material_category,name'),
    pool.query('SELECT * FROM addons WHERE active=TRUE ORDER BY category,name')
  ]);
  res.json({ statuses: STATUSES, products: p.rows, addons: a.rows });
});

app.post('/api/products', async (req,res) => {
  const b=req.body;
  const q=await pool.query(`INSERT INTO products(sku,name,material_category,machine_category,unit,cost_price,sell_price,stock_qty,min_stock)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[b.sku,b.name,b.material_category,b.machine_category,b.unit||'pcs',num(b.cost_price),num(b.sell_price),num(b.stock_qty),num(b.min_stock)]);
  res.status(201).json(q.rows[0]);
});

app.get('/api/orders', async (_,res) => {
  const q=await pool.query(`SELECT o.*, COALESCE(json_agg(DISTINCT jsonb_build_object('id',oi.id,'name',p.name,'qty',oi.qty,'unit',p.unit,'file_name',oi.file_name)) FILTER (WHERE oi.id IS NOT NULL),'[]') items
    FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id LEFT JOIN products p ON p.id=oi.product_id
    GROUP BY o.id ORDER BY o.created_at DESC LIMIT 200`);
  res.json(q.rows);
});

app.post('/api/orders', async (req,res) => {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const {customer_name,customer_phone,notes,due_at,items=[],addon_ids=[]}=req.body;
    let subtotal=0, addonTotal=0, cost=0;
    const productRows=[];
    for (const item of items) {
      const p=(await client.query('SELECT * FROM products WHERE id=$1 AND active=TRUE',[item.product_id])).rows[0];
      if(!p) throw new Error('Product not found');
      const qty=num(item.qty); const total=qty*num(p.sell_price); const lineCost=qty*num(p.cost_price);
      subtotal+=total; cost+=lineCost; productRows.push({item,p,qty,total,lineCost});
    }
    const addonRows=[];
    for (const selected of addon_ids) {
      const addonId=typeof selected==='object'?selected.id:selected;
      const aq=(await client.query('SELECT * FROM addons WHERE id=$1 AND active=TRUE',[addonId])).rows[0];
      if(!aq) continue;
      const qty=typeof selected==='object'?num(selected.qty||1):1;
      addonTotal+=qty*num(aq.sell_price); cost+=qty*num(aq.cost_price); addonRows.push({a:aq,qty});
    }
    const oq=await client.query(`INSERT INTO orders(order_no,customer_name,customer_phone,status,payment_status,subtotal,addon_total,grand_total,cost_estimate,notes,due_at)
      VALUES($1,$2,$3,'PAID','PAID',$4,$5,$6,$7,$8,$9) RETURNING *`,[orderNo(),customer_name,customer_phone,subtotal,addonTotal,subtotal+addonTotal,cost,notes,due_at||null]);
    const order=oq.rows[0];
    for(const r of productRows) await client.query(`INSERT INTO order_items(order_id,product_id,qty,unit_price,unit_cost,line_total,line_cost,file_name,file_url,width,height) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[order.id,r.p.id,r.qty,r.p.sell_price,r.p.cost_price,r.total,r.lineCost,r.item.file_name||null,r.item.file_url||null,r.item.width||null,r.item.height||null]);
    for(const r of addonRows) await client.query(`INSERT INTO order_addons(order_id,addon_id,qty,unit_price,unit_cost,line_total,line_cost) VALUES($1,$2,$3,$4,$5,$6,$7)`,[order.id,r.a.id,r.qty,r.a.sell_price,r.a.cost_price,r.qty*num(r.a.sell_price),r.qty*num(r.a.cost_price)]);
    await client.query(`INSERT INTO order_events(order_id,status,actor,note) VALUES($1,'PAID',$2,'Payment confirmed at order creation')`,[order.id,req.body.actor||'Cashier']);
    await client.query('COMMIT'); res.status(201).json(order);
  } catch(e){ await client.query('ROLLBACK'); res.status(400).json({error:e.message}); } finally{ client.release(); }
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

    if(next==='FINISHED' && !order.stock_posted_at){
      const items=(await client.query('SELECT * FROM order_items WHERE order_id=$1',[order.id])).rows;
      for(const i of items){
        const upd=await client.query('UPDATE products SET stock_qty=stock_qty-$1 WHERE id=$2 AND stock_qty >= $1 RETURNING stock_qty',[i.qty,i.product_id]);
        if(!upd.rowCount) throw new Error('Insufficient stock to finish job');
        await client.query(`INSERT INTO inventory_movements(product_id,order_id,movement_type,qty,note) VALUES($1,$2,'PRODUCTION_CONSUMPTION',$3,$4)`,[i.product_id,order.id,-num(i.qty),`Posted when ${order.order_no} reached FINISHED`]);
      }
    }
    const q=await client.query(`UPDATE orders SET status=$1, updated_at=NOW(), finished_at=CASE WHEN $1='FINISHED' THEN COALESCE(finished_at,NOW()) ELSE finished_at END, picked_up_at=CASE WHEN $1='PICKED_UP' THEN COALESCE(picked_up_at,NOW()) ELSE picked_up_at END, stock_posted_at=CASE WHEN $1='FINISHED' THEN COALESCE(stock_posted_at,NOW()) ELSE stock_posted_at END WHERE id=$2 RETURNING *`,[next,order.id]);
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
  const [orders,stock,finance,workload]=await Promise.all([
    pool.query(`SELECT COUNT(*)::int total, COUNT(*) FILTER(WHERE status NOT IN ('FINISHED','PICKED_UP'))::int active, COUNT(*) FILTER(WHERE status='PICKED_UP')::int picked_up FROM orders`),
    pool.query(`SELECT COUNT(*) FILTER(WHERE stock_qty<=min_stock)::int low_stock, COALESCE(SUM(stock_qty*cost_price),0) inventory_value FROM products WHERE active=TRUE`),
    pool.query(`SELECT COALESCE(SUM(grand_total),0) revenue, COALESCE(SUM(cost_estimate),0) estimated_cogs, COALESCE(SUM(grand_total-cost_estimate),0) gross_profit FROM orders WHERE payment_status='PAID'`),
    pool.query(`SELECT status,COUNT(*)::int count FROM orders GROUP BY status ORDER BY count DESC`)
  ]);
  res.json({orders:orders.rows[0],stock:stock.rows[0],finance:finance.rows[0],workload:workload.rows});
});

initDb().then(()=>app.listen(port,()=>console.log(`POSPRINT listening on ${port}`))).catch(err=>{console.error(err);process.exit(1);});
