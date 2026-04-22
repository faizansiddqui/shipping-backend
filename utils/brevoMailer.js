const axios = require('axios');

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER = process.env.BREVO_SENDER || process.env.BREVO_SENDER_EMAIL || '';

function parseSender(sender) {
    if (!sender) return { name: 'No Reply', email: 'no-reply@example.com' };
    const m = sender.match(/(.*)<(.*)>/);
    if (m) {
        const name = m[1].trim().replace(/^"|"$/g, '') || undefined;
        const email = m[2].trim();
        return { name: name || email, email };
    }
    if (sender.includes('@')) return { name: sender, email: sender };
    return { name: sender, email: 'no-reply@example.com' };
}

async function sendMail({ to, subject, html, text }) {
    if (!BREVO_API_KEY) throw new Error('BREVO_API_KEY not configured');

    const sender = parseSender(BREVO_SENDER);

    const toArray = Array.isArray(to) ? to.map((e) => ({ email: e })) : [{ email: to }];

    const payload = {
        sender: { name: sender.name, email: sender.email },
        to: toArray,
        subject: subject || '(no subject)',
    };

    if (html) payload.htmlContent = html;
    if (text) payload.textContent = text;

    const res = await axios.post('https://api.brevo.com/v3/smtp/email', payload, {
        headers: {
            'api-key': BREVO_API_KEY,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        timeout: 10000,
    });

    return res.data;
}

module.exports = { sendMail, parseSender };
