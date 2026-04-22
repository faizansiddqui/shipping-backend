const express = require('express');
const router = express.Router();
const pickup_table = require('../models/picupAddress.model');
const order_table = require('../models/orderTable');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const mongoose = require('../config/mongo');

// Helpers to extract AWB/label from RapidShyp responses (kept from prior code)
const extractAwbNumber = (data) =>
    data?.awb ||
    data?.awb_number ||
    data?.AWB ||
    data?.data?.awb ||
    data?.data?.awb_number ||
    data?.data?.AWB ||
    '';

const extractLabelUrl = (data) =>
    data?.label_url ||
    data?.labelUrl ||
    data?.label_link ||
    data?.labelLink ||
    data?.label ||
    data?.pdf_label ||
    data?.pdfLabel ||
    data?.labelURL ||
    data?.file_name ||
    data?.fileName ||
    data?.labelRemarks ||
    data?.data?.label_url ||
    data?.data?.label ||
    data?.data?.label_link ||
    data?.data?.file_name ||
    data?.data?.fileName ||
    data?.labelUrlWithPrefix ||
    data?.data?.labelUrlWithPrefix ||
    '';

const generateLabel = async (shipmentId, awb = '') => {
    const resp = await fetch('https://api.rapidshyp.com/rapidshyp/apis/v1/generate_label', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'rapidshyp-token': process.env.RAPIDSHYP_TOKEN,
        },
        body: JSON.stringify({ shipmentId: [shipmentId], shipment_id: [shipmentId], order_id: [shipmentId], awb_number: awb || undefined, awb: awb || undefined }),
    });

    const raw = await resp.text();
    let data = null;
    try {
        data = raw ? JSON.parse(raw) : null;
    } catch (err) {
        data = null;
    }

    if (!resp.ok || data?.status === false) {
        const msg = data?.remarks || data?.message || raw || 'Failed to generate label from RapidShyp';
        const err = new Error(msg);
        err.data = data;
        err.httpStatus = resp.status;
        throw err;
    }

    const labelUrl = extractLabelUrl(data) || (data?.labelData && data.labelData[0] && (data.labelData[0].labelURL || data.labelData[0].file_name)) || '';
    const awbFromLabel = extractAwbNumber(data) || null;
    return { labelUrl, awb: awbFromLabel, raw: data };
};

// Create pickup location
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
            user_id,
        } = req.body;

        if (!user_id || typeof user_id !== 'string') return res.status(400).json({ success: false, message: 'Missing or invalid user_id' });

        const userExists = await User.findById(user_id);
        if (!userExists) return res.status(400).json({ success: false, message: 'User not found' });

        // Validations
        const errors = [];
        if (!address_name?.trim()) errors.push('address_name is mandatory');
        if (!/^[A-Za-z ]+$/.test(contact_name || '')) errors.push('contact_name should contain only alphabets');
        if (!/^\d{10}$/.test(contact_number || '')) errors.push('contact_number must be 10 digits');
        if (!/^\d{6}$/.test(pincode || '')) errors.push('pincode must be 6 digits');
        if (typeof use_alt_rto_address !== 'boolean') errors.push('use_alt_rto_address must be boolean');

        if (use_alt_rto_address) {
            const r = create_rto_address;
            if (!r.rto_address_name?.trim()) errors.push('rto_address_name missing');
            if (!/^[A-Za-z ]+$/.test(r.rto_contact_name || '')) errors.push('rto_contact_name invalid');
            if (!/^\d{10}$/.test(r.rto_contact_number || '')) errors.push('rto_contact_number invalid');
            if (!r.rto_address_line?.trim()) errors.push('rto_address_line missing');
            if (!/^\d{6}$/.test(r.rto_pincode || '')) errors.push('rto_pincode invalid');
        }

        if (errors.length > 0) return res.status(400).json({ success: false, message: 'Validation failed', errors });

        const existing = await pickup_table.findOne({ user_id, address_name });
        if (existing) return res.status(400).json({ success: false, message: 'You already have an address with this name' });

        const createdRecord = await pickup_table.create({ user_id, address_name, contact_name, contact_number, email, address_line, address_line2, city, pincode, gstin, dropship_location: !!dropship_location, use_alt_rto_address, create_rto_address: use_alt_rto_address ? create_rto_address : {} });

        // Call Rapidshyp API (best-effort)
        try {
            const result = await fetch('https://api.rapidshyp.com/rapidshyp/apis/v1/create/pickup_location', {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'rapidshyp-token': process.env.RAPIDSHYP_TOKEN },
                body: JSON.stringify({ address_name, contact_name, contact_number, email, address_line, address_line2, pincode, gstin, dropship_location, use_alt_rto_address, create_rto_address }),
            });
            const rapidresult = await result.json();
            return res.json({ success: true, message: 'Pickup address created successfully', data: { createdRecord, rapidresult } });
        } catch (rsErr) {
            console.error('Rapidshyp API Error:', rsErr);
            return res.json({ success: true, message: 'Pickup created locally, but Rapidshyp API failed', data: { createdRecord }, rapidshypError: rsErr.message });
        }
    } catch (err) {
        console.error('💥 Route error:', err);
        return res.status(500).json({ success: false, message: 'Server error', error: err.message });
    }
});

