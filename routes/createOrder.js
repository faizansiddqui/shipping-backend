const pickup_table = require('../models/picupAddress.model')
const order_table = require('../models/orderTable');
const { QueryTypes } = require('sequelize');
const { router } = require('../app');
const { db } = require('../config/db');
const authMiddleware = require('../middleware/auth');
const supabase = require('../config/supabase');
const axios = require('axios')


router.post('/create/pickup_location', async (req, res) => {
  try {
    const {
      address_name,
      contact_name,
      contact_number,
      email,
      address_line,
      address_line2,
      city,
      pincode,
      dropship_location,
      gstin,
      use_alt_rto_address,
      create_rto_address = {},
      user_id
    } = req.body;

    console.log('📦 Request body user_id:', user_id);

    // Basic validation
    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ success: false, message: 'Missing or invalid user_id' });
    }

    // ✅ FIXED: use db.query instead of Sequelize.query
    const userExists = await db.query(
      'SELECT id FROM auth.users WHERE id = :uid',
      {
        replacements: { uid: user_id },
        type: QueryTypes.SELECT
      }
    );

    if (!userExists || userExists.length === 0) {
      return res.status(400).json({ success: false, message: 'User not found in auth.users' });
    }

    // VALIDATIONS
    const errors = [];
    if (!address_name?.trim()) errors.push("address_name is mandatory");
    if (!/^[A-Za-z ]+$/.test(contact_name || '')) errors.push("contact_name should contain only alphabets");
    if (!/^\d{10}$/.test(contact_number || '')) errors.push("contact_number must be 10 digits");
    if (!/^\d{6}$/.test(pincode || '')) errors.push("pincode must be 6 digits");
    if (typeof use_alt_rto_address !== 'boolean') errors.push("use_alt_rto_address must be boolean");

    if (use_alt_rto_address) {
      const r = create_rto_address;
      if (!r.rto_address_name?.trim()) errors.push("rto_address_name missing");
      if (!/^[A-Za-z ]+$/.test(r.rto_contact_name || '')) errors.push("rto_contact_name invalid");
      if (!/^\d{10}$/.test(r.rto_contact_number || '')) errors.push("rto_contact_number invalid");
      if (!r.rto_address_line?.trim()) errors.push("rto_address_line missing");
      if (!/^\d{6}$/.test(r.rto_pincode || '')) errors.push("rto_pincode invalid");
    }

    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors });
    }

    // Ensure unique address per user
    const existing = await pickup_table.findOne({ where: { user_id, address_name } });
    if (existing) {
      return res.status(400).json({ success: false, message: 'You already have an address with this name' });
    }

    // CREATE record
    let createdRecord;
    try {
      createdRecord = await pickup_table.create({
        user_id,
        address_name,
        contact_name,
        contact_number,
        email,
        address_line,
        address_line2,
        city,
        pincode,
        gstin,
        dropship_location: !!dropship_location,
        use_alt_rto_address,
        create_rto_address: use_alt_rto_address ? create_rto_address : {}
      });
    } catch (dbErr) {
      console.error('❌ DB Insert Error:', dbErr);
      return res.status(500).json({
        success: false,
        message: 'Database error',
        error: dbErr.message,
        detail: dbErr?.parent?.detail
      });
    }

    // CALL Rapidshyp API
    try {
      const result = await fetch('https://api.rapidshyp.com/rapidshyp/apis/v1/create/pickup_location', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'rapidshyp-token': process.env.RAPIDSHYP_TOKEN
        },
        body: JSON.stringify({
          address_name,
          contact_name,
          contact_number,
          email,
          address_line,
          address_line2,
          pincode,
          gstin,
          dropship_location,
          use_alt_rto_address,
          create_rto_address
        })
      });

      const rapidresult = await result.json();

      return res.json({
        success: true,
        message: 'Pickup address created successfully',
        data: { createdRecord, rapidresult }
      });

    } catch (rsErr) {
      console.error('⚠️ Rapidshyp API Error:', rsErr);
      return res.json({
        success: true,
        message: 'Pickup created locally, but Rapidshyp API failed',
        data: { createdRecord },
        rapidshypError: rsErr.message
      });
    }

  } catch (err) {
    console.error('💥 Route error:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// POST /create-order
router.post('/create-order', async (req, res) => {
  try {
    const body = req.body || {};

    // 🧑‍💻 Fetch the current logged-in user (fixed: use token from cookies)
    const accessToken = req.cookies?.sb_access_token;
    if (!accessToken) {
      console.error("No access token in cookies");
      return res.status(401).json({ error: "Unauthorized - No token" });
    }

    const { data: { user }, error } = await supabase.auth.getUser(accessToken);

    if (error || !user) {
      console.error("User not found or invalid token", error);
      return res.status(401).json({ error: "Unauthorized - Invalid token" });
    }

    // console.log("✅ Authenticated user:", user.id);

    const requiredTop = ['orderId', 'orderDate', 'shippingAddress', 'orderItems', 'paymentMethod', 'totalOrderValue', 'packageDetails', 'storeName', 'billingIsShipping'];

    // yaha par kuch fields ko requered kar rha hu 
    for (const k of requiredTop) {
      if (body[k] === undefined || body[k] === null) {
        return res.status(400).json({ status: false, message: `${k} is required` });
      }
    }

    // Normalize & validate paymentMethod
    const paymentMethod = String(body.paymentMethod).toUpperCase();

    if (!['PREPAID', 'COD'].includes(paymentMethod)) return res.status(400).json({ status: false, message: 'paymentMethod must be PREPAID or COD' });

    // Validate shippingAddress
    const sa = body.shippingAddress;
    if (!sa.firstName || sa.firstName.trim().length < 1) return res.status(400).json({ status: false, message: 'shippingAddress.firstName required' });
    if (!sa.addressLine1 || sa.addressLine1.trim().length < 3) return res.status(400).json({ status: false, message: 'shippingAddress.addressLine1 invalid' });
    if (!/^\d{6}$/.test(String(sa.pinCode))) return res.status(400).json({ status: false, message: 'shippingAddress.pinCode invalid' });
    if (!/^[6-9]\d{9}$/.test(String(sa.phone))) return res.status(400).json({ status: false, message: 'shippingAddress.phone invalid' });

    // Validate orderItems
    const items = Array.isArray(body.orderItems) ? body.orderItems : [];
    if (items.length === 0) return res.status(400).json({ status: false, message: 'orderItems must have at least one item' });

    for (const it of items) {
      if (!it.itemName || it.itemName.trim().length < 3) return res.status(400).json({ status: false, message: 'Each item must have itemName min 3 chars' });
      if (!(Number(it.units) > 0)) return res.status(400).json({ status: false, message: 'Each item units must be > 0' });
      if (!(Number(it.unitPrice) > 0)) return res.status(400).json({ status: false, message: 'Each item unitPrice must be > 0' });
      if (it.tax === undefined || it.tax === null) it.tax = 0;
    }

    // Validate packageDetails
    const pd = body.packageDetails;
    if (pd.packageLength === undefined || pd.packageBreadth === undefined || pd.packageHeight === undefined || pd.packageWeight === undefined) {
      return res.status(400).json({ status: false, message: 'packageDetails missing required keys' });
    }

    // Build final payload exactly as Rapidshyp expects
    const resultPayload = {
      orderId: String(body.orderId),
      orderDate: String(body.orderDate), // YYYY-MM-DD
      pickupAddressName: body.pickupAddressName || undefined,
      storeName: body.storeName || 'DEFAULT',
      billingIsShipping: Boolean(body.billingIsShipping),
      shippingAddress: {
        firstName: sa.firstName,
        lastName: sa.lastName || "",
        addressLine1: sa.addressLine1,
        addressLine2: sa.addressLine2 || "",
        pinCode: String(sa.pinCode),
        email: sa.email || "",
        phone: String(sa.phone)
      },
      billingAddress: body.billingAddress || undefined,
      orderItems: items.map(it => ({
        itemName: it.itemName,
        sku: it.sku || "",
        description: it.description || "",
        units: Number(it.units),
        unitPrice: Number(it.unitPrice),
        tax: Number(it.tax || 0),
        hsn: it.hsn || "",
        productLength: it.productLength || null,
        productBreadth: it.productBreadth || null,
        productHeight: it.productHeight || null,
        productWeight: it.productWeight || null,
        brand: it.brand || "",
        imageURL: it.imageURL || "",
        isFragile: Boolean(it.isFragile || false),
        isPersonalisable: Boolean(it.isPersonalisable || false),
        pickupAddressName: it.pickupAddressName || undefined
      })),
      paymentMethod,
      shippingCharges: Number(body.shippingCharges || 0),
      codCharges: Number(body.codCharges || 0),
      prepaidAmount: Number(body.prepaidAmount || 0),
      totalOrderValue: Number(body.totalOrderValue),
      packageDetails: {
        packageLength: Number(pd.packageLength),
        packageBreadth: Number(pd.packageBreadth),
        packageHeight: Number(pd.packageHeight),
        packageWeight: Number(pd.packageWeight) // kg
      }
    };

    // Check if orderId already exists before attempting insert
    const existingOrder = await order_table.findOne({ where: { orderId: resultPayload.orderId } });
    if (existingOrder) {
      return res.status(409).json({
        status: false,
        message: `Order ID '${resultPayload.orderId}' already exists. Please use a unique ID.`,
        existingOrderId: existingOrder.orderId
      });
    }

    // Save to DB (updated: include userId)
    try {
      await order_table.create({
        user_id: user.id, // New: Associate with current user
        status: 'PENDING', // Explicitly set default status
        orderId: resultPayload.orderId,
        orderDate: resultPayload.orderDate,
        pickupAddressName: resultPayload.pickupAddressName || null,
        storeName: resultPayload.storeName,
        billingIsShipping: resultPayload.billingIsShipping,
        shippingAddress: resultPayload.shippingAddress,
        totalOrderValue: resultPayload.totalOrderValue,
        shippingCharges: resultPayload.shippingCharges,
        codCharges: resultPayload.codCharges,
        prepaidAmount: resultPayload.prepaidAmount,
        orderItems: resultPayload.orderItems,
        paymentMethod: resultPayload.paymentMethod,
        packageDetails: resultPayload.packageDetails,

        // New: Include selected shipping details for only DB save
        selectShippingCharges: body.selectShippingCharges,
        selectedCourierName: body.selectedCourierName,
        selectedFreightMode: body.selectedFreightMode,
      });
    } catch (dbErr) {
      console.error('DB Save Order Error:', dbErr);
      if (dbErr.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({
          status: false,
          message: `Duplicate order ID detected: ${dbErr.errors[0]?.value}. Please use a unique ID.`,
          detail: dbErr?.parent?.detail
        });
      }
      return res.status(500).json({
        status: false,
        message: 'Failed to save order locally',
        error: dbErr.message,
        detail: dbErr?.parent?.detail
      });
    }

    // Call Rapidshyp API
    const create_order_result = await fetch('https://api.rapidshyp.com/rapidshyp/apis/v1/create_order', {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "rapidshyp-token": process.env.RAPIDSHYP_TOKEN
      },
      body: JSON.stringify(resultPayload)
    });

    if (!create_order_result.ok) {
      const errorText = await create_order_result.text();
      console.error("Rapidshyp API Error:", errorText);
      return res.status(create_order_result.status).json({
        status: false,
        message: "Failed to create order in Rapidshyp",
        error: errorText
      });
    }

    const rapidresult = await create_order_result.json();
    return res.status(200).json({ success: true, message: "Order created successfully", data: rapidresult });

  } catch (error) {
    console.error("Error in create-order:", error);
    return res.status(500).json({ error: "Something went wrong", detail: error.message });
  }
});


// fetch order wise user 
router.get('/user-orders', async (req, res) => {
  try {
    // Fetch the current logged-in user (fixed)
    const accessToken = req.cookies?.sb_access_token;
    if (!accessToken) {
      return res.status(401).json({ error: "Unauthorized - No token" });
    }                   

    const { data: { user }, error } = await supabase.auth.getUser(accessToken);

    if (error || !user) {
      console.error("User not found or invalid token", error);
      return res.status(401).json({ error: "Unauthorized - Invalid token" });
    }

    // console.log("✅ Fetching orders for user:", user.id);

    // Fetch orders by userId
    const orders = await order_table.findAll({
      where: { user_id: user.id },
      order: [['createdAt', 'DESC']]
    });

    return res.status(200).json({
      status: true,
      data: orders.map(order => order.toJSON())
    });

  } catch (error) {
    console.error("Error fetching user orders:", error);
    return res.status(500).json({ error: "Failed to fetch orders", detail: error.message });
  }
});


// fetch all order 
router.get('/all-orders', async (req, res) => {
  try {
    // console.log("✅ Fetching all orders");

    // Fetch all orders from the table
    const orders = await order_table.findAll({
      order: [['createdAt', 'DESC']]
    });

    return res.status(200).json({
      status: true,
      data: orders.map(order => order.toJSON())
    });

  } catch (error) {
    console.error("Error fetching all orders:", error);
    return res.status(500).json({ error: "Failed to fetch orders", detail: error.message });
  }
});


router.patch('/orders/:orderId/update-status', authMiddleware, async (req, res) => {
  const t = await db.transaction(); // start transaction

  try {
    const { orderId } = req.params;
    const { status, selectShippingCharges: amount } = req.body;

    if (!status) {
      await t.rollback();
      return res.status(400).json({ status: false, message: 'Status is required in body' });
    }

    const validStatuses = ['PENDING', 'ACCEPTED', 'REJECTED', 'ON_WAY', 'RTO', 'DELIVERED'];
    if (!validStatuses.includes(status)) {
      await t.rollback();
      return res.status(400).json({
        status: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    // Fetch order within transaction
    const order = await order_table.findOne({ where: { orderId }, transaction: t });
    if (!order) {
      await t.rollback();
      return res.status(404).json({
        status: false,
        message: `Order with ID '${orderId}' not found`
      });
    }

    //  Update order status inside transaction
    await order.update({ status }, { transaction: t });

    // ✅ Get token from authMiddleware
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : req.cookies?.sb_access_token;
    if (!token) {
      await t.rollback();
      return res.status(401).json({ error: "No auth token" });
    }

    // ✅ Wallet spend logic
    // let spendAmount = 0;
    // if (status === 'ACCEPTED') {
    //   spendAmount = Number(amount);
    // } else if (status === 'RTO') {
    //   spendAmount = Number(amount) / 2;
    // }

    // if (spendAmount > 0) {
    //   console.log(`💰 Wallet spend attempt: ₹${spendAmount}`);

    //   const response = await fetch(`${process.env.APP_BASE_URL}/wallet/spend`, {
    //     method: "POST",
    //     headers: {
    //       "Content-Type": "application/json",
    //       "Authorization": `Bearer ${token}`,
    //     },
    //     body: JSON.stringify({
    //       amount: spendAmount,
    //       description: `Order ${status === 'RTO' ? 'Return' : 'Acceptance'} for orderId ${orderId}`,
    //     }),
    //   });

    //   const walletData = await response.json();

  //     if (!response.ok) {
  //       console.error("❌ wallet/spend failed:", walletData);
  //       throw walletData
  //     }

  //     console.log("✅ Wallet spend success:", walletData);
  //  }



    //  Commit transaction if all good
    await t.commit();

    return res.status(200).json({
      status: true,
      message: `Order status updated to '${status}' successfully`,
      data: order.toJSON(),
    });

  } catch (error) {
    console.error(" Error updating order status:", error);

    //  Rollback on any failure
    await t.rollback();

    return res.json({
      status: false,
      message: error.message,
      data:"Transaction failed — rolled back"
    });
  }
});


router.get('/fetchPickupLocationPicode', authMiddleware, async (req, res) => {
  try {
    const { addressName } = req.query;

    if (!addressName || typeof addressName !== 'string' || addressName.trim().length < 1) {
      return res.status(400).json({
        status: false,
        message: 'addressName query parameter is required and must be a non-empty string.'
      });
    }

    const trimmedAddressName = addressName.trim();

    // Fetch the pickup address by address_name
    const pickup = await pickup_table.findOne({
      where: { address_name: trimmedAddressName },
      attributes: ['address_name', 'pincode', 'user_id']
    });

    if (!pickup) {
      return res.status(404).json({
        status: false,
        message: `Pickup location not found for address name: ${trimmedAddressName}`
      });
    }

    // Optional: you can restrict pincode visibility to same-pincode users or owners. 
    // Current behavior: authenticated users can read pincode.
    return res.status(200).json({
      status: true,
      message: 'Pickup location pincode fetched successfully',
      data: {
        addressName: pickup.address_name,
        pincode: pickup.pincode
      }
    });
  } catch (error) {
    console.error('Error in fetchPickupLocationPicode:', error);
    return res.status(500).json({
      status: false,
      message: 'Internal server error while fetching pincode'
    });
  }
});


router.get('/fetchAllPickupAddress', authMiddleware, async (req, res) => {
  try {
    // try get pincode from supabase user metadata or from user object
    const user = req.user;
    const userPincode =
      user?.user_metadata?.pincode || // if you stored pincode in user_metadata
      user?.pincode ||                 // or if you store directly in user record
      null;

    let where = {};
    if (userPincode) {
      // area-based: return all pickup addresses matching user's pincode
      where = { pincode: userPincode };
    } else if (user?.id) {
      // fallback: return only addresses owned by the user
      where = { user_id: user.id };
    } else {
      // extremely unlikely because authMiddleware ensures user, but safe-guard:
      return res.status(400).json({ status: false, message: 'No pincode or user id available' });
    }

    const addresses = await pickup_table.findAll({
      where,
      attributes: ['address_name']
    });

    return res.json({
      status: true,
      message: 'Pickup address names fetched successfully',
      data: addresses.map(a => a.address_name)
    });
  } catch (error) {
    console.error('Error in /fetchAllPickupAddress:', error);
    return res.status(500).json({ status: false, message: 'Internal server error' });
  }
});


router.get('/count-order', async (req, res) => {
  const count = await order_table.count();
  res.json({ status: true, data: count })
})


 
router.post('/schedule-order',authMiddleware,async(req,res)=>{
   const {shipment_id,awb} = req.body;
   if(!shipment_id){
    return res.status(400).json({Status:false,Message:"Shipment_id/Orderid must be provided"});
   }

   try {

       const rapidResponse = await fetch('https://api.rapidshyp.com/rapidshyp/apis/v1/schedule_pickup',{
    method:"POST",
    headers:{
      "rapidshyp-token":process.env.RAPIDSHYP_TOKEN,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      shipment_id:shipment_id,
      awb:awb || ""
    })
   });

   const result = await rapidResponse.text();

   if(!rapidResponse.ok){
    return res.status(400).json({Message:result})
   }

   return res.status(200).json({status:"Success",Message:result})
    
   } catch (error) {
     
    console.error(error);
    res.status(500).json({Message:"something went wrong"});
    
    
   }


})

//APPROVE ORDER HIT AFTER CREATE ORDER
router.post('/approve-orders',async(req,res)=>{
   const {shipment_id}  = req.body;
   if(shipment_id.length == 0) return res.status(400).json({Message:'shipment_id/order id must be provided'});

   try {

    const rapid_response = await fetch('https://api.rapidshyp.com/rapidshyp/apis/v1/approve_orders',{
      method:'POST',
      headers:{
        'rapidshyp-token':process.env.RAPIDSHYP_TOKEN,
         "Content-Type":"application/json"
      },
      body:JSON.stringify({
        order_id:shipment_id, //array of order id
        store_name:'DEFAULT'
      })
    });
    const result = await rapid_response.text();
    if(!rapid_response.ok){
      return res.status(400).json({Message:"Cant't Approve Orders",err:result});
    }

    return res.status(200).json({Status:"Success",Meassage:result})
    
   } catch (error) {
    console.error(error);
    res.status(500).json({Message:"something went wrong",error:error})  
    
   }
})


module.exports = router;