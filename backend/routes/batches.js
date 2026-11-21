const express = require('express');
const router = express.Router();
const db = require('../models');
const auth = require('../middleware/auth');
const { requireAccess } = require('../services/access');

// GET /api/batches - List all active (non-deleted) batches
router.get('/', auth, requireAccess('batches', 'view'), async (req, res) => {
  try {
    const batches = await db.Batch.findAll({
      where: { isDeleted: false },
      include: [
        { model: db.FinishedProduct, as: 'finishedProduct', attributes: ['id', 'name'] },
        { model: db.User, as: 'creator', attributes: ['id', 'username'] }
      ],
      order: [['createdAt', 'DESC']]
    });
    res.json(batches);
  } catch (error) {
    console.error('Fetch batches error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/batches/:id - Get batch detail including raw products consumed
router.get('/:id', auth, requireAccess('batches', 'view'), async (req, res) => {
  try {
    const { id } = req.params;
    const batch = await db.Batch.findOne({
      where: { id, isDeleted: false },
      include: [
        { model: db.FinishedProduct, as: 'finishedProduct', attributes: ['id', 'name'] },
        { model: db.User, as: 'creator', attributes: ['id', 'username'] },
        {
          model: db.BatchRawProduct,
          as: 'rawProductsConsumed',
          include: [{ model: db.RawProduct, as: 'rawProduct', attributes: ['id', 'name', 'unitType'] }]
        }
      ]
    });

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found.' });
    }

    res.json(batch);
  } catch (error) {
    console.error('Fetch batch detail error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/batches - Create batch (deducts stock and records transactions)
router.post('/', auth, requireAccess('batches', 'create'), async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { finishedProductId, quantity, rawProductsUsed } = req.body;

    const qtyProduced = Number(quantity);
    if (!finishedProductId) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Finished Product is required.' });
    }
    if (!qtyProduced || qtyProduced <= 0) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Produced quantity must be greater than zero.' });
    }
    if (!rawProductsUsed || !Array.isArray(rawProductsUsed) || rawProductsUsed.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ error: 'At least one raw product usage must be specified.' });
    }

    // Verify finished product exists and is active
    const finProduct = await db.FinishedProduct.findByPk(finishedProductId, { transaction });
    if (!finProduct) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Finished product not found.' });
    }
    if (finProduct.status !== 'Active') {
      await transaction.rollback();
      return res.status(400).json({ error: 'Cannot produce batches for an inactive finished product.' });
    }

    // Step 1: Validate available stock for all materials first
    const rawProductsToUpdate = [];
    for (const item of rawProductsUsed) {
      const rawProductId = Number(item.rawProductId);
      const usedQty = Number(item.quantityUsed);

      if (!rawProductId) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Invalid Raw Product ID provided.' });
      }
      if (!usedQty || usedQty <= 0) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Raw material usage quantity must be greater than zero.' });
      }

      const rawProduct = await db.RawProduct.findByPk(rawProductId, { transaction });
      if (!rawProduct) {
        await transaction.rollback();
        return res.status(404).json({ error: `Raw product with ID ${rawProductId} not found.` });
      }

      // Check stock availability
      const currentStock = Number(rawProduct.currentStock);
      if (currentStock < usedQty) {
        await transaction.rollback();
        return res.status(400).json({
          error: `Insufficient stock for "${rawProduct.name}". Required: ${usedQty}, Available: ${currentStock}`
        });
      }

      rawProductsToUpdate.push({ rawProduct, usedQty });
    }

    // Step 2: Generate Batch Number B-YYYYMMDD-XXXX
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10); // "2026-06-23"
    const formattedDate = todayStr.replace(/-/g, ''); // "20260623"
    
    // Count existing active + deleted batches today to ensure a correct index
    const countToday = await db.Batch.count({
      where: { creationDate: todayStr },
      transaction
    });
    const seq = String(countToday + 1).padStart(4, '0');
    const batchNumber = `B-${formattedDate}-${seq}`;

    // Step 3: Create the batch
    const batch = await db.Batch.create({
      batchNumber,
      finishedProductId,
      quantity: qtyProduced,
      creationDate: todayStr,
      createdBy: req.user.id
    }, { transaction });

    // Step 4: Process raw products: Deduct stock, Create bridge records, Create transaction logs
    for (const item of rawProductsToUpdate) {
      const { rawProduct, usedQty } = item;
      const prevStock = Number(rawProduct.currentStock);
      const newStock = prevStock - usedQty;

      // Update current stock
      rawProduct.currentStock = newStock;
      await rawProduct.save({ transaction });

      // Create Bridge Record
      await db.BatchRawProduct.create({
        batchId: batch.id,
        rawProductId: rawProduct.id,
        quantityUsed: usedQty
      }, { transaction });

      // Create Inventory Transaction Log
      await db.InventoryTransaction.create({
        rawProductId: rawProduct.id,
        transactionType: 'Batch Creation',
        quantity: usedQty,
        previousStock: prevStock,
        newStock: newStock,
        referenceType: 'batch',
        referenceId: batch.id,
        remarks: `Consumed for batch: ${batchNumber}`,
        userId: req.user.id
      }, { transaction });
    }

    await transaction.commit();

    // Fetch complete created batch with associations to return
    const result = await db.Batch.findOne({
      where: { id: batch.id },
      include: [
        { model: db.FinishedProduct, as: 'finishedProduct', attributes: ['id', 'name'] },
        { model: db.User, as: 'creator', attributes: ['id', 'username'] },
        {
          model: db.BatchRawProduct,
          as: 'rawProductsConsumed',
          include: [{ model: db.RawProduct, as: 'rawProduct', attributes: ['id', 'name', 'unitType'] }]
        }
      ]
    });

    res.status(201).json(result);
  } catch (error) {
    await transaction.rollback();
    console.error('Batch creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/batches/:id - Update batch (reconciles inventory changes)
router.put('/:id', auth, requireAccess('batches', 'update'), async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { id } = req.params;
    const { finishedProductId, quantity, rawProductsUsed } = req.body;

    const newQtyProduced = Number(quantity);
    if (!finishedProductId) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Finished Product is required.' });
    }
    if (!newQtyProduced || newQtyProduced <= 0) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Produced quantity must be greater than zero.' });
    }
    if (!rawProductsUsed || !Array.isArray(rawProductsUsed) || rawProductsUsed.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ error: 'At least one raw product usage must be specified.' });
    }

    // Find the batch
    const batch = await db.Batch.findOne({
      where: { id, isDeleted: false },
      transaction
    });
    if (!batch) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Batch not found.' });
    }

    // Get old composition maps
    const oldUsages = await db.BatchRawProduct.findAll({
      where: { batchId: batch.id },
      transaction
    });
    
    const oldMap = {};
    oldUsages.forEach(u => {
      oldMap[u.rawProductId] = Number(u.quantityUsed);
    });

    const newMap = {};
    rawProductsUsed.forEach(item => {
      newMap[Number(item.rawProductId)] = Number(item.quantityUsed);
    });

    // Generate set of all raw product IDs involved
    const allProductIds = new Set([...Object.keys(oldMap).map(Number), ...Object.keys(newMap).map(Number)]);
    
    const reconciliationTasks = [];

    // Step 1: Pre-calculate differences and validate stock availability
    for (const rawProductId of allProductIds) {
      const oldQty = oldMap[rawProductId] || 0;
      const newQty = newMap[rawProductId] || 0;
      const diff = newQty - oldQty; // positive means we consume more, negative means we return some

      if (diff === 0) continue;

      const rawProduct = await db.RawProduct.findByPk(rawProductId, { transaction });
      if (!rawProduct) {
        await transaction.rollback();
        return res.status(404).json({ error: `Raw product with ID ${rawProductId} not found.` });
      }

      // Check if stock allows the deduction
      if (diff > 0) {
        const available = Number(rawProduct.currentStock);
        if (available < diff) {
          await transaction.rollback();
          return res.status(400).json({
            error: `Insufficient stock for "${rawProduct.name}" to perform update. Need additional: ${diff}, Available: ${available}`
          });
        }
      }

      reconciliationTasks.push({ rawProduct, oldQty, newQty, diff });
    }

    // Step 2: Apply the updates
    for (const task of reconciliationTasks) {
      const { rawProduct, oldQty, newQty, diff } = task;
      const prevStock = Number(rawProduct.currentStock);
      const newStock = prevStock - diff; // if diff is negative, newStock increases. If positive, it decreases.

      // Update product current stock
      rawProduct.currentStock = newStock;
      await rawProduct.save({ transaction });

      // Create transaction logs
      if (diff > 0) {
        // Additional consumption
        await db.InventoryTransaction.create({
          rawProductId: rawProduct.id,
          transactionType: 'Batch Update',
          quantity: diff,
          previousStock: prevStock,
          newStock: newStock,
          referenceType: 'batch',
          referenceId: batch.id,
          remarks: `Deducted additional quantity due to update of batch: ${batch.batchNumber}`,
          userId: req.user.id
        }, { transaction });
      } else {
        // Returned quantity
        const returnedQty = Math.abs(diff);
        await db.InventoryTransaction.create({
          rawProductId: rawProduct.id,
          transactionType: 'Batch Update',
          quantity: returnedQty,
          previousStock: prevStock,
          newStock: newStock,
          referenceType: 'batch',
          referenceId: batch.id,
          remarks: `Returned unused quantity due to update of batch: ${batch.batchNumber}`,
          userId: req.user.id
        }, { transaction });
      }

      // Update bridge database entries
      if (newQty === 0) {
        // Removed product completely
        await db.BatchRawProduct.destroy({
          where: { batchId: batch.id, rawProductId: rawProduct.id },
          transaction
        });
      } else if (oldQty === 0) {
        // New product added
        await db.BatchRawProduct.create({
          batchId: batch.id,
          rawProductId: rawProduct.id,
          quantityUsed: newQty
        }, { transaction });
      } else {
        // Quantity modified
        await db.BatchRawProduct.update(
          { quantityUsed: newQty },
          { where: { batchId: batch.id, rawProductId: rawProduct.id }, transaction }
        );
      }
    }

    // Step 3: Update parent batch record
    batch.finishedProductId = finishedProductId;
    batch.quantity = newQtyProduced;
    await batch.save({ transaction });

    await transaction.commit();

    // Fetch complete updated details to return
    const result = await db.Batch.findOne({
      where: { id: batch.id },
      include: [
        { model: db.FinishedProduct, as: 'finishedProduct', attributes: ['id', 'name'] },
        { model: db.User, as: 'creator', attributes: ['id', 'username'] },
        {
          model: db.BatchRawProduct,
          as: 'rawProductsConsumed',
          include: [{ model: db.RawProduct, as: 'rawProduct', attributes: ['id', 'name', 'unitType'] }]
        }
      ]
    });

    res.json(result);
  } catch (error) {
    await transaction.rollback();
    console.error('Batch update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/batches/:id - Soft Delete batch (restores inventory, logs transactions)
router.delete('/:id', auth, requireAccess('batches', 'delete'), async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { id } = req.params;

    const batch = await db.Batch.findOne({
      where: { id, isDeleted: false },
      transaction
    });

    if (!batch) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Batch not found or already deleted.' });
    }

    // Fetch all raw products consumed in this batch to restore them
    const consumed = await db.BatchRawProduct.findAll({
      where: { batchId: batch.id },
      transaction
    });

    for (const item of consumed) {
      const rawProduct = await db.RawProduct.findByPk(item.rawProductId, { transaction });
      if (!rawProduct) {
        await transaction.rollback();
        return res.status(404).json({ error: `Raw product with ID ${item.rawProductId} not found.` });
      }

      const prevStock = Number(rawProduct.currentStock);
      const qtyUsed = Number(item.quantityUsed);
      const newStock = prevStock + qtyUsed;

      // Update current stock
      rawProduct.currentStock = newStock;
      await rawProduct.save({ transaction });

      // Log transaction
      await db.InventoryTransaction.create({
        rawProductId: rawProduct.id,
        transactionType: 'Batch Reversal',
        quantity: qtyUsed,
        previousStock: prevStock,
        newStock: newStock,
        referenceType: 'batch',
        referenceId: batch.id,
        remarks: `Returned stock from deleted batch: ${batch.batchNumber}`,
        userId: req.user.id
      }, { transaction });
    }

    // Soft delete the batch
    batch.isDeleted = true;
    batch.deletedAt = new Date();
    batch.deletedBy = req.user.id;
    await batch.save({ transaction });

    await transaction.commit();

    res.json({ message: `Batch ${batch.batchNumber} has been successfully deleted and raw materials returned to stock.` });
  } catch (error) {
    await transaction.rollback();
    console.error('Delete batch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