// Create order (requires auth)
router.post('/create-order', authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        const body = req.body || {};

        const requiredTop = [
            'orderId',
            'orderDate',
            'shippingAddress',
            'orderItems',
            'paymentMethod',
            'totalOrderValue',
            'packageDetails',
            'storeName',
            'billingIsShipping',
        ];

        for (const k of requiredTop) {
            if (body[k] === undefined || body[k] === null) return res.status(400).json({ status: false, message: `${k} is required` });
        }

        const paymentMethod = String(body.paymentMethod).toUpperCase();
        if (!['PREPAID', 'COD'].includes(paymentMethod)) return res.status(400).json({ status: false, message: 'paymentMethod must be PREPAID or COD' });

        const sa = body.shippingAddress;
        if (!sa.firstName || sa.firstName.trim().length < 1) return res.status(400).json({ status: false, message: 'shippingAddress.firstName required' });
        if (!sa.addressLine1 || sa.addressLine1.trim().length < 3) return res.status(400).json({ status: false, message: 'shippingAddress.addressLine1 invalid' });
        if (!/^\d{6}$/.test(String(sa.pinCode))) return res.status(400).json({ status: false, message: 'shippingAddress.pinCode invalid' });
        if (!/^[6-9]\d{9}$/.test(String(sa.phone))) return res.status(400).json({ status: false, message: 'shippingAddress.phone invalid' });

        const items = Array.isArray(body.orderItems) ? body.orderItems : [];
        if (items.length === 0) return res.status(400).json({ status: false, message: 'orderItems must have at least one item' });
        for (const it of items) {
            if (!it.itemName || it.itemName.trim().length < 3) return res.status(400).json({ status: false, message: 'Each item must have itemName min 3 chars' });
            if (!(Number(it.units) > 0)) return res.status(400).json({ status: false, message: 'Each item units must be > 0' });
            if (!(Number(it.unitPrice) > 0)) return res.status(400).json({ status: false, message: 'Each item unitPrice must be > 0' });
            if (it.tax === undefined || it.tax === null) it.tax = 0;
        }

        const pd = body.packageDetails;
        if (pd.packageLength === undefined || pd.packageBreadth === undefined || pd.packageHeight === undefined || pd.packageWeight === undefined) {
            return res.status(400).json({ status: false, message: 'packageDetails missing required keys' });
        }

        const resultPayload = {
            orderId: String(body.orderId),
            orderDate: String(body.orderDate),
            pickupAddressName: body.pickupAddressName || undefined,
            storeName: body.storeName || 'DEFAULT',
            billingIsShipping: Boolean(body.billingIsShipping),
            shippingAddress: {
                firstName: sa.firstName,
                lastName: sa.lastName || '',
                addressLine1: sa.addressLine1,
                addressLine2: sa.addressLine2 || '',
                pinCode: String(sa.pinCode),
                email: sa.email || '',
                phone: String(sa.phone),
            },
            billingAddress: body.billingAddress || undefined,
            orderItems: items.map((it) => ({ itemName: it.itemName, sku: it.sku || '', description: it.description || '', units: Number(it.units), unitPrice: Number(it.unitPrice), tax: Number(it.tax || 0), hsn: it.hsn || '', productLength: it.productLength || null, productBreadth: it.productBreadth || null, productHeight: it.productHeight || null, productWeight: it.productWeight || null, brand: it.brand || '', imageURL: it.imageURL || '', isFragile: Boolean(it.isFragile || false), isPersonalisable: Boolean(it.isPersonalisable || false), pickupAddressName: it.pickupAddressName || undefined })),
            paymentMethod,
            shippingCharges: Number(body.shippingCharges || 0),
            codCharges: Number(body.codCharges || 0),
            prepaidAmount: Number(body.prepaidAmount || 0),
            totalOrderValue: Number(body.totalOrderValue),
            packageDetails: { packageLength: Number(pd.packageLength), packageBreadth: Number(pd.packageBreadth), packageHeight: Number(pd.packageHeight), packageWeight: Number(pd.packageWeight) },
        };

        const isCod = String(paymentMethod || '').toUpperCase() === 'COD';
        const hiddenSurcharge = 20;
        const collectableAmount = isCod ? Number(resultPayload.totalOrderValue || 0) + Number(resultPayload.shippingCharges || 0) + Number(resultPayload.codCharges || 0) + hiddenSurcharge : 0;
        resultPayload.shippingCharges = Number(resultPayload.shippingCharges || 0) + hiddenSurcharge;
        resultPayload.cod = isCod;
        resultPayload.codAmount = collectableAmount;
        resultPayload.collectable_amount = collectableAmount;
        resultPayload.collectableValue = collectableAmount;

        const existingOrder = await order_table.findOne({ orderId: resultPayload.orderId });
        if (existingOrder) return res.status(409).json({ status: false, message: `Order ID '${resultPayload.orderId}' already exists. Please use a unique ID.`, existingOrderId: existingOrder.orderId });

        try {
            const created = await order_table.create({
                user_id: user._id,
                status: 'PENDING',
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
                selectShippingCharges: body.selectShippingCharges,
                selectedCourierName: body.selectedCourierName,
                selectedFreightMode: body.selectedFreightMode,
                cod: resultPayload.cod,
                codAmount: resultPayload.codAmount,
                collectable_amount: resultPayload.collectable_amount,
                collectableValue: resultPayload.collectableValue,
            });
        } catch (dbErr) {
            console.error('DB Save Order Error:', dbErr);
            return res.status(500).json({ status: false, message: 'Failed to save order locally', error: dbErr.message });
        }

        // Call Rapidshyp
        const create_order_result = await fetch('https://api.rapidshyp.com/rapidshyp/apis/v1/create_order', { method: 'POST', headers: { 'content-type': 'application/json', 'rapidshyp-token': process.env.RAPIDSHYP_TOKEN }, body: JSON.stringify(resultPayload) });
        if (!create_order_result.ok) {
            const errorText = await create_order_result.text();
            console.error('Rapidshyp API Error:', errorText);
            return res.status(create_order_result.status).json({ status: false, message: 'Failed to create order in Rapidshyp', error: errorText });
        }

        const rapidresult = await create_order_result.json();
        return res.status(200).json({ success: true, message: 'Order created successfully', data: rapidresult });
    } catch (error) {
        console.error('Error in create-order:', error);
        return res.status(500).json({ error: 'Something went wrong', detail: error.message });
    }
});

