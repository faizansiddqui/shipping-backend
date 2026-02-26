// backend/routes/wallet.js (Fixed: Use req.user.id consistently; no redundant token/getUser)
const Razorpay = require("razorpay");
const crypto = require("crypto");
const supabase = require("../config/supabaseUser");
const { router } = require('../app');
const authMiddleware = require("../middleware/auth");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
})

function isValidUUID(u) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(u);
}

async function logFailedTransaction(userId, reason, paymentId = null) {
  try {
    await supabase
      .from("wallet_transactions")
      .insert({
        user_id: userId,
        amount: 0,
        description: `Recharge failed: ${reason}`,
        payment_id: paymentId,
      });
  } catch (err) {
    console.error("Log failed tx error:", err);
  }
}

// ✅ Create Razorpay Order
router.post("/create-razor", authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: `wallet_${Date.now()}`,
    });

    res.json(order);
  } catch (error) {
    console.error("create-order error:", error);
    // Bubble up Razorpay auth problems clearly so UI can show actionable message
    if (error?.statusCode === 401) {
      return res.status(401).json({
        error: "Razorpay authentication failed",
        details: error?.error || error?.description || "Invalid Razorpay key/secret",
      });
    }
    res.status(500).json({ error: "Order creation failed", details: error?.message || error });
  }
});

// Verify payment
router.post("/verify-payment", authMiddleware, async (req, res) => {
  try {
    const { order_id, payment_id, signature, amount } = req.body;

    if (!order_id || !payment_id || !signature || !amount) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // ✅ Use req.user.id (validated in middleware)
    const userId = req.user?.id;
    if (!userId || !isValidUUID(userId)) {
      return res.status(400).json({ error: "Invalid user from auth" });
    }

    // Verify Razorpay signature
    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${order_id}|${payment_id}`)
      .digest("hex");

    if (expected !== signature) {
      console.warn("Invalid signature", { expected, signature });
      await logFailedTransaction(userId, "invalid signature", payment_id);
      return res.status(400).json({ success: false, message: "Invalid signature" });
    }

    // Fetch payment to double-check
    const payment = await razorpay.payments.fetch(payment_id);
    if (!payment) {
      await logFailedTransaction(userId, "payment not found", payment_id);
      return res.status(400).json({ success: false, message: "Payment not found on Razorpay" });
    }
    if (payment.order_id !== order_id) {
      await logFailedTransaction(userId, "order_id mismatch", payment_id);
      return res.status(400).json({ success: false, message: "order_id mismatch" });
    }
    if (payment.status !== "captured") {
      await logFailedTransaction(userId, `status ${payment.status}`, payment_id);
      return res.status(400).json({ success: false, message: `Payment not captured: ${payment.status}` });
    }

    const amountPaise = Math.round(Number(amount) * 100);
    if (Number(payment.amount) !== amountPaise) {
      await logFailedTransaction(userId, "amount mismatch", payment_id);
      return res.status(400).json({ success: false, message: "Amount mismatch" });
    }

    // Idempotency check
    const { data: existing, error: selErr } = await supabase
      .from("wallet_transactions")
      .select("id")
      .eq("payment_id", payment_id)
      .limit(1);

    if (selErr) {
      console.error("Supabase lookup error:", selErr);
      return res.status(500).json({ success: false, message: "Server error" });
    }
    if (existing && existing.length > 0) {
      const { data: walletRows } = await supabase
        .from("wallets")
        .select("wallet_balance")
        .eq("user_id", userId)
        .limit(1);

      const wallet_balance = walletRows && walletRows[0] ? walletRows[0].wallet_balance : null;
      return res.json({ success: true, message: "Payment already processed", wallet_balance });
    }

    // Add to wallet
    const { data, error } = await supabase.rpc("add_to_wallet", {
      p_user: userId,
      p_amount: Number(amount),
      p_description: "Wallet recharge via Razorpay",
      p_payment_id: payment_id,
    });

    if (error) {
      console.error("Supabase add_to_wallet error:", error);
      await logFailedTransaction(userId, "wallet update error", payment_id);
      return res.status(500).json({ success: false, message: "Failed to update wallet" });
    }

    const newBalance = data && data[0] ? data[0].wallet_balance : null;
    return res.json({ success: true, message: "Payment verified and wallet updated", wallet_balance: newBalance });
  } catch (err) {
    console.error("verify-payment error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /wallet/balance
router.get("/wallet/balance", authMiddleware, async (req, res) => {
  try {
    // ✅ Use req.user.id (no redundant extraction)
    const userId = req.user?.id;
    if (!userId) {
      console.error('Missing userId from middleware');
      return res.status(401).json({ error: "Invalid auth" });
    }

    console.log('Querying balance for userId:', userId);

    const { data, error } = await supabase
      .from("wallets")
      .select("wallet_balance")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("Supabase query error:", error);
      return res.status(500).json({ error: "Failed to fetch balance" });
    }

    console.log('Query result:', data ? { wallet_balance: data.wallet_balance } : 'No row found');  // Debug

    const wallet_balance = data ? data.wallet_balance : 0;
    return res.status(200).json({ wallet_balance });
  } catch (err) {
    console.error("wallet balance error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /wallet/history
router.get("/wallet/history", authMiddleware, async (req, res) => {
  try {
    // ✅ Use req.user.id
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Invalid auth" });
    }

    console.log(`userId:${userId}`);
    

    console.log('Querying history for userId:', userId);

    const { data, error } = await supabase
      .from("wallet_transactions")
      .select("id, amount, description, payment_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

      console.log(data);
      

    if (error) {
      console.error("Supabase history error:", error);
      return res.status(500).json({ error: "Failed to fetch history" });
    }

    console.log('History count:', data ? data.length : 0);  // Debug

    return res.json({ transactions: data || [] });
  } catch (err) {
    console.error("wallet history error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /wallet/spend
router.post("/wallet/spend", authMiddleware, async (req, res) => {
  try {
    const { amount, description } = req.body;
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "Invalid amount" });

    // ✅ Use req.user.id
    const userId = req.user?.id;
    
    

    if (!userId) return res.status(401).json({ error: "Invalid auth" });

    const { data, error } = await supabase.rpc("subtract_from_wallet", {
      p_user: userId,
      p_amount: Number(amount),
      p_description: description || "Wallet spend"
    });

    if (error) {
      console.error("subtract_from_wallet rpc error:", error);
      const msg = error.message || JSON.stringify(error);
      if (msg.includes("insufficient_funds")) {
        return res.status(400).json({ success: false, message: error.message });
      }
      return res.status(500).json({ success: false, message: "Failed to deduct from wallet", error: msg });
    }

    let newBalance = null;
    if (Array.isArray(data)) newBalance = data[0] && (data[0].wallet_balance ?? data[0]);
    else if (data && typeof data === "object") newBalance = data.wallet_balance ?? null;
    else newBalance = data;

    return res.json({ success: true, wallet_balance: Number(newBalance ?? 0) });
  } catch (err) {
    console.error("wallet spend error", err);
    if (String(err).includes("insufficient_funds")) {
      return res.status(400).json({ success: false, message: "Insufficient funds" });
    }
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
