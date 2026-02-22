const express = require('express');
const passport = require('../config/passport');
const supabaseAdmin = require('../config/supabase'); // adjust path
const supabase = require('../config/supabase');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const isProd = process.env.NODE_ENV === "production";
const secureCookie = isProd || process.env.COOKIE_SECURE === "true";
const cookieOption = {
  httpOnly: true,
  secure: secureCookie,
  sameSite: secureCookie ? "none" : "lax",
  path: "/",
};

const clearAuthCookies = (res) => {
  // Clear using both secure/none and lax variants to cover local + prod
  res.clearCookie("sb_access_token", { ...cookieOption, maxAge: 0 });
  res.clearCookie("sb_refresh_token", { ...cookieOption, maxAge: 0 });
  res.clearCookie("sb_access_token", {
    ...cookieOption,
    secure: false,
    sameSite: "lax",
    maxAge: 0,
  });
  res.clearCookie("sb_refresh_token", {
    ...cookieOption,
    secure: false,
    sameSite: "lax",
    maxAge: 0,
  });
};

// Signup routes >>>
router.post("/signup", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  try {
    // Removed invalid userexist check; let Supabase signUp handle duplicates

    const { data, error } = await supabaseAdmin.auth.signUp({ email, password });

    if (error) {
      // Check for duplicate user error specifically
      if (error.message.includes('already registered') || error.message.includes('already exists')) {
        return res.status(400).json({ message: "User already exists" });
      }
      return res.status(400).json({ error: error.message });
    }

    // Handle response
    if (data.session) {
      const accessToken = data.session.access_token;
      const refreshToken = data.session.refresh_token;
      const expiresIn = data.session.expires_in ?? 900;

      res.cookie("sb_access_token", accessToken, {
        ...cookieOption,
        maxAge: expiresIn * 1000,
      });
      res.cookie("sb_refresh_token", refreshToken, {
        ...cookieOption,
        maxAge: 15 * 24 * 60 * 60 * 1000,
      });

      return res.json({ message: "Signup successful", user: data.user });
    }

    return res.status(200).json({
      status: "ok",
      message: "Signup successful — check your email for confirmation.",
      data,
    });
  } catch (err) {
    console.error("Unexpected error during signup:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Login Routes >>>>>
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });
  if (error) return res.status(400).json({ error: error.message });

  const accessToken = data.session?.access_token;
  const refreshToken = data.session?.refresh_token;
  const expiresIn = data.session?.expires_in ?? 900;

  if (!accessToken || !refreshToken) return res.status(500).json({ error: "No tokens returned" });

  res.cookie("sb_access_token", accessToken, { ...cookieOption, maxAge: expiresIn * 1000 });
  res.cookie("sb_refresh_token", refreshToken, { ...cookieOption, maxAge: 15 * 24 * 60 * 60 * 1000 });
  console.log('login sucessful');
  
  res.json({ message: "Login successful", user: data.user });
});


// Refresh Token Routes >>>
router.post("/refresh", async (req, res) => {
  const refreshToken = req.cookies.sb_refresh_token;
  if (!refreshToken) return res.status(401).json({ error: "No refresh token" });

  const { data, error } = await supabaseAdmin.auth.refreshSession({ refresh_token: refreshToken });
  if (error) return res.status(401).json({ error: error.message });

  const newAccessToken = data.session?.access_token;
  const newRefreshToken = data.session?.refresh_token;
  const expiresIn = data.session?.expires_in ?? 900;

  if (!newAccessToken) return res.status(500).json({ error: "No access token returned" });

  res.cookie("sb_access_token", newAccessToken, { ...cookieOption, maxAge: expiresIn * 1000 });
  if (newRefreshToken) {
    res.cookie("sb_refresh_token", newRefreshToken, { ...cookieOption, maxAge: 15 * 24 * 60 * 60 * 1000 });
  }
  res.json({ message: "Token refreshed", user: data.user });
});

// Profile Routes >>>
// GET /profile
router.get("/profile", authMiddleware, async (req, res) => {
  try {
    const token = req.cookies.sb_access_token;
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return res.status(401).json({ error: "Invalid token" });

    res.json({ user: { id: user.id, email: user.email, name: user.user_metadata?.name } });
  } catch (err) {
    res.status(401).json({ error: "Unauthorized" });
  }
});

// Add refresh endpoint for profile if needed (but use /refresh)
// POST /profile/refresh
router.post("/profile/refresh", async (req, res) => {
  try {
    const refreshToken = req.cookies.sb_refresh_token;
    if (!refreshToken) return res.status(401).json({ error: "No refresh token" });

    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) return res.status(401).json({ error: "Refresh failed" });

    const { access_token, refresh_token, user } = data.session;

    // Set new cookies
    // res.cookie('sb_access_token', access_token, { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production' });
    // res.cookie('sb_refresh_token', refresh_token, { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production', maxAge: 60*60*24*15 });
    res.cookie('sb_access_token', access_token, { ...cookieOption });
res.cookie('sb_refresh_token', refresh_token, {
  ...cookieOption,
  maxAge: 60 * 60 * 24 * 15 * 1000
});


    res.json({ user: { id: user.id, email: user.email, name: user.user_metadata?.name } });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// Login With Google Routes >>>
router.get("/auth/google", passport.authenticate("google", {
  scope: ["openid", "profile", "email"],
  accessType: "offline",
  prompt: "consent"
}));

router.get("/auth/google/callback", passport.authenticate("google", {
  failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=auth_failed`
}), async (req, res) => {
  try {
    if (!req.user?.idToken) {
      console.error("No idToken from Google");
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=no_token`);
    }

    const { data, error } = await supabaseAdmin.auth.signInWithIdToken({
      provider: "google",
      token: req.user.idToken,
    });

    if (error) {
      console.error("Supabase Google signin error:", error);
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=auth_failed`);
    }

    const accessToken = data.session?.access_token;
    const refreshToken = data.session?.refresh_token;
    const expiresIn = data.session?.expires_in ?? 900;

    if (!accessToken || !refreshToken) {
      console.error("No tokens from Supabase");
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=no_tokens`);
    }

    res.cookie("sb_access_token", accessToken, { ...cookieOption, maxAge: expiresIn * 1000 });
    res.cookie("sb_refresh_token", refreshToken, { ...cookieOption, maxAge: 15 * 24 * 60 * 60 * 1000 });

    const redirectTo = process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/` : 'http://localhost:3000/';
    res.redirect(redirectTo);
  } catch (err) {
    console.error("Google callback error:", err);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=server_error`);
  }
});

// Logout Routes >>>
router.post("/logout", (req, res) => {
  clearAuthCookies(res);
  res.json({ message: "Logged out" });
});



module.exports = router;