// Fetch orders for the logged-in user
router.get('/user-orders', authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        const orders = await order_table.find({ user_id: user._id }).sort({ createdAt: -1 }).lean();
        return res.status(200).json({ status: true, data: orders });
    } catch (error) {
        console.error('Error fetching user orders:', error);
        return res.status(500).json({ error: 'Failed to fetch orders', detail: error.message });
    }
});

// Fetch all orders
router.get('/all-orders', async (req, res) => {
    try {
        const orders = await order_table.find().sort({ createdAt: -1 }).lean();
        return res.status(200).json({ status: true, data: orders });
    } catch (error) {
        console.error('Error fetching all orders:', error);
        return res.status(500).json({ error: 'Failed to fetch orders', detail: error.message });
    }
});

// Update order status
router.patch('/orders/:orderId/update-status', authMiddleware, async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { orderId } = req.params;
        const { status } = req.body;
        if (!status) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ status: false, message: 'Status is required in body' });
        }

        const validStatuses = ['PENDING', 'ACCEPTED', 'REJECTED', 'ON_WAY', 'RTO', 'DELIVERED'];
        if (!validStatuses.includes(status)) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ status: false, message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }

        const order = await order_table.findOne({ orderId }).session(session);
        if (!order) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ status: false, message: `Order with ID '${orderId}' not found` });
        }

        if (status === 'ACCEPTED') {
            const approveResponse = await fetch('https://api.rapidshyp.com/rapidshyp/apis/v1/approve_orders', { method: 'POST', headers: { 'rapidshyp-token': process.env.RAPIDSHYP_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id: [orderId], store_name: order.storeName || 'DEFAULT' }) });
            const approveText = await approveResponse.text();
            if (!approveResponse.ok) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ status: false, message: approveText || 'Rapidshyp approve failed' });
            }
        }

        order.status = status;
        await order.save({ session });

        await session.commitTransaction();
        session.endSession();

        return res.status(200).json({ status: true, message: `Order status updated to '${status}' successfully`, data: order.toObject() });
    } catch (error) {
        console.error(' Error updating order status:', error);
        await session.abortTransaction();
        session.endSession();
        return res.json({ status: false, message: error.message, data: 'Transaction failed — rolled back' });
    }
});

