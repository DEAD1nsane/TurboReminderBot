const express = require('express');
const chrono = require('chrono-node');
const { DateTime } = require('luxon');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    keepAlive: true
});

pool.on('error', (err) => {
    console.error('Unexpected Postgres pool error:', err);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
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
            sent BOOLEAN DEFAULT FALSE,
            recurring TEXT DEFAULT NULL
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

app.get('/', (req, res) => {
    res.status(200).send('OK');
});

async function getUserTimezone(userId) {
    if (!process.env.DATABASE_URL) return 'UTC';
    try {
        const res = await pool.query('SELECT timezone FROM user_settings WHERE user_id = $1', [userId]);
        return res.rows.length > 0 ? res.rows[0].timezone : 'UTC';
    } catch (err) {
        console.error('Error fetching user timezone:', err);
        return 'UTC';
    }
}

function parseRecurringPattern(text) {
    const lower = text.toLowerCase();
    if (/\bevery\s+day\b|\bdaily\b/.test(lower)) return { type: 'daily', interval: 1 };
    if (/\bevery\s+week\b|\bweekly\b/.test(lower)) return { type: 'weekly', interval: 1 };
    if (/\bevery\s+month\b|\bmonthly\b/.test(lower)) return { type: 'monthly', interval: 1 };
    
    const dayMatch = lower.match(/\bevery\s+(\d+)\s+days?\b/);
    if (dayMatch) return { type: 'daily', interval: parseInt(dayMatch[1], 10) };

    const hourMatch = lower.match(/\bevery\s+(\d+)\s+hours?\b/);
    if (hourMatch) return { type: 'hourly', interval: parseInt(hourMatch[1], 10) };

    return null;
}

function calculateNextOccurrence(currentDate, recurringStr, timeZone) {
    let dt = DateTime.fromJSDate(currentDate).setZone(timeZone);
    const parts = recurringStr.split(':');
    const type = parts[0];
    const interval = parseInt(parts[1] || '1', 10);

    if (type === 'daily') dt = dt.plus({ days: interval });
    else if (type === 'weekly') dt = dt.plus({ weeks: interval });
    else if (type === 'monthly') dt = dt.plus({ months: interval });
    else if (type === 'hourly') dt = dt.plus({ hours: interval });

    return dt.toJSDate();
}

function parseFlexibleDate(text, timeZone) {
    let clean = text.trim().replace(/^reminder\s*/i, '');
    const nowInZone = DateTime.now().setZone(timeZone);

    const compoundRegex = /^((?:\d+d)?\s*(?:\d+h)?\s*(?:\d+m)?\s*(?:\d+s)?)\s+(.+)$/i;
    const match = clean.match(compoundRegex);

    if (match && match[1].trim().length > 0) {
        const timePart = match[1];
        const days = (timePart.match(/(\d+)d/i) || [])[1] ? parseInt(RegExp.$1, 10) : 0;
        const hours = (timePart.match(/(\d+)h/i) || [])[1] ? parseInt(RegExp.$1, 10) : 0;
        const minutes = (timePart.match(/(\d+)m/i) || [])[1] ? parseInt(RegExp.$1, 10) : 0;
        const seconds = (timePart.match(/(\d+)s/i) || [])[1] ? parseInt(RegExp.$1, 10) : 0;

        if (days > 0 || hours > 0 || minutes > 0 || seconds > 0) {
            let dt = nowInZone;
            if (days) dt = dt.plus({ days });
            if (hours) dt = dt.plus({ hours });
            if (minutes) dt = dt.plus({ minutes });
            if (seconds) dt = dt.plus({ seconds });

            if (dt <= nowInZone.plus({ seconds: 59 })) {
                return null;
            }
            return dt.toJSDate();
        }
    }

    const timeOnlyRegex = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
    const timeMatch = clean.match(timeOnlyRegex);
    if (timeMatch && timeMatch[3]) {
        let hour = parseInt(timeMatch[1], 10);
        const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
        const meridiem = timeMatch[3].toLowerCase();

        if (meridiem === 'pm' && hour < 12) hour += 12;
        if (meridiem === 'am' && hour === 12) hour = 0;

        let dt = nowInZone.set({ hour, minute, second: 0, millisecond: 0 });
        if (dt <= nowInZone) {
            dt = dt.plus({ days: 1 });
        }
        return dt.toJSDate();
    }

    const parsed = chrono.parseDate(clean, nowInZone.toJSDate(), { forwardDate: true });
    if (parsed) {
        const dt = DateTime.fromJSDate(parsed);
        if (dt <= nowInZone.plus({ seconds: 59 })) {
            return null;
        }
    }
    return parsed;
}

async function sendTelegramMessage(chatId, text, replyMarkup = null) {
    const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
    const payload = { chat_id: chatId, text: text };
    if (replyMarkup) payload.reply_markup = replyMarkup;

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!data.ok) console.error('Telegram sendMessage error:', data);
    } catch (err) {
        console.error('Error sending reminder message:', err);
    }
}

