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
    ssl: { rejectUnauthorized: false },
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
            recurring TEXT DEFAULT NULL,
            total_occurrences INT DEFAULT NULL,
            current_occurrence INT DEFAULT 0
        );
    `;
    try {
        await pool.query(query);
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

function formatRepeatText(rec) {
    if (!rec) return 'None';
    const [type, num] = rec.split(':');
    if (type === 'daily' || type === 'days') return num === '1' ? 'Daily' : `Every ${num} Days`;
    if (type === 'weekly' || type === 'weeks') return num === '1' ? 'Weekly' : `Every ${num} Weeks`;
    if (type === 'monthly' || type === 'months') return num === '1' ? 'Monthly' : `Every ${num} Months`;
    if (type === 'hourly' || type === 'hours') return num === '1' ? 'Hourly' : `Every ${num} Hours`;
    return `${type} ${num}`;
}

function calculateNextOccurrence(currentDate, recurringStr, timeZone) {
    let dt = DateTime.fromJSDate(currentDate).setZone(timeZone);
    const parts = recurringStr.split(':');
    const type = parts[0];
    const interval = parseInt(parts[1] || '1', 10);

    if (type === 'daily' || type === 'days') dt = dt.plus({ days: interval });
    else if (type === 'weekly' || type === 'weeks') dt = dt.plus({ weeks: interval });
    else if (type === 'monthly' || type === 'months') dt = dt.plus({ months: interval });
    else if (type === 'hourly' || type === 'hours') dt = dt.plus({ hours: interval });

    return dt.toJSDate();
}

function parseFlexibleDate(text, timeZone) {
    let clean = text.trim().replace(/^reminder\s*/i, '');
    const nowInZone = DateTime.now().setZone(timeZone);

    let wantRepeatMenu = false;
    if (/\brepeat\b$/i.test(clean)) {
        wantRepeatMenu = true;
        clean = clean.replace(/\brepeat\b$/i, '').trim();
    }

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

            if (dt <= nowInZone.plus({ seconds: 59 })) return null;
            return { date: dt.toJSDate(), reminderText: match[2].trim(), wantRepeatMenu };
        }
    }

    const parsed = chrono.parse(clean, nowInZone.toJSDate(), { forwardDate: true });
    if (parsed.length > 0) {
        const parsedDate = parsed[0].start.date();
        const dt = DateTime.fromJSDate(parsedDate);
        if (dt <= nowInZone.plus({ seconds: 59 })) return null;

        const reminderText = clean.replace(parsed[0].text, '').trim() || clean;
        return { date: parsedDate, reminderText: reminderText, wantRepeatMenu };
    }
    return null;
}

async function sendTelegramMessage(chatId, text, replyMarkup = null) {
    const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
    const payload = { chat_id: chatId, text: text };
    if (replyMarkup) payload.reply_markup = replyMarkup;

    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (err) {
        console.error('Error sending message:', err);
    }
}

async function editTelegramMessage(chatId, messageId, text, replyMarkup = null) {
    const url = `https://api.telegram.org/bot${TOKEN}/editMessageText`;
    const payload = { chat_id: chatId, message_id: messageId, text: text };
    if (replyMarkup) payload.reply_markup = replyMarkup;

    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
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
            const snippet = r.text.length > 15 ? r.text.substring(0, 15) + '...' : r.text;
            buttons.push([
                { text: `⏰ ${shortTime}${repeatTag} ${snippet}`, callback_data: `view:${r.id}` },
                { text: '✏️ Edit', callback_data: `edit:${r.id}` },
                { text: '❌ Delete', callback_data: `del:${r.id}` }
            ]);
        });
        return { inline_keyboard: buttons };
    } catch (err) {
        console.error('Error fetching reminders for keyboard:', err);
        return { inline_keyboard: [[{ text: '⚠️ Error loading reminders', callback_data: 'noop' }]] };
    }
}