// Update shipping details
router.patch('/orders/:orderId/update-shipping', authMiddleware, async (req, res) => {
    try {
        const rawOrderId = req.params.orderId;
        if (!rawOrderId) return res.status(400).json({ status: false, message: 'Order ID is required' });

        const { selectShippingCharges, selectedCourierName, selectedFreightMode, paymentMethod } = req.body || {};
        if (!selectedCourierName || !selectedFreightMode) return res.status(400).json({ status: false, message: 'Courier name and freight mode are required' });

        const normalizedId = String(rawOrderId).trim();
        const fallbackId = normalizedId.startsWith('#') ? normalizedId.slice(1) : normalizedId;

        let order = await order_table.findOne({ orderId: normalizedId });
        if (!order && fallbackId !== normalizedId) order = await order_table.findOne({ orderId: fallbackId });
        if (!order) return res.status(404).json({ status: false, message: `Order with ID '${normalizedId}' not found` });

        order.selectShippingCharges = Number(selectShippingCharges || 0);
        order.selectedCourierName = selectedCourierName;
        order.selectedFreightMode = selectedFreightMode;
        order.paymentMethod = paymentMethod || order.paymentMethod;

        await order.save();

        return res.status(200).json({ status: true, message: 'Shipping details updated', data: order.toObject() });
    } catch (error) {
        console.error('Error updating shipping details:', error);
        return res.status(500).json({ status: false, message: 'Failed to update shipping details', error: error.message });
    }
});

