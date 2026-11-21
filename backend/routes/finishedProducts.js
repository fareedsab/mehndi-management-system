const express = require('express');
const router = express.Router();
const db = require('../models');
const auth = require('../middleware/auth');

// GET /api/finished-products - List all finished products
router.get('/', auth, async (req, res) => {
  try {
    const products = await db.FinishedProduct.findAll({
      order: [['id', 'ASC']]
    });
    res.json(products);
  } catch (error) {
    console.error('Fetch finished products error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/finished-products - Add new finished product
router.post('/', auth, async (req, res) => {
  try {
    const { name, description, status } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Finished Product Name is required.' });
    }

    const existing = await db.FinishedProduct.findOne({ where: { name } });
    if (existing) {
      return res.status(400).json({ error: `A finished product with name "${name}" already exists.` });
    }

    const newProduct = await db.FinishedProduct.create({
      name,
      description,
      status: status || 'Active'
    });

    res.status(201).json(newProduct);
  } catch (error) {
    console.error('Create finished product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/finished-products/:id - Edit finished product
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, description, status } = req.body;
    const { id } = req.params;

    const product = await db.FinishedProduct.findByPk(id);
    if (!product) {
      return res.status(404).json({ error: 'Finished product not found.' });
    }

    if (name && name !== product.name) {
      const existing = await db.FinishedProduct.findOne({ where: { name } });
      if (existing) {
        return res.status(400).json({ error: `A finished product with name "${name}" already exists.` });
      }
      product.name = name;
    }

    if (description !== undefined) product.description = description;
    if (status !== undefined) product.status = status;

    await product.save();
    res.json(product);
  } catch (error) {
    console.error('Update finished product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
