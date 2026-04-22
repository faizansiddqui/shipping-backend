// middleware/auth.js -- JWT-based auth
const { getUserFromToken } = require('../utils/jwt');

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const tokenFromHeader = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : null;

    const accessToken = (req.cookies && req.cookies.sb_access_token) || tokenFromHeader;
    if (!accessToken) {
      return res.status(401).json({ status: false, message: 'Unauthorized: no token' });
    }

    const user = await getUserFromToken(accessToken);
    if (!user) {
      return res.status(401).json({ status: false, message: 'Invalid or expired token' });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).json({ status: false, message: 'Auth middleware error' });
  }
};

module.exports = authMiddleware;
