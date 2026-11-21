const express = require('express');
const router = express.Router();
const db = require('../models');
const auth = require('../middleware/auth');

// GET /api/raw-products - List all raw products
router.get('/', auth, async (req, res) => {
  try {
    const products = await db.RawProduct.findAll({
      order: [['id', 'ASC']]
    });

    // Format products to include custom/calculated fields
    const formatted = products.map(p => {
      const plain = p.get({ plain: true });
      return {
        ...plain,
        isLowStock: Number(plain.currentStock) <= Number(plain.minimumStockLevel),
        availableQuantity: plain.currentStock // Representing available quantity
      };
    });

    res.json(formatted);
  } catch (error) {
    console.error('Fetch raw products error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/raw-products - Add new raw product
router.post('/', auth, async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { name, category, unitType, openingStock, minimumStockLevel } = req.body;
    
    if (!name) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Product Name is required.' });
    }

    // Check uniqueness
    const existing = await db.RawProduct.findOne({ where: { name } });
    if (existing) {
      await transaction.rollback();
      return res.status(400).json({ error: `A product with name "${name}" already exists.` });
    }

    const opStock = Number(openingStock) || 0;
    const minStock = Number(minimumStockLevel) || 0;

    if (opStock < 0 || minStock < 0) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Stock levels cannot be negative.' });
    }

    const newProduct = await db.RawProduct.create({
      name,
      category: category || 'General',
      unitType: unitType || 'Piece',
      openingStock: opStock,
      currentStock: opStock, // Current stock starts at opening stock
      minimumStockLevel: minStock,
      createdBy: req.user.id
    }, { transaction });

    // Record initial transaction log for opening stock if > 0
    if (opStock > 0) {
      await db.InventoryTransaction.create({
        rawProductId: newProduct.id,
        transactionType: 'Stock In',
        quantity: opStock,
        previousStock: 0,
        newStock: opStock,
        referenceType: 'manual',
        purchaseReference: 'OPENING-STOCK',
        remarks: 'Opening stock on product creation',
        userId: req.user.id
      }, { transaction });
    }

    await transaction.commit();

    res.status(201).json({
      ...newProduct.get({ plain: true }),
      isLowStock: opStock <= minStock,
      availableQuantity: opStock
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Create raw product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/raw-products/:id - Edit raw product metadata (No direct stock edits allowed!)
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, category, unitType, minimumStockLevel } = req.body;
    const { id } = req.params;

    const product = await db.RawProduct.findByPk(id);
    if (!product) {
      return res.status(404).json({ error: 'Raw product not found.' });
    }

    // Name uniqueness check if name is changed
    if (name && name !== product.name) {
      const existing = await db.RawProduct.findOne({ where: { name } });
      if (existing) {
        return res.status(400).json({ error: `A product with name "${name}" already exists.` });
      }
      product.name = name;
    }

    if (category !== undefined) product.category = category;
    if (unitType !== undefined) product.unitType = unitType;
    if (minimumStockLevel !== undefined) {
      const minStock = Number(minimumStockLevel);
      if (minStock < 0) {
        return res.status(400).json({ error: 'Minimum stock level cannot be negative.' });
      }
      product.minimumStockLevel = minStock;
    }

    await product.save();

    res.json({
      ...product.get({ plain: true }),
      isLowStock: Number(product.currentStock) <= Number(product.minimumStockLevel),
      availableQuantity: product.currentStock
    });
  } catch (error) {
    console.error('Update raw product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/raw-products/:id/stock-in - Stock In (increase stock)
router.post('/:id/stock-in', auth, async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { id } = req.params;
    const { quantityAdded, purchaseReference, remarks } = req.body;

    const qty = Number(quantityAdded);
    if (!qty || qty <= 0) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Quantity added must be a positive number.' });
    }

    const product = await db.RawProduct.findByPk(id, { transaction });
    if (!product) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Raw product not found.' });
    }

    const prevStock = Number(product.currentStock);
    const newStock = prevStock + qty;

    // Update stock
    product.currentStock = newStock;
    await product.save({ transaction });

    // Log transaction
    const log = await db.InventoryTransaction.create({
      rawProductId: product.id,
      transactionType: 'Stock In',
      quantity: qty,
      previousStock: prevStock,
      newStock: newStock,
      referenceType: 'manual',
      purchaseReference: purchaseReference || 'MANUAL-STOCK-IN',
      remarks: remarks || 'Manual Stock In',
      userId: req.user.id
    }, { transaction });

    await transaction.commit();

    res.json({
      message: 'Stock updated successfully.',
      product: {
        ...product.get({ plain: true }),
        isLowStock: newStock <= Number(product.minimumStockLevel),
        availableQuantity: newStock
      },
      transaction: log
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Stock In error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/raw-products/:id/stock-out - Stock Out (decrease stock manually)
router.post('/:id/stock-out', auth, async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { id } = req.params;
    const { quantityDeducted, reason, remarks } = req.body;

    const qty = Number(quantityDeducted);
    if (!qty || qty <= 0) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Quantity deducted must be a positive number.' });
    }

    const product = await db.RawProduct.findByPk(id, { transaction });
    if (!product) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Raw product not found.' });
    }

    const prevStock = Number(product.currentStock);
    const newStock = prevStock - qty;

    // Validation Rule: Stock cannot become negative.
    if (newStock < 0) {
      await transaction.rollback();
      return res.status(400).json({
        error: `Insufficient stock. Current stock is ${prevStock} but tried to deduct ${qty}.`
      });
    }

    // Update stock
    product.currentStock = newStock;
    await product.save({ transaction });

    // Log transaction
    const log = await db.InventoryTransaction.create({
      rawProductId: product.id,
      transactionType: 'Stock Out',
      quantity: qty,
      previousStock: prevStock,
      newStock: newStock,
      referenceType: 'manual',
      reason: reason || 'MANUAL-STOCK-OUT',
      remarks: remarks || 'Manual Stock Out',
      userId: req.user.id
    }, { transaction });

    await transaction.commit();

    res.json({
      message: 'Stock updated successfully.',
      product: {
        ...product.get({ plain: true }),
        isLowStock: newStock <= Number(product.minimumStockLevel),
        availableQuantity: newStock
      },
      transaction: log
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Stock Out error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
