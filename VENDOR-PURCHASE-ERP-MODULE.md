# Purchase Order & Vendor Credit Module — Build Document

**Project:** Mehndi Management System
**Module:** Raw-material purchasing + vendor credit (accounts payable) management
**Built:** 2026-11-21
**Stack:** Express 4 + Sequelize 6 + SQLite (backend) · Angular 22 standalone components + signals (frontend)

---

## 1. Kya banaya gaya (Summary)

Aapke kahe mutabiq ek **ERP-standard purchasing + vendor khata system** banaya gaya hai:

1. **Vendor master** — har supplier ka record, credit limit aur payment terms (din) ke saath.
2. **Purchase Order management for raw products** — vendor-wise, multi-line orders, draft → confirm → receive → close pura lifecycle.
3. **Credit management (debit/credit ledger)** — har vendor ka ek payable ledger jismein har transaction automatically post hota hai, running balance ke saath.
4. **Order number ke against credit update** — payment ya adjustment direct ek PO number par tag kiya ja sakta hai; us order ka outstanding automatically kam ho jata hai.
5. **Goods Receipt (GRN)** — stock increase + vendor par credit (invoice) dono ek hi transaction mein.
6. **Purchase Return** — stock decrease + vendor par debit (credit note) dono ek saath.
7. **Reports section** — 3 naye report tabs: Purchase Order register, Vendor Balances & Ageing, Purchase Summary.
8. **Missing ERP features jo maine khud add kiye** — credit-limit guard, payable ageing buckets, over-receipt/over-return guards, document numbering, print-friendly vendor statement, dashboard payable KPIs, vendor delete protection, manual journal adjustments (credit/debit note).

Sab kuch **single source of truth** par bana hai: paisa sirf `vendor_ledger_entries` table mein rehta hai. Order ka outstanding, vendor ka balance, dashboard ka payable, aur reports — sab wahin se derive hote hain, isliye kabhi aapas mein mismatch nahi ho sakta.

---

## 2. Kaise chalayein

```bash
# Terminal 1 — backend (http://localhost:3001)
cd backend
npm install
npm start          # pehli baar mein tables ban jayengi + 3 vendors seed honge

# Terminal 2 — frontend (http://localhost:4200)
cd frontend
npm install
npm start
```

Login: `admin` / `admin123`.

> **SQLite note:** backend `sync({ force: false })` chalata hai — **nayi tables apne aap ban jati hain**, lekin **pehle se maujood tables mein naye columns add nahi hote**. Chunki is module ki 9 nayi tables hain, clean start par kuch karne ki zaroorat nahi. Agar aap baad mein kisi model mein column add karenge to `mehndi_inventory.sqlite` drop/recreate ya manual migration karna padega.

---

## 3. Data model — 9 nayi tables

### 3.1 `vendors` — Vendor master
| Column | Type | Notes |
|---|---|---|
| `id` | INT PK | |
| `name` | STRING | unique |
| `code` | STRING | unique, e.g. `VND-001` |
| `contactPerson`, `phone`, `email`, `address`, `city`, `ntn` | STRING/TEXT | |
| `creditLimit` | DECIMAL(12,2) | **0 = no limit** |
| `paymentTermsDays` | INT | due date = order date + ye din (ageing ke liye) |
| `openingBalance` | DECIMAL(12,2) | puranalena, ledger se alag |
| `status` | ENUM(`Active`,`Inactive`) | Inactive vendor par naya order/payment block |
| `remarks`, `createdBy` | TEXT / INT | |

### 3.2 `purchase_orders` — PO header
| Column | Type | Notes |
|---|---|---|
| `poNumber` | STRING unique | `PO-YYYYMMDD-NNNN` |
| `vendorId` | INT FK | |
| `orderDate`, `expectedDate` | DATEONLY | |
| `status` | ENUM(`Draft`,`Ordered`,`Partially Received`,`Received`,`Cancelled`) | |
| `vendorInvoiceNumber`, `vendorInvoiceDate` | STRING/DATEONLY | vendor ka apna bill ref |
| `subtotal` | DECIMAL | lines ka total (gross) |
| `discountAmount` | DECIMAL | header-level |
| `taxPercent`, `taxAmount` | DECIMAL | header-level % |
| `totalAmount` | DECIMAL | net payable value of the order |
| `paymentMode` | ENUM(`Credit`,`Advance`,`Cash on Delivery`) | default `Credit` |
| `remarks` | TEXT | |
| `createdBy`, `confirmedBy`, `confirmedAt`, `cancelledBy`, `cancelledAt`, `cancelReason` | | audit trail |

### 3.3 `purchase_order_items` — PO lines
`purchaseOrderId`, `rawProductId`, `quantityOrdered`, `unitRate`, `quantityReceived`, `quantityReturned`, `remarks`.
> Sirf **ordered** quantity hi line par store hoti hai; discount/tax header-level hai, isliye line values proportional rule se nikalti hain (section 6).

### 3.4 `goods_receipts` + 3.5 `goods_receipt_items`
Header: `grnNumber` (`GRN-…`), `purchaseOrderId`, `vendorId`, `receivedDate`, `vendorInvoiceNumber`, `otherCharges` (freight/loading), `goodsValue`, `creditedAmount`, `remarks`.
Lines: `goodsReceiptId`, `purchaseOrderItemId`, `rawProductId`, `quantityReceived`, `unitRate`, `lineAmount`.