function getEditMenuKeyboard(reminderId, currentRecurring, totalOccurrences) {
    const recType = formatRepeatText(currentRecurring);
    const limitLabel = totalOccurrences ? `${totalOccurrences}x` : 'Forever';

    return {
        inline_keyboard: [
            [
                { text: currentRecurring === null ? '✅ None' : 'None', callback_data: `setrec:${reminderId}:none` },
                { text: currentRecurring === 'daily:1' ? '✅ Daily' : 'Daily', callback_data: `setrec:${reminderId}:daily:1` }
            ],
            [
                { text: currentRecurring === 'weekly:1' ? '✅ Weekly' : 'Weekly', callback_data: `setrec:${reminderId}:weekly:1` },
                { text: currentRecurring === 'monthly:1' ? '✅ Monthly' : 'Monthly', callback_data: `setrec:${reminderId}:monthly:1` }
            ],
            [
                { text: `⚙️ Custom Interval (${recType})`, callback_data: `unitmenu:${reminderId}` },
                { text: `🔁 Repeat Limit (${limitLabel})`, callback_data: `limitmenu:${reminderId}` }
            ],
            [
                { text: '⬅️ Back to Reminders', callback_data: 'menu:list' }
            ]
        ]
    };
}

function getUnitMenuKeyboard(reminderId) {
    return {
        inline_keyboard: [
            [
                { text: '⏱️ Hours', callback_data: `nummenu:${reminderId}:hours` },
                { text: '📅 Days', callback_data: `nummenu:${reminderId}:days` }
            ],
            [
                { text: '🗓️ Weeks', callback_data: `nummenu:${reminderId}:weeks` },
                { text: '📆 Months', callback_data: `nummenu:${reminderId}:months` }
            ],
            [
                { text: '⬅️ Back to Edit', callback_data: `edit:${reminderId}` }
            ]
        ]
    };
}

function getNumberMenuKeyboard(reminderId, unit) {
    const nums = [2, 3, 4, 5, 6, 8, 10, 12, 14, 21, 30];
    let buttons = [];
    let row = [];

    nums.forEach((n, idx) => {
        row.push({ text: `${n}`, callback_data: `setrec:${reminderId}:${unit}:${n}` });
        if (row.length === 4 || idx === nums.length - 1) {
            buttons.push(row);
            row = [];
        }
    });

    buttons.push([{ text: '⬅️ Back to Units', callback_data: `unitmenu:${reminderId}` }]);
    return { inline_keyboard: buttons };
}

function getLimitMenuKeyboard(reminderId, totalOccurrences) {
    const current = totalOccurrences || 0;
    const limits = [0, 2, 3, 5, 10, 15, 20, 30, 50, 100];
    let buttons = [];
    let row = [];

    limits.forEach((val, idx) => {
        const label = val === 0 ? 'Forever' : `${val}x`;
        const activeTag = current === val ? `✅ ${label}` : label;
        row.push({ text: activeTag, callback_data: `setlimit:${reminderId}:${val}` });
        if (row.length === 3 || idx === limits.length - 1) {
            buttons.push(row);
            row = [];
        }
    });

    buttons.push([{ text: '⬅️ Back to Edit', callback_data: `edit:${reminderId}` }]);
    return { inline_keyboard: buttons };
}

setInterval(async () => {
    if (!process.env.DATABASE_URL) return;
    try {
        const res = await pool.query('SELECT * FROM reminders WHERE remind_at <= CURRENT_TIMESTAMP AND sent = FALSE');
        for (const reminder of res.rows) {
            const targetChat = reminder.chat_id || reminder.user_id;
            const newCount = (reminder.current_occurrence || 0) + 1;
            
            let countLabel = '';
            if (reminder.total_occurrences) {
                countLabel = ` (${newCount}/${reminder.total_occurrences})`;
            }
            
            await sendTelegramMessage(targetChat, `⏰ REMINDER${countLabel}: ${reminder.text}`);

            if (reminder.recurring && (!reminder.total_occurrences || newCount < reminder.total_occurrences)) {
                const userTz = await getUserTimezone(reminder.user_id);
                const nextDate = calculateNextOccurrence(new Date(reminder.remind_at), reminder.recurring, userTz);
                await pool.query('UPDATE reminders SET remind_at = $1, current_occurrence = $2 WHERE id = $3', [nextDate, newCount, reminder.id]);
            } else {
                await pool.query('UPDATE reminders SET sent = TRUE, current_occurrence = $1 WHERE id = $2', [newCount, reminder.id]);
            }
        }
    } catch (err) {
        console.error('Error checking scheduled reminders:', err);
    }
}, 1000);