// Schedule endpoints (simplified)
router.post('/orders/:orderId/schedule', authMiddleware, async (req, res) => {
    try {
        const rawOrderId = req.params.orderId;
        if (!rawOrderId) return res.status(400).json({ status: false, message: 'Order ID is required' });

        const { selectShippingCharges, selectedCourierName, selectedFreightMode, paymentMethod, courier_code } = req.body || {};
        if (!selectedCourierName || !selectedFreightMode) return res.status(400).json({ status: false, message: 'Courier name and freight mode are required' });
        if (!courier_code) return res.status(400).json({ status: false, message: 'courier_code is required' });

        const normalizedId = String(rawOrderId).trim();
        const fallbackId = normalizedId.startsWith('#') ? normalizedId.slice(1) : normalizedId;

        let order = await order_table.findOne({ orderId: normalizedId });
        if (!order && fallbackId !== normalizedId) order = await order_table.findOne({ orderId: fallbackId });
        if (!order) return res.status(404).json({ status: false, message: `Order with ID '${normalizedId}' not found` });

        if (order.status !== 'ACCEPTED') return res.status(400).json({ status: false, message: 'Only ACCEPTED orders can be scheduled' });

        const shipmentId = fallbackId;
        // fetch order info from RapidShyp
        const url = `https://api.rapidshyp.com/rapidshyp/apis/v1/get_orders_info?order_id=${encodeURIComponent(shipmentId)}&channel_order_id=${encodeURIComponent(shipmentId)}`;
        const headers = { 'content-type': 'application/json', 'rapidshyp-token': process.env.RAPIDSHYP_TOKEN };

        const resultResp = await fetch(url, { method: 'GET', headers });
        let infoRaw = await resultResp.text();
        let infoData = null;
        try { infoData = infoRaw ? JSON.parse(infoRaw) : null; } catch (e) { infoData = null; }

        if (!resultResp.ok) return res.status(400).json({ status: false, message: infoData?.remarks || infoData?.message || infoRaw || 'Failed to fetch order info', data: infoData || null, httpStatus: resultResp.status });

        const shipmentLines = Array.isArray(infoData?.shipment_lines) ? infoData.shipment_lines : [];
        if (shipmentLines.length === 0) return res.status(400).json({ status: false, message: 'No shipment lines found for this order.', data: infoData });

        const primaryShipment = shipmentLines[0];
        const shipmentIdForAwb = primaryShipment?.shipment_id || primaryShipment?.Shipment_id || primaryShipment?.order_id || shipmentId;
        const existingAwb = extractAwbNumber(primaryShipment) || '';
        const rapidShipmentId = primaryShipment?.shipment_id || primaryShipment?.Shipment_id || primaryShipment?.order_id || infoData?.order_id || shipmentIdForAwb;

        // Approve first
        const approveResponse = await fetch('https://api.rapidshyp.com/rapidshyp/apis/v1/approve_orders', { method: 'POST', headers: { 'rapidshyp-token': process.env.RAPIDSHYP_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id: [shipmentId], store_name: 'DEFAULT' }) });
        const approveText = await approveResponse.text();
        if (!approveResponse.ok) return res.status(400).json({ status: false, message: approveText || 'Failed to approve order' });

        let awb = existingAwb;
        if (!awb) {
            const assignResponse = await fetch('https://api.rapidshyp.com/rapidshyp/apis/v1/assign_awb', { method: 'POST', headers: { 'content-type': 'application/json', 'rapidshyp-token': process.env.RAPIDSHYP_TOKEN }, body: JSON.stringify({ shipment_id: shipmentIdForAwb, courier_code }) });
            const assignRaw = await assignResponse.text();
            let assignResult = null;
            try { assignResult = assignRaw ? JSON.parse(assignRaw) : null; } catch (err) { assignResult = null; }
            if (!assignResponse.ok) return res.status(400).json({ status: false, message: assignResult?.Message || assignResult?.message || assignResult?.error || assignRaw || 'Failed to assign AWB number', data: assignResult || assignRaw });

            awb = extractAwbNumber(assignResult);
            if (!awb) return res.status(502).json({ status: false, message: 'AWB number missing from assign_awb response', data: assignResult });
        }

        const scheduleResponse = await fetch('https://api.rapidshyp.com/rapidshyp/apis/v1/schedule_pickup', { method: 'POST', headers: { 'rapidshyp-token': process.env.RAPIDSHYP_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ shipment_id: shipmentIdForAwb, awb }) });
        const scheduleText = await scheduleResponse.text();
        let scheduleJson = null;
        try { scheduleJson = scheduleText ? JSON.parse(scheduleText) : null; } catch (err) { scheduleJson = null; }
        const scheduleStatusValue = typeof scheduleJson?.status === 'string' ? scheduleJson.status.toUpperCase() : scheduleJson?.status;
        const scheduleRemark = scheduleJson?.remark || scheduleJson?.remarks || '';
        const scheduleFailedPayload = scheduleStatusValue === false || scheduleStatusValue === 'FAILED' || (typeof scheduleRemark === 'string' && (scheduleRemark.toLowerCase().includes('special destination') || scheduleRemark.toLowerCase().includes('error')));
        if (!scheduleResponse.ok || scheduleFailedPayload) return res.status(400).json({ status: false, message: scheduleRemark || scheduleText || 'Failed to schedule pickup', data: scheduleJson || scheduleText || null });

        // Try to get label
        let labelUrl = null;
        try { const labelResp = await generateLabel(rapidShipmentId, awb); labelUrl = labelResp.labelUrl || null; } catch (err) { labelUrl = null; }

        if (!labelUrl) {
            const postInfoResp = await fetch(`https://api.rapidshyp.com/rapidshyp/apis/v1/get_orders_info?order_id=${encodeURIComponent(rapidShipmentId)}&channel_order_id=${encodeURIComponent(rapidShipmentId)}`, { method: 'GET', headers });
            const postInfoRaw = await postInfoResp.text();
            let postInfoData = null;
            try { postInfoData = postInfoRaw ? JSON.parse(postInfoRaw) : null; } catch (err) { postInfoData = null; }
            const postShipmentLines = Array.isArray(postInfoData?.shipment_lines) ? postInfoData.shipment_lines : [];
            const postPrimaryShipment = postShipmentLines[0] || postInfoData || {};
            labelUrl = extractLabelUrl(postPrimaryShipment);
        }

        const labelPending = !labelUrl;

        order.selectShippingCharges = Number(selectShippingCharges || 0);
        order.selectedCourierName = selectedCourierName;
        order.selectedFreightMode = selectedFreightMode;
        order.paymentMethod = paymentMethod || order.paymentMethod;
        order.awb_number = awb || order.awb_number;
        order.label_url = labelUrl || order.label_url;
        order.label_pending = labelPending;
        order.rapid_shipment_id = rapidShipmentId || order.rapid_shipment_id;

        await order.save();

        if (String(paymentMethod).toUpperCase() === 'PREPAID' && !labelPending) {
            const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : req.cookies?.sb_access_token;
            if (!token) return res.status(401).json({ status: false, message: 'No auth token' });

            const amount = Number(selectShippingCharges || 0);
            if (amount > 0) {
                const walletRes = await fetch(`${process.env.APP_BASE_URL}/wallet/spend`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ amount, description: `Order scheduling for orderId ${order.orderId}` }) });
                const walletData = await walletRes.json();
                if (!walletRes.ok) return res.status(400).json({ status: false, message: walletData?.message || 'Wallet debit failed', data: walletData });
            }
        }

        return res.status(200).json({ status: true, message: labelPending ? 'Order scheduled; label pending from courier' : 'Order scheduled successfully', data: order.toObject(), awb, labelUrl, labelPending });
    } catch (error) {
        console.error('Error scheduling order:', error);
        return res.status(500).json({ status: false, message: 'Failed to schedule order', error: error.message });
    }
});