async function editTelegramMessage(chatId, messageId, text, replyMarkup = null) {
    const url = `https://api.telegram.org/bot${TOKEN}/editMessageText`;
    const payload = { chat_id: chatId, message_id: messageId, text: text };
    if (replyMarkup) payload.reply_markup = replyMarkup;

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!data.ok) console.error('Telegram editMessageText error:', data);
    } catch (err) {
        console.error('Error editing message:', err);
    }
}

async function answerCallbackQuery(callbackQueryId, text = '', showAlert = false) {
    const url = `https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackQueryId, text: text, show_alert: showAlert })
        });
    } catch (err) {
        console.error('Error answering callback query:', err);
    }
}

function getRegionMenuKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '🌎 North America', callback_data: 'menu:na' },
                { text: '🌍 Europe', callback_data: 'menu:eu' }
            ],
            [
                { text: '🌏 Asia', callback_data: 'menu:asia' },
                { text: '🌍 Africa', callback_data: 'menu:af' }
            ],
            [
                { text: '🌎 South America', callback_data: 'menu:sa' },
                { text: '🌏 Oceania / Australia', callback_data: 'menu:oc' }
            ],
            [
                { text: '🌐 UTC', callback_data: 'settz:UTC' }
            ]
        ]
    };
}

function getSubMenuKeyboard(region) {
    let buttons = [];
    if (region === 'na') {
        buttons = [
            [{ text: '🇺🇸 US Eastern', callback_data: 'settz:America/New_York' }, { text: '🇺🇸 US Central', callback_data: 'settz:America/Chicago' }],
            [{ text: '🇺🇸 US Mountain', callback_data: 'settz:America/Denver' }, { text: '🇺🇸 US Pacific', callback_data: 'settz:America/Los_Angeles' }],
            [{ text: '🇺🇸 Alaska', callback_data: 'settz:America/Anchorage' }, { text: '🇺🇸 US Hawaii', callback_data: 'settz:Pacific/Honolulu' }],
            [{ text: '🇨🇦 Canada Eastern', callback_data: 'settz:America/Toronto' }, { text: '🇨🇦 Canada Pacific', callback_data: 'settz:America/Vancouver' }],
            [{ text: '🇲🇽 Mexico City', callback_data: 'settz:America/Mexico_City' }]
        ];
    } else if (region === 'eu') {
        buttons = [
            [{ text: '🇬🇧 London (GMT/BST)', callback_data: 'settz:Europe/London' }, { text: '🇫🇷 Paris (CET)', callback_data: 'settz:Europe/Paris' }],
            [{ text: '🇩🇪 Berlin (CET)', callback_data: 'settz:Europe/Berlin' }, { text: '🇪🇸 Madrid (CET)', callback_data: 'settz:Europe/Madrid' }],
            [{ text: '🇬🇷 Athens (EET)', callback_data: 'settz:Europe/Athens' }, { text: '🇹🇷 Istanbul', callback_data: 'settz:Europe/Istanbul' }],
            [{ text: '🇺🇦 Kyiv (EET)', callback_data: 'settz:Europe/Kyiv' }]
        ];
    } else if (region === 'asia') {
        buttons = [
            [{ text: '🇮🇳 India (IST)', callback_data: 'settz:Asia/Kolkata' }, { text: '🇯🇵 Tokyo (JST)', callback_data: 'settz:Asia/Tokyo' }],
            [{ text: '🇨🇳 Shanghai / Beijing', callback_data: 'settz:Asia/Shanghai' }, { text: '🇸🇬 Singapore / HK', callback_data: 'settz:Asia/Singapore' }],
            [{ text: '🇦🇪 Dubai (GST)', callback_data: 'settz:Asia/Dubai' }, { text: '🇮🇩 Jakarta (WIB)', callback_data: 'settz:Asia/Jakarta' }],
            [{ text: '🇵🇰 Karachi (PKT)', callback_data: 'settz:Asia/Karachi' }, { text: '🇵🇭 Manila (PST)', callback_data: 'settz:Asia/Manila' }]
        ];
    } else if (region === 'af') {
        buttons = [
            [{ text: '🇪🇬 Cairo (EET)', callback_data: 'settz:Africa/Cairo' }, { text: '🇿🇦 Johannesburg', callback_data: 'settz:Africa/Johannesburg' }],
            [{ text: '🇳🇬 Lagos (WAT)', callback_data: 'settz:Africa/Lagos' }, { text: '🇰🇪 Nairobi (EAT)', callback_data: 'settz:Africa/Nairobi' }],
            [{ text: '🇲🇦 Casablanca', callback_data: 'settz:Africa/Casablanca' }]
        ];
    } else if (region === 'sa') {
        buttons = [
            [{ text: '🇧🇷 São Paulo', callback_data: 'settz:America/Sao_Paulo' }, { text: '🇦🇷 Buenos Aires', callback_data: 'settz:America/Argentina/Buenos_Aires' }],
            [{ text: '🇨🇱 Santiago', callback_data: 'settz:America/Santiago' }, { text: '🇨🇴 Bogotá', callback_data: 'settz:America/Bogota' }]
        ];
    } else if (region === 'oc') {
        buttons = [
            [{ text: '🇦🇺 Sydney / Melb', callback_data: 'settz:Australia/Sydney' }, { text: '🇦🇺 Brisbane', callback_data: 'settz:Australia/Brisbane' }],
            [{ text: '🇦🇺 Perth', callback_data: 'settz:Australia/Perth' }, { text: '🇳🇿 Auckland', callback_data: 'settz:Pacific/Auckland' }]
        ];
    }
    buttons.push([{ text: '⬅️ Back to Regions', callback_data: 'menu:main' }]);
    return { inline_keyboard: buttons };
}

async function getRemindersKeyboard(userId, userTz) {
    try {
        const res = await pool.query('SELECT id, text, remind_at, recurring FROM reminders WHERE user_id = $1 AND sent = FALSE ORDER BY remind_at ASC', [userId]);
        if (res.rows.length === 0) {
            return { inline_keyboard: [[{ text: '📭 No active reminders found', callback_data: 'noop' }]] };
        }

        let buttons = [];
        res.rows.forEach(r => {
            const dt = DateTime.fromJSDate(new Date(r.remind_at)).setZone(userTz);
            const shortTime = dt.toFormat('MM/dd HH:mm');
            const repeatTag = r.recurring ? ' 🔄' : '';
            const snippet = r.text.length > 18 ? r.text.substring(0, 18) + '...' : r.text;
            buttons.push([
                { text: `⏰ ${shortTime}${repeatTag} - ${snippet}`, callback_data: `view:${r.id}` },
                { text: '❌ Delete', callback_data: `del:${r.id}` }
            ]);
        });
        return { inline_keyboard: buttons };
    } catch (err) {
        console.error('Error fetching reminders for keyboard:', err);
        return { inline_keyboard: [[{ text: '⚠️ Error loading reminders', callback_data: 'noop' }]] };
    }
}

setInterval(async () => {
    if (!process.env.DATABASE_URL) return;
    try {
        const res = await pool.query('SELECT * FROM reminders WHERE remind_at <= CURRENT_TIMESTAMP AND sent = FALSE');
        for (const reminder of res.rows) {
            const targetChat = reminder.chat_id || reminder.user_id;
            await sendTelegramMessage(targetChat, `⏰ REMINDER: ${reminder.text}`);

            if (reminder.recurring) {
                const userTz = await getUserTimezone(reminder.user_id);
                const nextDate = calculateNextOccurrence(new Date(reminder.remind_at), reminder.recurring, userTz);
                await pool.query('UPDATE reminders SET remind_at = $1 WHERE id = $2', [nextDate, reminder.id]);
            } else {
                await pool.query('UPDATE reminders SET sent = TRUE WHERE id = $1', [reminder.id]);
            }
        }
    } catch (err) {
        console.error('Error checking scheduled reminders:', err);
    }
}, 1000);

app.post('/webhook', async (req, res) => {
    try {
        const message = req.body.message;
        const inlineQuery = req.body.inline_query;
        const chosenResult = req.body.chosen_inline_result;
        const callbackQuery = req.body.callback_query;

        if (message && message.text) {
            const text = message.text.trim();
            const userId = message.from.id;
            const chatId = message.chat.id;
            const userTz = await getUserTimezone(userId);

            if (text.startsWith('/reminders') || text.startsWith('/list')) {
                const markup = await getRemindersKeyboard(userId, userTz);
                const countRes = await pool.query('SELECT COUNT(*) FROM reminders WHERE user_id = $1 AND sent = FALSE', [userId]);
                const count = parseInt(countRes.rows[0].count, 10);
                if (count === 0) {
                    await sendTelegramMessage(chatId, '📭 You have no active reminders.');
                } else {
                    await sendTelegramMessage(chatId, '📋 Your Active Reminders:\nTap a reminder to view details or delete it.', markup);
                }
            } else if (text.startsWith('/tz') || text.startsWith('/start')) {
                const tzInput = text.replace(/\/tz|\/start/, '').trim();
                if (!tzInput || tzInput === 'tz') {
                    await sendTelegramMessage(chatId, '⚙️ Select your region below, or type /tz Continent/City (e.g. /tz Europe/London):', getRegionMenuKeyboard());
                } else {
                    const validTz = DateTime.now().setZone(tzInput).isValid;
                    if (validTz && process.env.DATABASE_URL) {
                        try {
                            await pool.query(
                                'INSERT INTO user_settings (user_id, timezone) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET timezone = $2',
                                [userId, tzInput]
                            );
                            await sendTelegramMessage(chatId, `✅ Timezone saved as ${tzInput}! You can now use inline reminders.`);
                        } catch (err) {
                            console.error('Error setting timezone via text:', err);
                        }
                    } else {
                        await sendTelegramMessage(chatId, '❌ Invalid timezone. Select a region below or search using /tz Continent/City (e.g. /tz Asia/Tokyo).', getRegionMenuKeyboard());
                    }
                }
            }
        }

        if (callbackQuery) {
            const userId = callbackQuery.from.id;
            const chatId = callbackQuery.message.chat.id;
            const messageId = callbackQuery.message.message_id;
            const data = callbackQuery.data;
            const userTz = await getUserTimezone(userId);

            if (data === 'noop') {
                await answerCallbackQuery(callbackQuery.id);
            } else if (data.startsWith('del:')) {
                const reminderId = data.replace('del:', '');
                try {
                    await pool.query('DELETE FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
                    await answerCallbackQuery(callbackQuery.id, '🗑️ Reminder deleted!', true);
                    const markup = await getRemindersKeyboard(userId, userTz);
                    const countRes = await pool.query('SELECT COUNT(*) FROM reminders WHERE user_id = $1 AND sent = FALSE', [userId]);
                    const count = parseInt(countRes.rows[0].count, 10);
                    if (count === 0) {
                        await editTelegramMessage(chatId, messageId, '📭 You have no active reminders.');
                    } else {
                        await editTelegramMessage(chatId, messageId, '📋 Your Active Reminders:\nTap a reminder to view details or delete it.', markup);
                    }
                } catch (err) {
                    console.error('Error deleting reminder:', err);
                    await answerCallbackQuery(callbackQuery.id, '❌ Failed to delete reminder.', true);
                }
            } else if (data.startsWith('view:')) {
                const reminderId = data.replace('view:', '');
                try {
                    const result = await pool.query('SELECT text, remind_at, recurring FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
                    if (result.rows.length > 0) {
                        const r = result.rows[0];
                        const dt = DateTime.fromJSDate(new Date(r.remind_at)).setZone(userTz);
                        const repeatInfo = r.recurring ? `\n🔄 Repeat: ${r.recurring}` : '';
                        await answerCallbackQuery(callbackQuery.id, `🔔 ${r.text}\n🕒 ${dt.toFormat('ff')}${repeatInfo}`, true);
                    } else {
                        await answerCallbackQuery(callbackQuery.id, '⚠️ Reminder not found or already sent.', true);
                    }
                } catch (err) {
                    console.error('Error viewing reminder:', err);
                    await answerCallbackQuery(callbackQuery.id, '❌ Error fetching reminder details.', true);
                }
            } else if (data.startsWith('menu:')) {
                await answerCallbackQuery(callbackQuery.id);
                const region = data.replace('menu:', '');
                if (region === 'main') {
                    await editTelegramMessage(chatId, messageId, '⚙️ Select your region below, or type /tz Continent/City:', getRegionMenuKeyboard());
                } else {
                    await editTelegramMessage(chatId, messageId, '📍 Select your timezone:', getSubMenuKeyboard(region));
                }
            } else if (data.startsWith('settz:')) {
                await answerCallbackQuery(callbackQuery.id);
                const tz = data.replace('settz:', '');
                if (process.env.DATABASE_URL) {
                    try {
                        await pool.query(
                            'INSERT INTO user_settings (user_id, timezone) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET timezone = $2',
                            [userId, tz]
                        );
                        await editTelegramMessage(chatId, messageId, `✅ Timezone saved as ${tz}! You can now use inline reminders.`);
                    } catch (err) {
                        console.error('Error saving user timezone via callback:', err);
                        await sendTelegramMessage(chatId, `⚠️ Could not save timezone right now. Please try again.`);
                    }
                }
            }
        }

        if (inlineQuery) {
            const userId = inlineQuery.from.id;
            const userTz = await getUserTimezone(userId);
            const queryId = inlineQuery.id;
            const queryText = inlineQuery.query.trim();
            let results = [];

            if (queryText.toLowerCase() === 'list' || queryText.toLowerCase() === 'reminders' || queryText === '') {
                results.push({
                    type: 'article',
                    id: 'show_reminders_dm',
                    title: '📋 Send Active Reminders (DM)',
                    description: 'Tap to receive a private message listing your reminders with delete options.',
                    input_message_content: {
                        message_text: '📋 Requesting active reminders list...'
                    }
                });
            } else {
                const recurringData = parseRecurringPattern(queryText);
                let cleanQueryText = queryText;
                let recurringTag = '';

                if (recurringData) {
                    recurringTag = `${recurringData.type}:${recurringData.interval}`;
                    cleanQueryText = queryText.replace(/\b(every\s+(day|week|month|\d+\s+days?|\d+\s+hours?)|daily|weekly|monthly)\b/gi, '').trim();
                }

                const parsedDate = parseFlexibleDate(cleanQueryText, userTz) || parseFlexibleDate(queryText, userTz);
                if (parsedDate) {
                    const dt = DateTime.fromJSDate(parsedDate).setZone(userTz);
                    const repeatLabel = recurringData ? ` (Repeat: ${recurringData.type})` : '';
                    results.push({
                        type: 'article',
                        id: `custom:${parsedDate.getTime()}:${recurringTag}:${cleanQueryText}`,
                        title: `🔔 Remind: "${cleanQueryText}"${repeatLabel}`,
                        description: `Scheduled for: ${dt.toFormat('ff')}`,
                        input_message_content: {
                            message_text: `🔔 Reminder set for: ${cleanQueryText} (${dt.toFormat('ff')})${repeatLabel}`
                        }
                    });
                } else {
                    results.push({
                        type: 'article',
                        id: 'invalid_time',
                        title: '⚠️ Min 1 min ahead',
                        description: 'Time must be >= 1 min.',
                        input_message_content: {
                            message_text: '❌ Reminders must be set for at least 1 minute from now.'
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
            const chatId = chosenResult.chat_id || userId;
            const parts = resultId.split(':');

            if (resultId === 'show_reminders_dm') {
                const userTz = await getUserTimezone(userId);
                const countRes = await pool.query('SELECT COUNT(*) FROM reminders WHERE user_id = $1 AND sent = FALSE', [userId]);
                const count = parseInt(countRes.rows[0].count, 10);
                if (count === 0) {
                    await sendTelegramMessage(userId, '📭 You have no active reminders.');
                } else {
                    const markup = await getRemindersKeyboard(userId, userTz);
                    await sendTelegramMessage(userId, '📋 Your Active Reminders:\nTap a reminder to view details or delete it.', markup);
                }
            } else if (parts.length >= 2 && parts[0] !== 'set_tz_required' && parts[0] !== 'invalid_time') {
                const timestamp = parseInt(parts[1], 10);
                const recurringTag = parts[2] || null;
                const text = parts.slice(3).join(':') || 'Reminder';
                const remindAt = new Date(timestamp);

                if (process.env.DATABASE_URL) {
                    try {
                        await pool.query(
                            'INSERT INTO reminders (user_id, chat_id, text, remind_at, recurring) VALUES ($1, $2, $3, $4, $5)',
                            [userId, chatId, text, remindAt, recurringTag || null]
                        );
                    } catch (err) {
                        console.error('Error saving reminder to database:', err);
                    }
                }
            }
        }
    } catch (globalErr) {
        console.error('Unhandled webhook execution error:', globalErr);
    }

    res.sendStatus(200);
});