app.post('/webhook', async (req, res) => {
    try {
        const callbackQuery = req.body.callback_query;
        const inlineQuery = req.body.inline_query;
        const chosenResult = req.body.chosen_inline_result;

        if (callbackQuery) {
            const userId = callbackQuery.from.id;
            const chatId = callbackQuery.message.chat.id;
            const messageId = callbackQuery.message.message_id;
            const data = callbackQuery.data;
            const userTz = await getUserTimezone(userId);

            if (data === 'noop') {
                await answerCallbackQuery(callbackQuery.id);
            } else if (data === 'menu:list') {
                await answerCallbackQuery(callbackQuery.id);
                const markup = await getRemindersKeyboard(userId, userTz);
                await editTelegramMessage(chatId, messageId, '📋 Your Active Reminders:\nTap View, Edit, or Delete.', markup);
            } else if (data.startsWith('del:')) {
                const reminderId = data.replace('del:', '');
                await pool.query('DELETE FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
                await answerCallbackQuery(callbackQuery.id, '🗑️ Reminder deleted!', true);
                const markup = await getRemindersKeyboard(userId, userTz);
                await editTelegramMessage(chatId, messageId, '📋 Your Active Reminders:\nTap View, Edit, or Delete.', markup);
            } else if (data.startsWith('view:')) {
                const reminderId = data.replace('view:', '');
                const result = await pool.query('SELECT text, remind_at, recurring, total_occurrences, current_occurrence FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
                if (result.rows.length > 0) {
                    const r = result.rows[0];
                    const dt = DateTime.fromJSDate(new Date(r.remind_at)).setZone(userTz);
                    const repeatInfo = `\n🔄 Repeat: ${formatRepeatText(r.recurring)}`;
                    const limitInfo = r.total_occurrences ? `\n🔢 Progress: ${r.current_occurrence || 0}/${r.total_occurrences}` : '';
                    await answerCallbackQuery(callbackQuery.id, `🔔 ${r.text}\n🕒 ${dt.toFormat('ff')}${repeatInfo}${limitInfo}`, true);
                }
            } else if (data.startsWith('edit:')) {
                const reminderId = data.replace('edit:', '');
                const result = await pool.query('SELECT text, recurring, total_occurrences FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
                if (result.rows.length > 0) {
                    await answerCallbackQuery(callbackQuery.id);
                    const r = result.rows[0];
                    const keyboard = getEditMenuKeyboard(reminderId, r.recurring, r.total_occurrences);
                    await editTelegramMessage(chatId, messageId, `✏️ Editing Reminder: "${r.text}"\nSelect options below:`, keyboard);
                }
            } else if (data.startsWith('unitmenu:')) {
                const reminderId = data.replace('unitmenu:', '');
                await answerCallbackQuery(callbackQuery.id);
                await editTelegramMessage(chatId, messageId, `⚙️ Select Custom Interval Unit:`, getUnitMenuKeyboard(reminderId));
            } else if (data.startsWith('nummenu:')) {
                const parts = data.split(':');
                const reminderId = parts[1];
                const unit = parts[2];
                await answerCallbackQuery(callbackQuery.id);
                await editTelegramMessage(chatId, messageId, `⚙️ Select Every How Many ${unit.toUpperCase()}:`, getNumberMenuKeyboard(reminderId, unit));
            } else if (data.startsWith('limitmenu:')) {
                const reminderId = data.replace('limitmenu:', '');
                const result = await pool.query('SELECT total_occurrences FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
                if (result.rows.length > 0) {
                    await answerCallbackQuery(callbackQuery.id);
                    const keyboard = getLimitMenuKeyboard(reminderId, result.rows[0].total_occurrences);
                    await editTelegramMessage(chatId, messageId, `🔁 Select How Many Times to Repeat:`, keyboard);
                }
            } else if (data.startsWith('setrec:')) {
                const parts = data.split(':');
                const reminderId = parts[1];
                const recType = parts[2];
                const interval = parts[3] || '1';
                const recurringVal = recType === 'none' ? null : `${recType}:${interval}`;

                await pool.query('UPDATE reminders SET recurring = $1 WHERE id = $2 AND user_id = $3', [recurringVal, reminderId, userId]);
                await answerCallbackQuery(callbackQuery.id, '✅ Recurrence updated!', true);

                const result = await pool.query('SELECT total_occurrences FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
                const totalOcc = result.rows.length > 0 ? result.rows[0].total_occurrences : null;
                const keyboard = getEditMenuKeyboard(reminderId, recurringVal, totalOcc);
                await editTelegramMessage(chatId, messageId, `✏️ Editing Reminder\nSelect options below:`, keyboard);
            } else if (data.startsWith('setlimit:')) {
                const parts = data.split(':');
                const reminderId = parts[1];
                const count = parseInt(parts[2], 10);
                const limitVal = count === 0 ? null : count;

                await pool.query('UPDATE reminders SET total_occurrences = $1 WHERE id = $2 AND user_id = $3', [limitVal, reminderId, userId]);
                await answerCallbackQuery(callbackQuery.id, '✅ Repeat limit updated!', true);

                const keyboard = getLimitMenuKeyboard(reminderId, limitVal);
                await editTelegramMessage(chatId, messageId, `🔁 Select How Many Times to Repeat:`, keyboard);
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
                    description: 'Tap to view and manage your active reminders.',
                    input_message_content: { message_text: '📋 Requesting active reminders list...' }
                });
            } else {
                const parsed = parseFlexibleDate(queryText, userTz);
                if (parsed) {
                    const dt = DateTime.fromJSDate(parsed.date).setZone(userTz);
                    const flag = parsed.wantRepeatMenu ? '1' : '0';
                    results.push({
                        type: 'article',
                        id: `custom:${parsed.date.getTime()}:${flag}:${parsed.reminderText}`,
                        title: `🔔 Remind: "${parsed.reminderText}"`,
                        description: `Scheduled for: ${dt.toFormat('ff')}`,
                        input_message_content: {
                            message_text: `🔔 Reminder set for: ${parsed.reminderText} (${dt.toFormat('ff')})`
                        }
                    });
                } else {
                    results.push({
                        type: 'article',
                        id: 'invalid_time',
                        title: '⚠️ Min 1 min ahead',
                        description: 'Time must be >= 1 min.',
                        input_message_content: { message_text: '❌ Reminders must be set for at least 1 minute from now.' }
                    });
                }
            }

            await fetch(`https://api.telegram.org/bot${TOKEN}/answerInlineQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inline_query_id: queryId, results: results, cache_time: 0 })
            });
        }

        if (chosenResult) {
            const userId = chosenResult.from.id;
            const resultId = chosenResult.result_id;
            const chatId = chosenResult.chat_id || userId;
            const parts = resultId.split(':');

            if (resultId === 'show_reminders_dm') {
                const userTz = await getUserTimezone(userId);
                const markup = await getRemindersKeyboard(userId, userTz);
                await sendTelegramMessage(userId, '📋 Your Active Reminders:\nTap View, Edit, or Delete.', markup);
            } else if (parts.length >= 2 && parts[0] !== 'invalid_time') {
                const timestamp = parseInt(parts[1], 10);
                const wantRepeat = parts[2] === '1';
                const text = parts.slice(3).join(':') || 'Reminder';
                const remindAt = new Date(timestamp);

                if (process.env.DATABASE_URL) {
                    const dbRes = await pool.query(
                        'INSERT INTO reminders (user_id, chat_id, text, remind_at) VALUES ($1, $2, $3, $4) RETURNING id',
                        [userId, chatId, text, remindAt]
                    );
                    if (wantRepeat) {
                        const newId = dbRes.rows[0].id;
                        const keyboard = getEditMenuKeyboard(newId, null, null);
                        await sendTelegramMessage(userId, `🔔 Reminder Created: "${text}"\nSet a repeat pattern below:`, keyboard);
                    }
                }
            }
        }
    } catch (globalErr) {
        console.error('Unhandled webhook execution error:', globalErr);
    }

    res.sendStatus(200);
});
