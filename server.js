const dotenv = require('dotenv');
const cors = require('cors');
const { app } = require('./app');
const passportConfig = require('./config/passport'); 
const authRoutes = require('./routes/authRoutes');
const orderRoutes = require('./routes/orderRoutes');
const createOrder = require('./routes/createOrder');
const wallet = require('./routes/wallet')

dotenv.config();

const PORT = process.env.PORT || 5000;

if (!process.env.MONGO_URI || !process.env.JWT_SECRET) {
  console.warn('Warning: MONGO_URI or JWT_SECRET not set. Ensure environment variables are provided for MongoDB and JWT.');
}

app.use(cors({
  origin: [process.env.FRONTEND_URL,"http://localhost:3000"],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
  optionsSuccessStatus: 200 // Some legacy browsers/proxies need this
}));

// Initialize passport (configured in config/passport.js)
app.use(passportConfig.initialize());

// Routes
app.use(authRoutes); // Auth routes (no prefix)
app.use(orderRoutes); // Order routes (no prefix)
app.use(createOrder);
app.use(wallet)  //wallet logics



// Home Routes >>>
app.get("/", (req, res) => {
  res.send("Welcome user");
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on PORT: ${PORT}`);
});