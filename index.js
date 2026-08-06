const express = require('express');
const chrono = require('chrono-node');
const { DateTime } = require('luxon');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TIMEZONE = 'America/Chicago';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDb() {
    if (!process.env.DATABASE_URL) return;
    const query = `
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

function parseFlexibleDate(text) {
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
    return chrono.parseDate(clean, new Date());
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
        const res = await pool.query(
            'SELECT * FROM reminders WHERE remind_at <= NOW() AND sent = FALSE'
        );
        for (const reminder of res.rows) {
            await sendTelegramMessage(reminder.chat_id || reminder.user_id, `⏰ **REMINDER:** ${reminder.text}`);
            await pool.query('UPDATE reminders SET sent = TRUE WHERE id = $1', [reminder.id]);
        }
    } catch (err) {
        console.error('Error checking scheduled reminders:', err);
    }
}, 10000);

app.post('/webhook', async (req, res) => {
    const inlineQuery = req.body.inline_query;
    const chosenResult = req.body.chosen_inline_result;

    if (inlineQuery) {
        const queryId = inlineQuery.id;
        const queryText = inlineQuery.query.trim().toLowerCase();
        let results = [];

        if (!queryText || queryText === 'reminder') {
            const presets = [
                { id: 'in_5m', title: '5 Minutes', time: 'in 5 minutes' },
                { id: 'in_15m', title: '15 Minutes', time: 'in 15 minutes' },
                { id: 'in_1h', title: '1 Hour', time: 'in 1 hour' },
                { id: 'in_1d', title: '1 Day', time: 'in 1 day' }
            ];

            results = presets.map(p => {
                const parsedDate = chrono.parseDate(p.time, new Date());
                const dt = DateTime.fromJSDate(parsedDate).setZone(TIMEZONE);
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
            const parsedDate = parseFlexibleDate(queryText);
            if (parsedDate) {
                const dt = DateTime.fromJSDate(parsedDate).setZone(TIMEZONE);
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

        if (parts.length >= 2) {
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