### 3.6 `purchase_returns` + 3.7 `purchase_return_items`
Header: `returnNumber` (`PR-…`), `purchaseOrderId`, `vendorId`, `returnDate`, `reason` ENUM(`Damaged`,`Wrong Item`,`Excess Quantity`,`Quality Issue`,`Expired`,`Other`), `goodsValue`, `debitedAmount`.
Lines: `purchaseReturnId`, `purchaseOrderItemId`, `rawProductId`, `quantityReturned`, `unitRate`, `lineAmount`.

### 3.8 `vendor_payments`
`voucherNumber` (`PAY-…`), `vendorId`, **`purchaseOrderId` (nullable — order-specific payment ya vendor-level advance)**, `paymentDate`, `amount`, `paymentType` ENUM(`Payment`,`Advance`,`Refund Received`), `method` ENUM(`Cash`,`Bank Transfer`,`Cheque`,`Journal`,`EasyPaisa`,`JazzCash`,`Other`), `referenceNumber`, `remarks`.

### 3.9 `vendor_ledger_entries` — dil of the module
| Column | Type | Notes |
|---|---|---|
| `vendorId`, `entryDate` | INT / DATEONLY | |
| `voucherNumber` | STRING | `PO`/`GRN`/`PR`/`PAY`/`ADJ-<ts>` |
| `entryType` | ENUM | `Opening Balance`, `Purchase Invoice`, `Purchase Return`, `Payment`, `Credit Note`, `Debit Note`, `Manual Adjustment` |
| `direction` | ENUM(`Credit`,`Debit`) | **Credit = dena badhta hai, Debit = dena kam hota hai** |
| `amount` | DECIMAL(12,2) | |
| `balanceAfter` | DECIMAL(14,2) | har row par snapshot — statement kabhi reconcile nahi hota |
| `referenceType`, `referenceId` | STRING / INT | kis document se aaya (`goods-receipt`, `vendor-payment`, `purchase-return`, `adjustment`) |
| **`purchaseOrderId`** | INT nullable | **order-number ke against tracking** — poora order history isi column se filter hota hai |
| `narration`, `createdBy` | TEXT / INT | |

**Indexes:** `vendorId`, `purchaseOrderId`, `entryDate` — kyunke har balance/ageing query inhi par group hoti hai.

---

## 4. Accounting convention (bohat zaroori)

Hamara ledger **vendor ke nazar se payable** dikhata hai (accounts-payable ledger, bank statement ki tarah ulta nahi):

| Event | Ledger | Stock |
|---|---|---|
| Goods Receipt (GRN) | **Credit** `creditedAmount` | `currentStock += qty` (`Stock In`) |
| Purchase Return | **Debit** `debitedAmount` | `currentStock -= qty` (`Stock Out`) |
| Vendor Payment | **Debit** `amount` | — |
| Credit Note (manual, vendor ne diya) | **Debit** | — |
| Debit Note / Manual Adjustment (extra charge) | **Credit** | — |
| Vendor opening balance | `openingBalance` column (ledger row nahi) | — |

```
Vendor payable = openingBalance + SUM(Credit) − SUM(Debit)
Order outstanding (PO-xxx) = SUM(Credit where purchaseOrderId = xxx) − SUM(Debit where purchaseOrderId = xxx)
```

---

## 5. Document numbering

`backend/services/vendorLedger.js` → `nextDocumentNumber()` har din ka apna 4-digit sequence chalata hai:

| Prefix | Document | Example |
|---|---|---|
| `PO-` | Purchase Order | `PO-20261121-0004` |
| `GRN-` | Goods Receipt Note | `GRN-20261121-0003` |
| `PAY-` | Vendor Payment voucher | `PAY-20261121-0003` |
| `PR-` | Purchase Return | `PR-20261121-0002` |
| `ADJ-<timestamp>` | Manual adjustment | `ADJ-1763733123456` |

---

## 6. Valuation rule — discount & tax proportional hain

Discount aur tax **order header** par hain, lekin receipts/returns **partial** hote hain. Isliye har line ki asli cost nikalne ke liye do factors bante hain (`buildPricingFactors()`):

```js
netRatio       = (subtotal − discountAmount) / subtotal   // discount ke baad
taxMultiplier  = 1 + taxPercent / 100                     // tax ke saath
lineCost(gross) = round2(gross × netRatio × taxMultiplier)
```

**Worked example (live data):** order subtotal 6,800, discount 500, tax 5% → `netRatio = 0.926470588`, `taxMultiplier = 1.05`, order total `6,300 × 1.05 = 6,615`.
GRN par 5,550 gross aaya → `5,550 × 0.926470588 × 1.05 = 5,399.01` + `200` freight = **Rs 5,599.01 credit**.
Return 250 gross → `250 × 0.926470588 × 1.05 = 243.20` → **Rs 243.20 debit**.

Iska faayda: 3 alag GRN bhi banao to teeno ka total hamesha order ke `totalAmount` se mil jata hai.

---

## 7. Purchase Order lifecycle

```
Draft ──confirm──▶ Ordered ──partial GRN──▶ Partially Received ──full GRN──▶ Received
  │                   │                                                          │
  └── delete          └── cancel (only with 0 receipts & 0 outstanding)          │
        (Draft only)                                                    return via Purchase Return
```

