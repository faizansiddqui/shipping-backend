const { Sequelize } = require('sequelize');
require('dotenv').config();

const dbUrl = process.env.DATABASE_URL;
console.log('Using DATABASE_URL:', !!dbUrl);

const sequelize = new Sequelize(dbUrl, {
  dialect: 'postgres',
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false,
    },
  },
  logging: false,
});

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Test DB connected successfully');
    await sequelize.close();
  } catch (err) {
    console.error('❌ Test DB connection failed');
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  }
})();