// Fetch pickup location pincode
router.get('/fetchPickupLocationPicode', authMiddleware, async (req, res) => {
    try {
        const { addressName } = req.query;
        if (!addressName || typeof addressName !== 'string' || addressName.trim().length < 1) return res.status(400).json({ status: false, message: 'addressName query parameter is required and must be a non-empty string.' });
        const trimmed = addressName.trim();
        const pickup = await pickup_table.findOne({ address_name: trimmed }).select('address_name pincode user_id');
        if (!pickup) return res.status(404).json({ status: false, message: `Pickup location not found for address name: ${trimmed}` });
        return res.status(200).json({ status: true, message: 'Pickup location pincode fetched successfully', data: { addressName: pickup.address_name, pincode: pickup.pincode } });
    } catch (error) {
        console.error('Error in fetchPickupLocationPicode:', error);
        return res.status(500).json({ status: false, message: 'Internal server error while fetching pincode' });
    }
});

// Fetch all pickup addresses (names)
router.get('/fetchAllPickupAddress', authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        const userPincode = user?.pincode || null;
        let filter = {};
        if (userPincode) filter = { pincode: userPincode };
        else if (user?._id) filter = { user_id: user._id };
        else return res.status(400).json({ status: false, message: 'No pincode or user id available' });

        const addresses = await pickup_table.find(filter).select('address_name');
        return res.json({ status: true, message: 'Pickup address names fetched successfully', data: addresses.map((a) => a.address_name) });
    } catch (error) {
        console.error('Error in /fetchAllPickupAddress:', error);
        return res.status(500).json({ status: false, message: 'Internal server error' });
    }
});

