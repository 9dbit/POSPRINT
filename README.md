# POSPRINT

POS khusus workflow digital printing dengan dua UI:

- `/admin` — internal admin, order, produk, inventory, financial snapshot.
- `/operator` — production floor board untuk File Prep → Printing → Finishing → QC → Finished → Picked Up.

## Inventory rule
Material tidak dipotong ketika order dibuat/dibayar. Stok baru diposting sebagai `PRODUCTION_CONSUMPTION` saat order mencapai `FINISHED`. Ini menjaga reservation/produksi tetap terpisah dari konsumsi aktual.

## Workflow
`PAID → FILE_PREP → PRINTING → FINISHING → QC → FINISHED → PICKED_UP`

## Product master
Setiap produk menyimpan SKU, kategori bahan, kategori mesin, unit, harga pokok, harga jual, stok, dan minimum stok.

## Add-ons bawaan
- Print Art Paper: Finish Cutting Manual, Cutting Die Cut, Laminating, Laminasi 1 Sisi, Laminasi 2 Sisi, Lipat 1, Lipat 2, Perforasi.
- Print Outdoor: Seaming Keliling, Ring Banner, Seaming Sambungan, Selongsong.
- Print Sticker Large Format: Cutting Kiss Cut, Transfer Sticker.

## Production standards prepared
QC stage, operator event log, actual inventory movement, low-stock threshold, COGS/gross profit snapshot, due date fields, file metadata fields, manual inventory adjustment, and picked-up timestamp.

## Environment
- `DATABASE_URL` required (PostgreSQL)
- `PORT` provided by Railway

## Next hardening slice
Role-based auth, file upload/object storage, purchase orders & suppliers, material reservation, wastage/reprint capture, per-machine queue, payment methods/receipts, discounts/tax, customer CRM, audit exports, and multi-branch support.
