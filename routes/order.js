const { router } = require('../app');
const mongoose = require('../config/mongo');
const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');

/**
 * Pay with Wallet (auto debit)
 * Body: { userId, amount, orderId (optional) }
 * amount in rupees
 */
router.post('/pay', async (req, res) => {
  try {
    const { userId, amount, orderId } = req.body;
    if (!userId || !amount) return res.status(400).json({ error: 'Missing fields' });

    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const wallet = await Wallet.findOne({ user_id: userId }).session(session);
      const current = wallet ? wallet.wallet_balance : 0;
      if (current < Number(amount)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
      }

      wallet.wallet_balance = current - Number(amount);
      await wallet.save({ session });

      await WalletTransaction.create([
        { user_id: userId, amount: -Number(amount), description: 'Order payment', payment_id: orderId || null }
      ], { session });

      await session.commitTransaction();
      session.endSession();

      return res.json({ success: true, wallet_balance: wallet.wallet_balance, message: 'Payment successful from wallet' });
    } catch (txErr) {
      await session.abortTransaction();
      session.endSession();
      console.error('order pay tx error:', txErr);
      return res.status(500).json({ success: false, message: 'Failed to debit wallet' });
    }
  } catch (error) {
    console.error('order pay error:', error);
    res.status(500).json({ error: 'Order payment failed', details: error.message });
  }
});

module.exports = router;