router.get('/count-order', async (req, res) => {
    const count = await order_table.countDocuments();
    res.json({ status: true, data: count });
});

// Return stored label URL for an order
router.get('/orders/:orderId/label', authMiddleware, async (req, res) => {
    try {
        const { orderId } = req.params;
        const order = await order_table.findOne({ orderId });
        if (!order) return res.status(404).json({ status: false, message: 'Order not found' });
        if (order.label_url) return res.status(200).json({ status: true, labelUrl: order.label_url, labelPending: !!order.label_pending });
        return res.status(404).json({ status: false, message: 'Label not available', labelPending: !!order.label_pending });
    } catch (err) {
        console.error('Error fetching label:', err);
        return res.status(500).json({ status: false, message: 'Failed to fetch label' });
    }
});

// Refresh label
router.post('/orders/:orderId/refresh-label', authMiddleware, async (req, res) => {
    try {
        const { orderId } = req.params;
        let order = await order_table.findOne({ orderId });
        if (!order) return res.status(404).json({ status: false, message: 'Order not found' });

        if (!order.rapid_shipment_id || !order.awb_number) {
            const infoResp = await fetch(`https://api.rapidshyp.com/rapidshyp/apis/v1/get_orders_info?order_id=${encodeURIComponent(orderId)}&channel_order_id=${encodeURIComponent(orderId)}`);
            const infoRaw = await infoResp.text();
            let infoData = null; try { infoData = infoRaw ? JSON.parse(infoRaw) : null; } catch (e) { infoData = null; }
            const primary = Array.isArray(infoData?.shipment_lines) ? infoData.shipment_lines[0] : infoData || {};
            const rapidId = primary?.shipment_id || primary?.Shipment_id || primary?.order_id || infoData?.order_id || order.rapid_shipment_id || orderId;
            const awbFromInfo = extractAwbNumber(primary);
            order.rapid_shipment_id = rapidId;
            if (!order.awb_number && awbFromInfo) order.awb_number = awbFromInfo;
            await order.save();
        }

        let labelUrl = null;
        let awb = order.awb_number || null;
        const rapidId = order.rapid_shipment_id || orderId;

        try {
            const labelResp = await generateLabel(rapidId, order.awb_number);
            labelUrl = labelResp.labelUrl || null;
            if (!order.awb_number && labelResp.awb) awb = labelResp.awb;
        } catch (err) {
            labelUrl = null;
        }

        if (!labelUrl) {
            const infoResp = await fetch(`https://api.rapidshyp.com/rapidshyp/apis/v1/get_orders_info?order_id=${encodeURIComponent(rapidId)}&channel_order_id=${encodeURIComponent(rapidId)}`);
            const infoRaw = await infoResp.text();
            let infoData = null; try { infoData = infoRaw ? JSON.parse(infoRaw) : null; } catch (e) { infoData = null; }
            const primary = Array.isArray(infoData?.shipment_lines) ? infoData.shipment_lines[0] : infoData || {};
            labelUrl = extractLabelUrl(primary);
            awb = awb || extractAwbNumber(primary);
        }

        const labelPending = !labelUrl;
        if (labelUrl || awb) {
            order.label_url = labelUrl || order.label_url;
            order.awb_number = awb || order.awb_number;
            order.label_pending = labelPending;
            await order.save();
        }

        return res.status(labelUrl ? 200 : 404).json({ status: !!labelUrl, message: labelUrl ? 'Label refreshed' : 'Label still not available', labelUrl: labelUrl || null, awb: awb || null, labelPending });
    } catch (err) {
        console.error('refresh-label error:', err);
        return res.status(500).json({ status: false, message: 'Failed to refresh label' });
    }
});

