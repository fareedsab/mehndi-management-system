const bcrypt = require('bcryptjs');
const db = require('../models');

async function initializeDatabase() {
  try {
    console.log('Synchronizing database models...');
    // In production or dev, sync models to create tables
    await db.sequelize.sync({ force: false });
    console.log('Database synced successfully.');

    // Seed default User if none exists
    const userCount = await db.User.count();
    let defaultAdminId = null;
    
    if (userCount === 0) {
      console.log('Seeding default admin user...');
      const passwordHash = await bcrypt.hash('admin123', 10);
      const admin = await db.User.create({
        username: 'admin',
        passwordHash: passwordHash,
        role: 'admin'
      });
      defaultAdminId = admin.id;
      console.log('Admin user seeded: admin / admin123');
    } else {
      const admin = await db.User.findOne({ where: { username: 'admin' } });
      if (admin) defaultAdminId = admin.id;
    }

    // Seed Raw Products if none exist
    const rawCount = await db.RawProduct.count();
    if (rawCount === 0) {
      console.log('Seeding sample raw products...');
      const rawProductsToSeed = [
        { name: 'Nosheen Wrapper', category: 'Packaging', unitType: 'Piece', openingStock: 1000, currentStock: 1000, minimumStockLevel: 200, createdBy: defaultAdminId },
        { name: 'Nosheen 12 Piece Box', category: 'Packaging', unitType: 'Box', openingStock: 200, currentStock: 200, minimumStockLevel: 50, createdBy: defaultAdminId },
        { name: 'Nosheen 24 Piece Box', category: 'Packaging', unitType: 'Box', openingStock: 200, currentStock: 200, minimumStockLevel: 50, createdBy: defaultAdminId },
        { name: 'Supreme Wrapper', category: 'Packaging', unitType: 'Piece', openingStock: 1000, currentStock: 1000, minimumStockLevel: 200, createdBy: defaultAdminId },
        { name: 'Supreme 12 Piece Box', category: 'Packaging', unitType: 'Box', openingStock: 200, currentStock: 200, minimumStockLevel: 50, createdBy: defaultAdminId },
        { name: 'Supreme 24 Piece Box', category: 'Packaging', unitType: 'Box', openingStock: 200, currentStock: 200, minimumStockLevel: 50, createdBy: defaultAdminId }
      ];

      for (const item of rawProductsToSeed) {
        const prod = await db.RawProduct.create(item);
        // Log transaction for opening stock
        await db.InventoryTransaction.create({
          rawProductId: prod.id,
          transactionType: 'Stock In',
          quantity: prod.openingStock,
          previousStock: 0,
          newStock: prod.openingStock,
          referenceType: 'manual',
          purchaseReference: 'OPENING-STOCK',
          remarks: 'Initial opening stock seeding',
          userId: defaultAdminId
        });
      }
      console.log('Sample raw products seeded.');
    }

    // Seed Finished Products if none exist
    const finishedCount = await db.FinishedProduct.count();
    if (finishedCount === 0) {
      console.log('Seeding sample finished products...');
      const finishedProductsToSeed = [
        { name: 'Nosheen Mehndi', description: 'Nosheen Brand finished henna product', status: 'Active' },
        { name: 'Supreme Mehndi', description: 'Supreme Brand premium henna product', status: 'Active' }
      ];
      await db.FinishedProduct.bulkCreate(finishedProductsToSeed);
      console.log('Sample finished products seeded.');
    }

    // Seed Vendors if none exist
    const vendorCount = await db.Vendor.count();
    if (vendorCount === 0) {
      console.log('Seeding sample vendors...');
      const vendorsToSeed = [
        {
          name: 'Nosheen Packaging Industries',
          code: 'VND-001',
          contactPerson: 'Haji Imdad',
          phone: '0300-1234567',
          city: 'Lahore',
          creditLimit: 150000,
          paymentTermsDays: 30,
          openingBalance: 0,
          remarks: 'Wrapper and 12/24 piece boxing supplier'
        },
        {
          name: 'Supreme Henna Supplies',
          code: 'VND-002',
          contactPerson: 'Usman Ali',
          phone: '0311-7654321',
          city: 'Karachi',
          creditLimit: 250000,
          paymentTermsDays: 45,
          openingBalance: 0,
          remarks: 'Premium henna paste and cones'
        },
        {
          name: 'Al-Madina Stationery',
          code: 'VND-003',
          contactPerson: 'Tanveer Shah',
          phone: '0321-9988776',
          city: 'Rawalpindi',
          creditLimit: 0,
          paymentTermsDays: 15,
          openingBalance: 0,
          remarks: 'Cones, applicators and misc items. No credit limit.'
        }
      ];

      for (const vendor of vendorsToSeed) {
        await db.Vendor.create({ ...vendor, createdBy: defaultAdminId });
      }
      console.log('Sample vendors seeded.');
    }

    console.log('Database initialization completed.');
  } catch (error) {
    console.error('Error during database initialization:', error);
  }
}

module.exports = initializeDatabase;
