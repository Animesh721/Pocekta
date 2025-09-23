const express = require('express');
const auth = require('../middleware/auth');
const Transaction = require('../models/Transaction');
const AllowanceTopup = require('../models/AllowanceTopup');
const User = require('../models/User');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20, category, startDate, endDate } = req.query;

    const query = { userId: req.user._id };

    if (category) {
      query.category = category;
    }

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const transactions = await Transaction.find(query)
      .sort({ date: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Transaction.countDocuments(query);

    res.json({
      transactions,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { amount, description, category, date, type = 'expense' } = req.body;

    if (!amount || !description || !category) {
      return res.status(400).json({ message: 'Please provide all required fields' });
    }

    if (amount <= 0) {
      return res.status(400).json({ message: 'Amount must be greater than 0' });
    }

    let activeTopup = null;

    // If this is an allowance expense, find active topup and link it
    if (category === 'Allowance' && type === 'expense') {
      activeTopup = await AllowanceTopup.findOne({
        userId: req.user._id,
        isActive: true,
        remaining: { $gt: 0 }
      }).sort({ createdAt: -1 });

      if (!activeTopup) {
        return res.status(400).json({
          message: 'No active allowance available. Please add a new top-up first.'
        });
      }

      if (activeTopup.remaining < amount) {
        return res.status(400).json({
          message: `Insufficient allowance. Available: ₹${activeTopup.remaining}`
        });
      }
    }

    const transaction = new Transaction({
      userId: req.user._id,
      amount,
      description,
      category,
      date: date ? new Date(date) : new Date(),
      type,
      allowanceTopupId: activeTopup ? activeTopup._id : undefined
    });

    await transaction.save();

    // Update allowance topup spent amount if this is an allowance expense
    if (activeTopup) {
      activeTopup.spent += parseFloat(amount);
      // Ensure remaining is recalculated correctly (pre-save middleware will handle this)
      await activeTopup.save();

      // Update user's current balance to match the topup remaining
      const user = await User.findById(req.user._id);
      user.currentBalance = activeTopup.remaining; // Sync with topup remaining
      await user.save();
    }

    res.status(201).json({
      message: 'Transaction created successfully',
      transaction,
      remainingAllowance: activeTopup ? activeTopup.remaining : null
    });
  } catch (error) {
    console.error('Create transaction error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const { amount, description, category, date } = req.body;

    const transaction = await Transaction.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    if (amount) transaction.amount = amount;
    if (description) transaction.description = description;
    if (category) transaction.category = category;
    if (date) transaction.date = new Date(date);

    await transaction.save();

    res.json({
      message: 'Transaction updated successfully',
      transaction
    });
  } catch (error) {
    console.error('Update transaction error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const transaction = await Transaction.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    res.json({ message: 'Transaction deleted successfully' });
  } catch (error) {
    console.error('Delete transaction error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;