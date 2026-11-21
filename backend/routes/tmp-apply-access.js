const fs = require('fs');
const path = require('path');

const specs = {
  'rawProducts.js': [
    ['get', '/', 'raw-products', 'view'],
    ['post', '/', 'raw-products', 'create'],
    ['put', '/:id', 'raw-products', 'update'],
    ['delete', '/:id', 'raw-products', 'delete'],
    ['post', '/:id/stock-in', 'raw-products', 'stockIn'],
    ['post', '/:id/stock-out', 'raw-products', 'stockOut']
  ],
  'finishedProducts.js': [
    ['get', '/', 'finished-products', 'view'],
    ['post', '/', 'finished-products', 'create'],
    ['put', '/:id', 'finished-products', 'update'],
    ['delete', '/:id', 'finished-products', 'delete']
  ],
  'batches.js': [
    ['get', '/', 'batches', 'view'],
    ['get', '/:id', 'batches', 'view'],
    ['post', '/', 'batches', 'create'],
    ['put', '/:id', 'batches', 'update'],
    ['delete', '/:id', 'batches', 'delete']
  ],
  'vendors.js': [
    ['get', '/', 'vendors', 'view'],
    ['get', '/:id', 'vendors', 'view'],
    ['post', '/', 'vendors', 'create'],
    ['put', '/:id', 'vendors', 'update'],
    ['delete', '/:id', 'vendors', 'delete'],
    ['get', '/:id/ledger', 'vendor-ledger', 'view'],
    ['get', '/:id/open-orders', 'vendors', 'view'],
    ['post', '/:id/payments', 'vendor-ledger', 'payment'],
    ['get', '/:id/payments', 'vendor-ledger', 'view'],
    ['post', '/:id/adjustments', 'vendor-ledger', 'adjust']
  ],
  'purchaseOrders.js': [
    ['get', '/', 'purchase-orders', 'view'],
    ['get', '/:id', 'purchase-orders', 'view'],
    ['post', '/', 'purchase-orders', 'create'],
    ['put', '/:id', 'purchase-orders', 'update'],
    ['patch', '/:id/status', 'purchase-orders', 'update'],
    ['delete', '/:id', 'purchase-orders', 'delete'],
    ['post', '/:id/receipts', 'purchase-orders', 'receive'],
    ['post', '/:id/returns', 'purchase-orders', 'returnGoods']
  ]
};

let total = 0;
for (const [file, routes] of Object.entries(specs)) {
  const filePath = path.join(__dirname, file);
  let source = fs.readFileSync(filePath, 'utf8');

  if (!source.includes("require('../services/access')")) {
    source = source.replace(
      "const auth = require('../middleware/auth');",
      "const auth = require('../middleware/auth');\nconst { requireAccess } = require('../services/access');"
    );
  }

  for (const [method, routePath, moduleKey, action] of routes) {
    const needle = `router.${method}('${routePath}', auth,`;
    const replacement = `router.${method}('${routePath}', auth, requireAccess('${moduleKey}', '${action}'),`;
    if (!source.includes(needle)) {
      console.log(`MISS ${file} :: ${method.toUpperCase()} ${routePath}`);
      continue;
    }
    source = source.split(needle).join(replacement);
    total += 1;
  }

  fs.writeFileSync(filePath, source);
  console.log(`done ${file}`);
}
console.log(`patched ${total} routes`);