**Guards (sab server-side, har ek transaction rollback karta hai):**
- Edit / delete sirf `Draft` par.
- **Confirm** par credit-limit check: `current balance + totalAmount > creditLimit` → reject.
- **Create with `confirm: true`** (ek hi call mein banao + confirm) par bhi wahi check.
- Cancel sirf tab jab koi GRN na hua ho **aur** outstanding 0 ho — warna pehle return/settle karo.
- `Received` order cancel nahi hota — Purchase Return use karo.
- Over-receipt block: `Cannot receive X. Only Y still pending on PO-…`
- Over-return block: pending-receivable se zyada, ya store mein available stock (`currentStock`) se zyada return nahi.
- Inactive vendor par naya order ya payment block.

---

## 8. Credit limit guard

`checkCreditLimit(vendor, projectedBalance)` — har credit-side movement se pehle chalta hai:

- `creditLimit = 0` → **no limit** (e.g. Al-Madina Stationery).
- Projected payable > limit → HTTP 400 + message:
  `Credit limit exceeded for vendor "X". Limit: Rs. 150,000, projected payable: Rs. 200,000. Increase the vendor credit limit or reduce the amount.`

Applied on: order create-with-confirm, order confirm, goods receipt, vendor-level/manual **Credit** adjustment. (Payments/debits par nahi lagta — dena kam karna kabhi blocked nahi.)

---

## 9. Stock integration

Receipt aur return dono `inventory_transactions` mein row banate hain (`referenceType: 'purchase-order'`) aur `raw_products.currentStock` update karte hain — **ek hi DB transaction ke andar**, ledger entry ke saath. Matlab: stock aur khata hamesha saath move hote hain, ek fail hua to dono fail.

**Live verified:** Nosheen Wrapper `990 → 1,140` (+150 GRN) `→ 1,130` (−10 return) — ledger ke saath same transaction mein, aur figures reconcile.

---

## 10. API reference

Sab endpoints JWT-protected hain (`Authorization: Bearer <token>`).

### Vendors — `/api/vendors`
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Vendor list + derived: `totalPurchases`, `totalPaid`, `payableBalance`, `availableCredit`, `creditUsagePercent`, `overLimit`, `totalOrders`, `openOrders`, `lastOrderDate` |
| `GET` | `/:id` | Single vendor + credit position |
| `POST` | `/` | Create vendor |
| `PUT` | `/:id` | Update vendor |
| `DELETE` | `/:id` | Delete — **sirf bina history ke**; orders/ledger ho to error "Mark it Inactive instead" |
| `GET` | `/:id/ledger?startDate=&endDate=` | **Vendor statement**: `openingBalance` (b/d), rows with `runningBalance`, `totalCredit`, `totalDebit`, `closingBalance` |
| `GET` | `/:id/open-orders` | Unsettled orders — payment modal ki dropdown isi se banti hai |
| `POST` | `/:id/payments` | Payment post karo; `purchaseOrderId` bhejo to **order ke against** |
| `GET` | `/:id/payments` | Payment history (vouchers) |
| `POST` | `/:id/adjustments` | Manual `Credit Note` / `Debit Note` / `Manual Adjustment`, order ke against bhi |

