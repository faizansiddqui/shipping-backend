// routes/wallet.js -- MongoDB-backed wallet + transactions
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { router } = require('../app');
const authMiddleware = require('../middleware/auth');
const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');
const User = require('../models/User');
const mongoose = require('../config/mongo');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

function isValidUUID(u) {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(u);
}

async function logFailedTransaction(userId, reason, paymentId = null) {
  try {
    await WalletTransaction.create({ user_id: userId, amount: 0, description: `Recharge failed: ${reason}`, payment_id: paymentId });
  } catch (err) {
    console.error('Log failed tx error:', err);
  }
}

// Create Razorpay Order
router.post('/create-razor', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const order = await razorpay.orders.create({ amount: Math.round(amount * 100), currency: 'INR', receipt: `wallet_${Date.now()}` });
    res.json(order);
  } catch (error) {
    console.error('create-order error:', error);
    if (error?.statusCode === 401) {
      return res.status(401).json({ error: 'Razorpay authentication failed', details: error?.error || error?.description || 'Invalid Razorpay key/secret' });
    }
    res.status(500).json({ error: 'Order creation failed', details: error?.message || error });
  }
});

// Verify payment
router.post('/verify-payment', authMiddleware, async (req, res) => {
  try {
    const { order_id, payment_id, signature, amount } = req.body;
    if (!order_id || !payment_id || !signature || !amount) return res.status(400).json({ error: 'Missing required fields' });

    const userId = req.user?._id;
    if (!userId || !isValidUUID(userId)) return res.status(400).json({ error: 'Invalid user from auth' });

    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${order_id}|${payment_id}`).digest('hex');
    if (expected !== signature) {
      console.warn('Invalid signature', { expected, signature });
      await logFailedTransaction(userId, 'invalid signature', payment_id);
      return res.status(400).json({ success: false, message: 'Invalid signature' });
    }

    const payment = await razorpay.payments.fetch(payment_id);
    if (!payment) {
      await logFailedTransaction(userId, 'payment not found', payment_id);
      return res.status(400).json({ success: false, message: 'Payment not found on Razorpay' });
    }
    if (payment.order_id !== order_id) {
      await logFailedTransaction(userId, 'order_id mismatch', payment_id);
      return res.status(400).json({ success: false, message: 'order_id mismatch' });
    }
    if (payment.status !== 'captured') {
      await logFailedTransaction(userId, `status ${payment.status}`, payment_id);
      return res.status(400).json({ success: false, message: `Payment not captured: ${payment.status}` });
    }

    const amountPaise = Math.round(Number(amount) * 100);
    if (Number(payment.amount) !== amountPaise) {
      await logFailedTransaction(userId, 'amount mismatch', payment_id);
      return res.status(400).json({ success: false, message: 'Amount mismatch' });
    }

    // Idempotency check
    const existing = await WalletTransaction.findOne({ payment_id });
    if (existing) {
      const wallet = await Wallet.findOne({ user_id: userId });
      const wallet_balance = wallet ? wallet.wallet_balance : 0;
      return res.json({ success: true, message: 'Payment already processed', wallet_balance });
    }

    // Add to wallet in a transaction
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const amountNumber = Number(amount);
      let wallet = await Wallet.findOne({ user_id: userId }).session(session);
      if (!wallet) wallet = await Wallet.create([{ user_id: userId, wallet_balance: 0 }], { session }).then((arr) => arr[0]);

      wallet.wallet_balance = (wallet.wallet_balance || 0) + amountNumber;
      await wallet.save({ session });

      await WalletTransaction.create([{ user_id: userId, amount: amountNumber, description: 'Wallet recharge via Razorpay', payment_id }], { session });

      await session.commitTransaction();
      session.endSession();

      return res.json({ success: true, message: 'Payment verified and wallet updated', wallet_balance: wallet.wallet_balance });
    } catch (txErr) {
      await session.abortTransaction();
      session.endSession();
      console.error('Wallet tx error:', txErr);
      await logFailedTransaction(userId, 'wallet update error', payment_id);
      return res.status(500).json({ success: false, message: 'Failed to update wallet' });
    }
  } catch (err) {
    console.error('verify-payment error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET /wallet/balance
router.get('/wallet/balance', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ error: 'Invalid auth' });

    const wallet = await Wallet.findOne({ user_id: userId });
    const wallet_balance = wallet ? wallet.wallet_balance : 0;
    return res.status(200).json({ wallet_balance });
  } catch (err) {
    console.error('wallet balance error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /wallet/history
router.get('/wallet/history', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ error: 'Invalid auth' });

    const data = await WalletTransaction.find({ user_id: userId }).sort({ createdAt: -1 }).lean();
    return res.json({ transactions: data || [] });
  } catch (err) {
    console.error('wallet history error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /wallet/spend
router.post('/wallet/spend', authMiddleware, async (req, res) => {
  try {
    const { amount, description } = req.body;
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ error: 'Invalid auth' });

    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const wallet = await Wallet.findOne({ user_id: userId }).session(session);
      const current = wallet ? wallet.wallet_balance : 0;
      if (current < Number(amount)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, message: 'Insufficient funds' });
      }

      wallet.wallet_balance = current - Number(amount);
      await wallet.save({ session });

      await WalletTransaction.create([{ user_id: userId, amount: -Number(amount), description: description || 'Wallet spend' }], { session });

      await session.commitTransaction();
      session.endSession();

      return res.json({ success: true, wallet_balance: wallet.wallet_balance });
    } catch (txErr) {
      await session.abortTransaction();
      session.endSession();
      console.error('wallet spend tx error:', txErr);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  } catch (err) {
    console.error('wallet spend error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
