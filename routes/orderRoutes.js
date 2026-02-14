const calculateShippingPrice = require('../rapidShyp/calculateRate');
const getZone = require('../rapidShyp/selectZone');

const { router } = require('../app')

router.post("/order", async (req, res) => {
  const { Pickup_pincode, Delivery_pincode, cod, total_order_value, weight } = req.body;

  try {
    const avail_services = await fetch("https://api.rapidshyp.com/rapidshyp/apis/v1/serviceabilty_check", {
      method: "POST",
      headers: {
        "rapidshyp-token": "4f542cb1ee499eba09448bd8b5bf6150aa05b85e88136a15ef7b73c4315132fd",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        Pickup_pincode,
        Delivery_pincode,
        cod,
        total_order_value: parseInt(total_order_value),
        weight
      })
    });

    const data = await avail_services.json();
    const zone = getZone(Pickup_pincode, Delivery_pincode);

    // const result = await calculateShippingPrice(data.serviceable_courier_list, zone, weight, parseInt(total_order_value), cod);
    data['zone'] = zone
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: "Something went wrong: " + error.message });
  }
});

module.exports = router;