// Schedule-order (generic)
router.post('/schedule-order', authMiddleware, async (req, res) => {
    const { shipment_id, awb } = req.body;
    if (!shipment_id) return res.status(400).json({ Status: false, Message: 'Shipment_id/Orderid must be provided' });
    try {
        const rapidResponse = await fetch('https://api.rapidshyp.com/rapidshyp/apis/v1/schedule_pickup', { method: 'POST', headers: { 'rapidshyp-token': process.env.RAPIDSHYP_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ shipment_id: shipment_id, awb: awb || '' }) });
        const result = await rapidResponse.text();
        if (!rapidResponse.ok) return res.status(400).json({ Message: result });
        return res.status(200).json({ status: 'Success', Message: result });
    } catch (error) {
        console.error(error);
        res.status(500).json({ Message: 'something went wrong' });
    }
});

// Approve orders
router.post('/approve-orders', async (req, res) => {
    const { shipment_id } = req.body;
    if (!shipment_id || shipment_id.length == 0) return res.status(400).json({ Message: 'shipment_id/order id must be provided' });
    try {
        const rapid_response = await fetch('https://api.rapidshyp.com/rapidshyp/apis/v1/approve_orders', { method: 'POST', headers: { 'rapidshyp-token': process.env.RAPIDSHYP_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id: shipment_id, store_name: 'DEFAULT' }) });
        const result = await rapid_response.text();
        if (!rapid_response.ok) return res.status(400).json({ Message: "Cant't Approve Orders", err: result });
        return res.status(200).json({ Status: 'Success', Meassage: result });
    } catch (error) {
        console.error(error);
        res.status(500).json({ Message: 'something went wrong', error: error });
    }
});

// Assign AWB
router.post('/assign_awb', async (req, res) => {
    const { shipment_id, courier_code } = req.body;
    if (!shipment_id) return res.status(400).json({ Message: 'Shipment id must be given!' });
    try {
        const response = await fetch('https://api.rapidshyp.com/rapidshyp/apis/v1/assign_awb', { method: 'POST', headers: { 'content-Type': 'application/json', 'rapidshyp-token': process.env.RAPIDSHYP_TOKEN }, body: JSON.stringify({ shipment_id: shipment_id, courier_code: courier_code || '' }) });
        const result = await response.json();
        res.send(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ Message: 'something went wrong' });
    }
});

module.exports = router;