### Purchase Orders — `/api/purchase-orders`
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/?status=&vendorId=&startDate=&endDate=&search=` | Register (filters + poNumber search) |
| `GET` | `/:id` | **Poora order document**: lines, receipts, returns, payments, aur us order ki ledger entries |
| `POST` | `/` | Create (body: `vendorId, orderDate, expectedDate, items[], discountAmount, taxPercent, paymentMode, remarks, confirm`) |
| `PUT` | `/:id` | Update (Draft only) |
| `PATCH` | `/:id/status` | `{ action: 'confirm' \| 'cancel', reason }` |
| `DELETE` | `/:id` | Delete Draft |
| `POST` | `/:id/receipts` | GRN: `{ receivedDate, vendorInvoiceNumber, otherCharges, remarks, lines:[{purchaseOrderItemId, quantityReceived, unitRate?}] }` |
| `POST` | `/:id/returns` | Purchase Return: `{ returnDate, reason, remarks, lines:[{purchaseOrderItemId, quantityReturned}] }` |

Har order response mein derived fields: `billedAmount`, `settledAmount`, `outstanding`, `receivedPercent`, `totalOrderedQty`, `totalReceivedQty`, `totalReturnedQty`, `receiptCount`, `returnCount`, `paymentCount`, `isFullyReceived`, `isSettled`, aur line-level `lineAmount`, `remainingQuantity`, `returnableQuantity`, `receivedValue`, `returnedValue`.

### Reports — `/api/reports`
| Endpoint | Params | Detail |
|---|---|---|
| `GET /purchase-orders` | `startDate, endDate, vendorId, status, search` | `{ rows[], summary{} }` — row per order: qty ordered/received, `receivedPercent`, orderValue, billedValue, outstanding. Summary: status counts, `openOrders`, `unpaidOrders`, totals |
| `GET /vendor-balances` | — | Per vendor: `payableBalance`, `creditLimit`, `availableCredit`, `overLimit`, `paymentTermsDays`, **ageing** `{ notDue, d1to30, d31to60, d61to90, d90Plus }`, `oldestOverdueDays`, `openOrders`, totals credit/debit |
| `GET /purchase-summary` | `startDate, endDate, vendorId` | Do views: **byProduct** (ordered/received/returned qty + value) aur **byVendor** (orders, orderValue, receivedValue, returnedValue) |

---

## 11. Frontend — screens

### Naye components
| Screen | Route | File |
|---|---|---|
| Vendors | `/vendors` | `frontend/src/app/components/vendors/*` |
| Purchase Orders | `/purchase-orders` | `frontend/src/app/components/purchase-orders/*` |
| Vendor Ledger | `/vendor-ledger` | `frontend/src/app/components/vendor-ledger/*` |

Sab lazy-loaded hain (`app.routes.ts`) aur sidebar mein naye group **"Purchasing & Vendor Accounts"** ke neeche (icons: `storefront`, `request_quote`, `receipt_long`).

> **Icon note:** Material Symbols Outlined (Google Fonts) mein `purchase_order` ligature is build mein maujood nahi — us naam ko use karne par icon ki jagah bara-bara **"PURCHASE_ORDER" text** render hota hai. Isliye `request_quote` use kiya gaya hai. Koi naya icon add karte waqt naam font mein confirm kar lein.

### 11.1 Vendors screen
Vendor table with live payable, available credit, credit-usage bar, over-limit badge, order count, last order date. Create/edit modal. Do action modals:
- **Record Payment** — amount, date, type, method, reference, aur **Order dropdown (`/open-orders`)** — order chuno to payment us PO number ke against post hota hai. Vendor-level advance ke liye order khali chhodo.
- **Manual Adjustment** — Credit Note / Debit Note / Manual Adjustment, direction, order ke against.

### 11.2 Purchase Orders screen
Teen view ek hi component mein:
1. **Register** — summary cards, filter bar (vendor / status / date range / PO search), table with progress bar (received %), outstanding vs settled cell, status badges. Row actions status ke hisaab se: Edit/Delete (Draft) · Confirm · Receive · Return · Cancel · View.
2. **Create / Edit form** — left: dynamic line rows (raw product dropdown, qty, rate, live line amount, add/remove); right: sticky totals panel (subtotal, discount, tax %, tax amount, **net total payable**), vendor + dates + payment mode + remarks. "Save as Draft" aur "Save & Confirm" dono.
3. **Modals** — Order Detail (banner: billed / settled / outstanding; sections Lines, Goods Receipts, Purchase Returns, Ledger Against This Order) · Receive Goods (per-line pending qty prefilled, other charges, invoice no) · Purchase Return (returnable qty ke against, reason dropdown) · Cancel (reason).

### 11.3 Vendor Ledger screen
Vendor selector + date range + quick chips (7/30/90 days, financial-year, all) + **Print statement** button (`@media print` block filter bar ko chhupa deta hai).
4 summary cards (Opening Credit / Total Credit / Total Debit / Closing) → ledger table: Date · Voucher · Type · Narration · **Debit** · **Credit** · Balance, with b/d opening row aur closing row. Neeche **Payment Vouchers** table.

### 11.4 Reports screen — 3 naye tabs
- **Purchase Orders** — 8 summary cards + filters + 10-column register.
- **Vendor Balances & Ageing** — 5-segment colour-coded ageing bar per vendor (Not due / 1-30 / 31-60 / 61-90 / 90+), limit usage, overdue total, over-limit highlight.
- **Purchase Summary** — By Product / By Vendor toggle (chips) with date + vendor filters.

### 11.5 Dashboard
4 naye KPI cards: **Payable To Vendors**, **Overdue Vendor Dues**, **Open Purchase Orders**, **Vendors Over Credit Limit** + **Recent Purchase Orders** panel (link → `/purchase-orders`).

### Shared
- `frontend/src/app/shared/money.ts` → `money(v)` (Rs. + `en-PK` locale), `today()`.
- `ApiService` mein 18 naye methods (vendors, POs, receipts, returns, 3 reports).

---

## 12. Seed data

`backend/config/initDb.js` pehli baar chalne par 3 vendors banata hai:

| Code | Name | Credit limit | Terms |
|---|---|---|---|
| `VND-001` | Nosheen Packaging Industries | Rs 150,000 | 30 days |
| `VND-002` | Supreme Henna Supplies | Rs 250,000 | 45 days |
| `VND-003` | Al-Madina Stationery | No limit | 15 days |

---

## 13. Verification — poora cycle live chala kar reconcile kiya

Ek order ka pura cycle chalaya aur har figure cross-check kiya:

| Step | Document | Ledger | Running |
|---|---|---|---|
| Order create + confirm | `PO-20261121-0004` (total Rs 6,615) | — | 0 |
| Goods receipt (5,550 gross + 200 freight) | `GRN-20261121-0003` | **Credit 5,599.01** | 5,599.01 |
| Purchase return (250 gross) | `PR-20261121-0002` | **Debit 243.20** | 5,355.81 |
| Payment against order number | `PAY-20261121-0003` | **Debit 3,000.00** | 2,355.81 |
| Manual credit note against order | `ADJ-…` | **Debit 355.81** | **2,000.00** |

**Result:** order outstanding `2,000.00` = vendor payable `2,000.00` = ledger closing balance `2,000.00` = reports `totalOutstanding`. ✅

**Guards tested live:** over-receipt rejected · over-return rejected · payment > that order's outstanding rejected with guidance · Rs 200,000 credit note rejected by credit limit · vendor with no limit allowed · cancelled order payment blocked.

**Build status:** `ng build --configuration development` → clean, no errors/warnings.

---

## 14. Caveats & known limits (zaroor padhein)

1. **Backend restart ho chuka hai (2026-11-21) — sab fixes live.** Is dauran ek asli Sequelize limitation saamne aaya: **jab ek saath kaafi associations eager-load hote hain to include-level `order` ignore ho jata hai.** Akele `ledgerEntries` include par `order: [['entryDate','ASC'],['id','ASC']]` lagane par rows `6,7,8,9` aati thin, lekin poore route ke 8 includes ke saath `9,6,8,7` aa rahi thin.
   → Fix: include-level `order` hata kar `GET /api/purchase-orders/:id` mein **JS sort** kiya gaya hai (`byDateThenId`). Ab order document chronologically padha jata hai: GRN credit 5,599.01 → PR debit 243.20 → PAY debit 3,000 → ADJ debit 355.81, balance 2,000 par khatam.
   **Agar aap isi query mein koi aur association add karein to `order` clause par bharosa na karein — sort explicit karein.**
2. **UI pixel-level verify nahi ho saka** — screenshots is environment mein available nahi the (`NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`). UI **structurally** verify kiya: accessibility snapshots, DOM reads, real API round-trips, correct numbers, working modals/routes. Layout/spacing aapko browser mein dekh leni chahiye.
3. **Test data DB mein mojood hai.** Saaf karne ke liye UI se: cancelled `PO-0001`/`PO-0002` (Draft par delete possible nahi, cancelled hain to records rahenge), `PO-0003` remarks "Automation test order", `PO-0004` remarks "Browser verification order" + Rs 2,000 outstanding, aur `PO-0002` par ek intentionally over-limit Rs 50,000,000 line. Fresh start chahiye to `backend/mehndi_inventory.sqlite` delete karke `npm start` chalayein (sab data chala jayega).
4. **Payment against order ledger se verify hota hai, order status se nahi** — isliye puri receipt hone se pehle bhi advance settle kar sakte ho.
5. **No partial payment allocation engine** — ek payment ek hi order par jati hai ya vendor-level rehti hai. Multi-order auto-adjust (oldest-first) abhi nahi hai.
6. **Discount/tax proportional rule** (section 6) exact paise tak round karta hai; 3+ receipts par Re 1 tak ka rounding difference aa sakta hai. Order close hone par ledger balance hi final payable hai (jo correct hai — order total estimate hai).
7. **Multi-currency, GST filing formats, PO approval workflow (multi-level), vendor statements as PDF** — intentionally out of scope.
8. **`inventory_transactions` mein naye transaction types add nahi kiye** (SQLite `sync` existing table alter nahi karta) — receipts/returns existing `Stock In`/`Stock Out` use karte hain with `referenceType: 'purchase-order'`.

---

## 15. Agla step (suggestive, agar aage le jana ho)

- Vendor bill ** aging report with due-date reminders** (email/whatsapp)
- Multi-order **payment allocation** (FIFO auto-adjust)
- **Reorder point** par auto-draft PO (raw product ke minimum stock se linked)
- **Production batches ↔ raw consumption** ka purchase price se **actual COGS** calculation
- PO **print/PDF** with vendor signature block, aur **3-way match** (PO ↔ GRN ↔ vendor invoice)

---

## 16. Deployment — live URLs (2026-11-21)

### Architecture (sab kuch ek hi origin par)
`backend/server.js` pehle se `frontend/dist/frontend/browser` ko static + SPA fallback ke saath serve karta hai (`app.get('*')`). Isliye **frontend host, CORS config aur alag backend URL ki zaroorat nahi** — ek hi public hostname par app bhi aur `/api/*` bhi.

- **API base URL ab environment-driven + relative hai:** `frontend/src/environments/environment.production.ts` → `apiUrl: '/api'`. `angular.json` ke production configuration mein `fileReplacements` lagaya gaya hai, isliye `ng build --configuration production` waali bundle mein `/api` jata hai aur dev build `http://localhost:3001/api` par rehti hai.
- **Mtlab:** domain change karne par **dobara build karne ki zaroorat nahi** — wahi bundle naye hostname par chalega.

### Live URL (abhi chal raha hai)
```
https://saw-professional-warren-reductions.trycloudflare.com
```
- App: `/` · API: `/api/...`
- **Yeh "quick tunnel" URL temporary hai** — process restart hone par naya random hostname milta hai. Permanent hostname ke liye neeche wala named-tunnel section dekhein.
- Shart: yeh PC on aur `cloudflared` chal raha hona chahiye (data `backend/mehndi_inventory.sqlite` par hi rehta hai, koi doosra server nahi).

### Kaise verify kiya gaya (public URL ke through)
| Check | Result |
|---|---|
| `GET /` | 200 (Angular app) |
| `POST /api/auth/login` (admin) | 200 + JWT |
| `GET /api/vendors` bina token | **401** |
| `GET /api/vendors` token ke saath | 200 |
| `GET /api/purchase-orders` | 200 |
| `GET /api/reports/vendor-balances` | 200 |

### Dobara start karna (reboot ke baad)
```bash
# ek command: backend + public tunnel
npm run public

# ya alag alag
cd backend && npm start
cloudflared tunnel --no-autoupdate --url http://localhost:3001
```
Tunnel ki shuruaat mein jo `https://....trycloudflare.com` URL chhapta hai wahi public address hai.

### Public deploy se pehle kiye gaye security changes
Yeh teen cheezein publicly expose karne se pehle zaroori thin, isliye kar di gayin:
1. `frontend/src/app/components/login/login.html` se **"Default credentials: admin / admin123"** ka printed hint hata diya (public site par password likha hua milna).
2. `backend/middleware/auth.js` ab **fail-fast** karta hai: `JWT_SECRET` missing ya 16 characters se chhota ho to server start nahi hota (pehle `mehndi_secret_token_12345` fallback tha). `routes/auth.js` se bhi wahi fallback hataya. Aapka root `.env` pehle se 33-character custom secret rakhta hai — **value kabhi print nahi ki gayi**, sirf length check ki.
3. `middleware/auth.js` ab root `.env` bhi load karta hai (pehle sirf `backend/.env` dhundhta tha, jo exist nahi karta).

**Abhi bhi khula hai:** `app.use(cors())` (server.js:21) har origin allow karta hai. Chunki app same-origin `/api` use karta hai aur token `Authorization` header se aata hai (cookie nahi), iska risk kam hai — lekin production mein `ALLOWED_ORIGINS` allowlist behtar hai. Aur **admin ka password badal dein** (default `admin123` abhi bhi DB mein wahi hai).

### Permanent hostname + aapka Cloudflare DNS (recommended)
`cloudflared` install ho chuka hai (winget, `C:\Program Files (x86)\cloudflared\cloudflared.exe`). `tunnel login` ek baar browser authorization maangta hai — woh click time-out ho gaya tha, isliye yeh 4 commands aapko (ya mujhe, aapke click ke baad) chalane hain:
```bash
cloudflared tunnel login                      # browser mein Cloudflare account select + Allow
cloudflared tunnel create mehndi              # writes ~\Desktop\mehndi.json + cert.pem
cloudflared tunnel route dns mehndi mehndi.<your-domain.com>   # DNS record khud ban jayega
cloudflared tunnel run mehndi --url http://localhost:3001
```
Config file (`%USERPROFILE%\.cloudflared\config.yml`):
```yaml
tunnel: mehndi
credentials-file: C:\Users\IT\.cloudflared\<tunnel-id>.json
ingress:
  - hostname: mehndi.<your-domain.com>
    service: http://localhost:3001
  - service: http_status:404
```
Hamesha chalta rakhega to Windows service bana lein (admin terminal):
```bash
cloudflared service install
```
DNS side: `route dns` record khud bana deta hai; agar aap khud lagana chahein to **CNAME → `<tunnel-id>.cfargotunnel.com`, proxy status "Proxied" (orange cloud)** — DNS-only record tunnel se kaam nahi karega.

### Android app ke liye
Capacitor scaffold (task #11) ke baad `environment.production.ts` mein relative `/api` ko **poore `https://mehndi.<your-domain.com>/api`** se badal kar APK build karein — WebView mein relative URL kaam nahi karega.


## 17. UAC — Users & Access Control (2026-11-21)

Maqsad: **ek master account** jisko sab kuch, baaki accounts master khud banaye aur har module ke andar har action (view / create / update / delete + module ke andar ke extra rights) alag se de.

### Data model (2 nayi tables, `sequelize.sync` se ban jati hain)
| Table | Kaam |
|---|---|
| `user_module_access` | Ek row = (user, module) ke liye `canView / canCreate / canUpdate / canDelete` columns + `rights` JSON (module-specific extras). `(userId, module)` unique. |
| `access_audit_logs` | Kisne kis account ka kya badla: `actorUserId, targetUserId, module, action, changes JSON, createdAt`. |

`users.role` column ko haath nahi lagaya (SQLite + `sync({force:false})` existing table alter nahi karta) — is liye poori matrix nayi tables mein hai. `role='admin'` = master = har right, matrix ki zaroorat nahi.

### Rights matrix
Modules aur unke extras (source of truth: `backend/services/access.js`):

| Module | view | create | update | delete | Extra rights |
|---|---|---|---|---|---|
| dashboard | ✔ | | | | |
| raw-products | ✔ | ✔ | ✔ | | `stockIn`, `stockOut` |
| finished-products | ✔ | ✔ | ✔ | ✔ | |
| batches | ✔ | ✔ | ✔ | ✔ | |
| vendors | ✔ | ✔ | ✔ | ✔ | `creditLimit` |
| purchase-orders | ✔ | ✔ | ✔ | ✔ | `approve`, `cancel`, `receive`, `returnGoods` |
| vendor-ledger | ✔ | | | | `payment`, `adjust` |
| reports | ✔ | | | | |
| users | ✔ | ✔ | ✔ | ✔ | |

Role templates (ek click mein matrix): **Read only**, **Purchase / order entry**, **Store / production**, **Accounts / payments**, **Everything except user management**.

Aap ki teeno conditions yahin cover hoti hain:
- *sirf data dekh skta* → module pe sirf `view`.
- *sirf write kraw hua data show/update na kr sakay* → `create` ON, `update`/`delete` OFF → user nayi entry bana sakta hai, edit/delete uske button pe nahi aayega aur API bhi 403 degi.
- *sirf update krsakay, write na sakay* → `update` ON, `create` OFF.

### Server-side enforcement
- `backend/middleware/auth.js` ab **async** hai: JWT check ke baad `loadAccess(userId)` se grants DB se parh kar `req.access` pe lagata hai.
- `requireAccess('module','action')` har business route pe laga hai — **37 routes** (raw-products, finished-products, batches, vendors, purchase-orders, reports) + poora `/api/users`.
- Grant DB se per-request aata hai (15 second ka cache) → right lene/cheenne ka asar **logout ke bina** kuch seconds mein lag jata hai. JWT ka stale `role` claim ab decision nahi leta.
- Do fields apne-aap se nahi chhoday ( paisay wale fields ):
  - `POST /api/purchase-orders` body mein `confirm:true` **ya** `PATCH /:id/status {action:'confirm'}` → `purchase-orders.approve` zaroori. Warna sirf Draft banega.
  - `PUT /api/vendors/:id` mein `creditLimit`/`paymentTermsDays` badalne ke liye `vendors.creditLimit` chahiye, aur har tabdeel `access_audit_logs` mein `credit-terms-changed` ke tor par likhi jati hai. `POST /api/vendors` par `creditLimit>0` → `vendors.creditLimit`, `openingBalance!=0` → `vendor-ledger.adjust`.
- Self-service: `POST /api/auth/change-password` (current password verify karta hai, minimum 8 chars).
- Lockout/race rokk: aapna **apna** role/permissions/password is screen se change nahi ho sakta (server block karta hai), aakhri master account delete/demote nahi ho sakta, aur jiske business records hain usay delete karne ke bajaye password reset karne ko kaha jata hai.

### API
| Method | Path | Right |
|---|---|---|
| POST | `/api/auth/login` | — (response mein ab `access` object bhi) |
| GET | `/api/auth/me` | koi bhi signed-in (ab `access` ke sath) |
| GET | `/api/auth/access` | koi bhi signed-in |
| POST | `/api/auth/change-password` | koi bhi signed-in |
| GET | `/api/users` | `users.view` |
| GET | `/api/users/access-catalog` | `users.view` (matrix + templates UI ke liye) |
| GET | `/api/users/audit` | `users.view` |
| POST | `/api/users` | `users.create` |
| PUT | `/api/users/:id/permissions` | `users.update` |
| PUT | `/api/users/:id/role` | `users.update` |
| POST | `/api/users/:id/password` | `users.update` |
| DELETE | `/api/users/:id` | `users.delete` |

### Frontend
- `services/access.service.ts` — grants ka signal; `can(module, action)`, `canWrite(module, actions[])`; `localStorage.access` se foran hydrate hota hai (refresh pe bhi) aur login + `/api/auth/me` se update.
- `services/permission.guard.ts` — route ke `data.module` ke against check; right na ho to dashboard, aur dashboard bhi na ho to `/account` pe bhej deta hai.
- Sidebar (`layout.html`): har link `access.can(...)` pe gate; naya **Administration → Users & Access** aur sab ke liye **My Account**.
- `components/users/` — Accounts list (rights ka human summary), **Add Account** (username/password/account type + matrix), **Edit Access** modal (module × action grid + role templates), Reset Password, Make/Demote Master, Delete, aur **Activity Log** tab.
- `components/account/` — apna password change + apne rights ka summary.
- Write buttons module-wise gate hotay hain: Raw Products (Add tab, In/Out/Edit — baaki "read only" label), Finished Products (Add tab, Edit), Batches (Produce tab, Edit/Delete), Vendors (Add tab, Pay/Adjust/Ledger/Edit/Delete, aur credit fields locked), Purchase Orders (New tab, Edit/Confirm/Receive/Return/Cancel/Delete, aur "Save & Confirm" button `approve` ke bagair ghayab).
- UI gating sirf sahulat hai, security nahi — har cheez server dobara check karta hai.

### Verification (2026-11-21, deployed app pe)
20 API permission checks pass: `403 view on raw-products`, `403 delete on purchase-orders`, `403 payment on vendor-ledger`, `403 creditLimit on vendors`, `403 approve` (create-only user ka `confirm:true` reject), draft create `201`, `401` bagair token, aur 15s cache TTL ke baad new grant `200`.
Browser (deployed URL pe, real login submit se):
- admin → sidebar 10 links, Users & Access matrix sahi hydrate, "Access saved for uacprobe2" + row summary foran update.
- restricted account (sirf raw-products view, batches view, vendors view, POs view+create) → login ke baad seedha `/account`, sidebar mein sirf 4 modules, PO rows pe sirf view button, Raw Products rows pe "read only", Vendors pe koi Add/Edit/Delete nahi.

### Caveats (UAC ke baray mein honest limits)
- **Row-level nahi, module-level hai**: `update` right wala banda doosre ke banaye hue records bhi edit kar sakta hai (owner-check nahi hai). Ownership chahiye to har route pe `createdBy` match lagana hoga.
- Master account (`role='admin'`) matrix se upar hai — uske liye `user_module_access` rows store nahi hoti (permissions save karne ki koshish pe 400 milta hai).
- Delete sirf un accounts ka hota hai jinka koi business record nahi; records wale ka password reset karke deactivate karein. Deleted user ka `createdBy` reference DB mein reh jata hai (SQLite FK `ON DELETE` cascade nahi rakhti) — is se historical reports nahi torti.
- UI ki button-hiding stale grant ke sath 15 second tak dikhai de sakti hai; server phir bhi 403 dega.
- Test data chhoda hua: **`uacprobe2` / `probe12345`** (standard account, rights: raw-products view, batches view, vendors view, POs view+create) aur uska ek Cancelled PO `PO-20261121-0005`. Yeh demo ke liye rakhya hai — delete karna ho to pehle uska PO clear karna hoga (Cancelled PO API se delete nahi hota, sirf Draft delete hota hai).

---

## 18. Permanent hosting — Firebase Hosting (UI) + Render (API) + Neon (Postgres)

**Kyun badla:** section 16 ka quick tunnel har restart pe naya hostname deta hai aur Cloudflare us hostname ko server-side expire kar deta hai — process zinda ho tab bhi DNS entry khatam (`ERR_NAME_NOT_RESOLVED`). Phone/APK aur Cloudflare DNS ke liye permanent URL chahiye, isliye app ab aapke PC se host nahi hogi.

**Realtime DB/Firestore kyun nahi:** hamara data relational hai (PO → GRN → ledger running balance, credit-limit guard, transaction rollback, audit) aur UAC ki enforcement 37 Express routes mein baithi hai. Document DB mein server code nahi chalta, sirf security rules chalte hain — wo atomic "ye order vendor ki limit cross kar raha hai" check nahi kar sakte. Isliye Express as-is hi host ho raha hai; Firebase ka sirf static hosting use hua (wo Spark plan pe free hai, card nahi lagta).

### Is session mein banaye gaye files
| File | Kaam |
|---|---|
| `firebase.json` | Hosting config: `public: frontend/dist/hosted/browser`, SPA rewrite `** → /index.html`, hashed js/css ko immutable cache, `index.html` ko no-cache |
| `.firebaserc` | Project id `mehndi-erp` — apna project id yahan set karein ya `firebase use --add` |
| `frontend/src/environments/environment.hosted.ts` | `apiUrl: 'https://mehndi-erp-api.onrender.com/api'` (absolute, kyunke Firebase Hosting `/api` ko Render pe proxy nahi kar sakta) |
| `frontend/angular.json` → `hosted` configuration | Upar wali env file + `outputPath: dist/hosted`, taake tunnel/local build (`production`, relative `/api`) untouched rahe |
| `frontend/package.json` → `build:hosted` | `ng build --configuration hosted` |
| `backend/server.js` | Ab frontend build na mile to API-only origin ban jata hai (static middleware + SPA fallback skip, `/` JSON status deta hai) — Render pe `../frontend/dist` maujood nahi hoga |
| `backend/scripts/migrate-sqlite-to-postgres.js` | SQLite file se Postgres copy, FK order mein, ids preserve, booleans/JSON type-cast, insert ke baad sequences reset |

### Commands
```bash
# UI build (Firebase ke liye)
cd frontend && npm run build:hosted        # -> frontend/dist/hosted/browser
firebase deploy --only hosting

# Data migration (ek baar, app boot se pehle)
cd backend
DATABASE_URL="postgres://...neon...?sslmode=require" DB_SSL=true node scripts/migrate-sqlite-to-postgres.js
```

### Render service settings
- Root Directory: `backend` · Build: `npm ci` · Start: `node server.js` · Instance: Free
- Environment: `DATABASE_URL` (Neon pooled connection), `DB_SSL=true`, `JWT_SECRET` (16+ chars, warna `middleware/auth.js` boot hi nahi karta), `NODE_ENV=production`
- Service ka naam **bilkul `mehndi-erp-api`** rakhein — `environment.hosted.ts` isi URL pe pinned hai; naam badla to ek line change karke `npm run build:hosted` + redeploy.

### Caveats (is setup ki honest limits)
- **Render free instance ~15 min idle ke baad sota hai**; agla request 30–60s lagta hai (cold start). Pehli baar phone pe kholne delay mehsoos hoga.
- Render free plan **custom domain allow nahi karta** — UI ka domain Firebase Hosting pe free lagta hai, API ka `*.onrender.com` hi rahega (APK ke liye theek; agar API bhi apne domain pe chahiye to Cloudflare Worker free proxy lagana hoga).
- `cors()` abhi sab origins allow karta hai — functionality ke baad hardening mein sirf Firebase domain whitelist karna baqi hai.
- **Cutover ke baad Postgres source of truth hai**: aapki local `backend/mehndi_inventory.sqlite` purani rahegi. Dono jagah entry karna data divide kar dega — ya to hosted DB use karein ya tunnel wapas.
- Migration script `ON CONFLICT (id) DO UPDATE` use karta hai, yani **SQLite file authoritative hai** — dobara chalane se Postgres ki same-id rows overwrite ho jayengi.
- Abhi tak kuch live deploy nahi hua: Render/Neon/Firebase accounts aapke naam pe banenge. Verification sirf build-level hai (hosted bundle mein Render URL confirm, tunnel bundle untouched, `node --check`, migration guard ka clean fail).
