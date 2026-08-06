const express = require('express');
const chrono = require('chrono-node');
const { DateTime } = require('luxon');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDb() {
    if (!process.env.DATABASE_URL) return;
    const query = `
        CREATE TABLE IF NOT EXISTS user_settings (
            user_id BIGINT PRIMARY KEY,
            timezone TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS reminders (
            id SERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL,
            chat_id BIGINT,
            text TEXT NOT NULL,
            remind_at TIMESTAMP WITH TIME ZONE NOT NULL,
            sent BOOLEAN DEFAULT FALSE
        );
    `;
    try {
        await pool.query(query);
        console.log('Database initialized successfully.');
    } catch (err) {
        console.error('Error initializing database:', err);
    }
}
initDb();

async function getUserTimezone(userId) {
    if (!process.env.DATABASE_URL) return null;
    try {
        const res = await pool.query('SELECT timezone FROM user_settings WHERE user_id = $1', [userId]);
        return res.rows.length > 0 ? res.rows[0].timezone : null;
    } catch (err) {
        console.error('Error fetching user timezone:', err);
        return null;
    }
}

function parseFlexibleDate(text, timeZone) {
    let clean = text.trim().toLowerCase().replace(/^reminder\s*/, '');
    const shorthandRegex = /^(\d+)\s*([mhd])$/i;
    const match = clean.match(shorthandRegex);
    if (match) {
        const num = match[1];
        const unitMap = { m: 'minute', h: 'hour', d: 'day' };
        clean = `in ${num} ${unitMap[match[2]]}`;
    } else if (/^\d+\s*(m|min|minute|minutes|h|hr|hour|hours|d|day|days)/i.test(clean)) {
        clean = `in ${clean}`;
    }

    const nowInZone = DateTime.now().setZone(timeZone).toJSDate();
    return chrono.parseDate(clean, nowInZone);
}

async function sendTelegramMessage(chatId, text) {
    const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: text })
        });
    } catch (err) {
        console.error('Error sending reminder message:', err);
    }
}

setInterval(async () => {
    if (!process.env.DATABASE_URL) return;
    try {
        const res = await pool.query('SELECT * FROM reminders WHERE remind_at <= NOW() AND sent = FALSE');
        for (const reminder of res.rows) {
            await sendTelegramMessage(reminder.chat_id || reminder.user_id, `⏰ **REMINDER:** ${reminder.text}`);
            await pool.query('UPDATE reminders SET sent = TRUE WHERE id = $1', [reminder.id]);
        }
    } catch (err) {
        console.error('Error checking scheduled reminders:', err);
    }
}, 10000);

app.post('/webhook', async (req, res) => {
    const message = req.body.message;
    const inlineQuery = req.body.inline_query;
    const chosenResult = req.body.chosen_inline_result;

    if (message && message.text) {
        const text = message.text.trim();
        const userId = message.from.id;
        const chatId = message.chat.id;

        if (text.startsWith('/tz') || text.startsWith('/start')) {
            const tzInput = text.replace(/\/tz|\/start/, '').trim();
            if (!tzInput) {
                await sendTelegramMessage(chatId, '⚙️ Please set your timezone so your reminders work accurately.\n\nExample: `/tz America/Chicago` or `/tz America/New_York`');
            } else {
                try {
                    const validTz = DateTime.now().setZone(tzInput).isValid;
                    if (validTz && process.env.DATABASE_URL) {
                        await pool.query(
                            'INSERT INTO user_settings (user_id, timezone) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET timezone = $2',
                            [userId, tzInput]
                        );
                        await sendTelegramMessage(chatId, `✅ Timezone saved as **${tzInput}**! You can now use inline reminders.`);
                    } else {
                        await sendTelegramMessage(chatId, '❌ Invalid timezone. Please use IANA format (e.g. `America/Chicago`, `America/New_York`, `America/Los_Angeles`).');
                    }
                } catch (e) {
                    await sendTelegramMessage(chatId, '❌ Invalid timezone string.');
                }
            }
        }
    }

    if (inlineQuery) {
        const userId = inlineQuery.from.id;
        const userTz = await getUserTimezone(userId);
        const queryId = inlineQuery.id;
        const queryText = inlineQuery.query.trim().toLowerCase();
        let results = [];

        if (!userTz) {
            // Force user to set timezone first
            results.push({
                type: 'article',
                id: 'set_tz_required',
                title: '⚠️ Setup Required: Set Your Timezone',
                description: 'Click to learn how to register your timezone first.',
                input_message_content: {
                    message_text: '⚠️ You must set your timezone before creating reminders! Open a direct message with the bot and send `/tz <Your_Timezone>` (e.g. `/tz America/Chicago`).'
                }
            });
        } else {
            if (!queryText || queryText === 'reminder') {
                const presets = [
                    { id: 'in_5m', title: '5 Minutes', time: 'in 5 minutes' },
                    { id: 'in_15m', title: '15 Minutes', time: 'in 15 minutes' },
                    { id: 'in_1h', title: '1 Hour', time: 'in 1 hour' },
                    { id: 'in_1d', title: '1 Day', time: 'in 1 day' }
                ];

                results = presets.map(p => {
                    const parsedDate = chrono.parseDate(p.time, new Date());
                    const dt = DateTime.fromJSDate(parsedDate).setZone(userTz);
                    return {
                        type: 'article',
                        id: `${p.id}:${parsedDate.getTime()}:Reminder`,
                        title: `Remind in ${p.title}`,
                        description: `Set reminder for ${dt.toFormat('ff')}`,
                        input_message_content: {
                            message_text: `🔔 Reminder set for ${p.title} (${dt.toFormat('ff')})`
                        }
                    };
                });
            } else {
                const parsedDate = parseFlexibleDate(queryText, userTz);
                if (parsedDate) {
                    const dt = DateTime.fromJSDate(parsedDate).setZone(userTz);
                    const resultText = `Parsed Time: ${dt.toFormat('ff')}`;
                    results.push({
                        type: 'article',
                        id: `custom:${parsedDate.getTime()}:${queryText}`,
                        title: 'Set Custom Reminder',
                        description: resultText,
                        input_message_content: {
                            message_text: `🔔 Reminder set for: ${queryText} (${dt.toFormat('ff')})`
                        }
                    });
                }
            }
        }

        try {
            await fetch(`https://api.telegram.org/bot${TOKEN}/answerInlineQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    inline_query_id: queryId,
                    results: results,
                    cache_time: 0
                })
            });
        } catch (err) {
            console.error('Error answering inline query:', err);
        }
    }

    if (chosenResult) {
        const userId = chosenResult.from.id;
        const resultId = chosenResult.result_id;
        const parts = resultId.split(':');

        if (parts.length >= 2 && parts[0] !== 'set_tz_required') {
            const timestamp = parseInt(parts[1], 10);
            const text = parts.slice(2).join(':') || 'Reminder';
            const remindAt = new Date(timestamp);

            if (process.env.DATABASE_URL) {
                try {
                    await pool.query(
                        'INSERT INTO reminders (user_id, text, remind_at) VALUES ($1, $2, $3)',
                        [userId, text, remindAt]
                    );
                    console.log(`Saved reminder for user ${userId} at ${remindAt.toISOString()}`);
                } catch (err) {
                    console.error('Error saving reminder to database:', err);
                }
            }
        }
    }

    res.sendStatus(200);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
