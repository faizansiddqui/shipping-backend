(async () => {
  try {
    const base = 'http://localhost:5000';
    const signupResp = await fetch(base + '/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `test+${Date.now()}@example.com`, password: 'Password123!', name: 'Test User' })
    });
    const signupJson = await signupResp.json().catch(() => null);
    console.log('SIGNUP', signupResp.status, signupJson);

    process.exit(0);
  } catch (err) {
    console.error('Test auth error:', err);
    process.exit(1);
  }
})();
