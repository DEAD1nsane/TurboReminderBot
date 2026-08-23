const chrono = require('chrono-node');
const crypto = require('crypto');
const pendingInlineEdits = new Set();
const inlineQueryCache = new Map();
const express = require('express');
const { Pool } = require('pg');
const { DateTime } = require('luxon');
const {
    formatRepeatText,
    getTimezonePickerKeyboard,
    getEditMenuKeyboard,
    getUnitMenuKeyboard,
    getNumberMenuKeyboard,
    getLimitMenuKeyboard,
    getDowMenuKeyboard
} = require('./keyboards');
const {
    sendTelegramMessage,
    editTelegramMessage,
    deleteTelegramMessage,
    answerCallbackQuery,
    fetchWithTimeout
} = require('./telegram');

const activityTimers = new Map();
function resetMenuTimer(key, action) {
    if (activityTimers.has(key)) clearTimeout(activityTimers.get(key));
    activityTimers.set(key, setTimeout(() => {
        activityTimers.delete(key);
        action();
    }, 30000));
}

const escapeHTML = str => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_ID = process.env.OWNER_ID ? parseInt(process.env.OWNER_ID, 10) : 6293437261;

if (!TOKEN || !process.env.DATABASE_URL) {
    console.error('CRITICAL: Missing TELEGRAM_BOT_TOKEN or DATABASE_URL');
    process.exit(1);
}

app.get('/', (req, res) => res.status(200).send('OK'));
app.listen(PORT, '0.0.0.0', () => console.log(`Server listening on port ${PORT}`));

const isInternalHost = process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway.internal');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isInternalHost ? false : (process.env.DATABASE_URL ? { rejectUnauthorized: false } : false),
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000
});

pool.on('error', (err) => console.error('Unexpected Postgres pool error:', err));

async function initDb() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_settings (
            user_id BIGINT PRIMARY KEY,
            timezone TEXT NOT NULL DEFAULT 'America/Chicago',
            pending_edit TEXT DEFAULT NULL,
            trigger_msg_id BIGINT DEFAULT NULL,
            active_menu_msg_id BIGINT DEFAULT NULL,
            collapse_at TIMESTAMPTZ DEFAULT NULL
            );
        `);

        await pool.query(`
            ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS pending_edit TEXT DEFAULT NULL;
            ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS trigger_msg_id BIGINT DEFAULT NULL;
            ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS active_menu_msg_id BIGINT DEFAULT NULL;
            ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS collapse_at TIMESTAMPTZ DEFAULT NULL;
            ALTER TABLE user_settings ALTER COLUMN timezone SET DEFAULT 'America/Chicago';
            UPDATE user_settings SET timezone = 'America/Chicago' WHERE timezone IS NULL;
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS reminders (
            id SERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL,
            chat_id BIGINT,
            text TEXT NOT NULL,
            remind_at TIMESTAMPTZ NOT NULL,
            sent BOOLEAN DEFAULT FALSE,
            recurring TEXT DEFAULT NULL,
            total_occurrences INT DEFAULT NULL,
            current_occurrence INT DEFAULT 0,
            early_offset INT DEFAULT NULL,
            early_alert_sent BOOLEAN DEFAULT FALSE
            );
            ALTER TABLE reminders ADD COLUMN IF NOT EXISTS early_offset INT DEFAULT NULL;
            ALTER TABLE reminders ADD COLUMN IF NOT EXISTS early_alert_sent BOOLEAN DEFAULT FALSE;
        `);
        console.log("Database initialized successfully!");
    } catch (err) {
        console.error("Error initializing database:", err);
    }
}
initDb();

setInterval(async () => {
    try {
        const res = await pool.query(`SELECT * FROM reminders WHERE (remind_at <= NOW() AND sent = FALSE) OR (early_offset IS NOT NULL AND early_alert_sent = FALSE AND remind_at - (early_offset * INTERVAL '1 minute') <= NOW())`);
        for (const r of res.rows) {
            const now = new Date();

            const remindAt = new Date(r.remind_at);
            const tz = r.timezone || 'America/Chicago';
            const formattedTime = DateTime.fromJSDate(remindAt).setZone(tz).toFormat("EEE, MMM d, yyyy 'at' h:mm a")
                .replace(/:00\s?(AM|PM)/i, '$1')
                .replace(/\s?(AM|PM)/i, m => m.toLowerCase().trim());

            if (r.early_offset && !r.early_alert_sent && now >= new Date(remindAt.getTime() - r.early_offset * 60000)) {
                await sendTelegramMessage(r.chat_id || r.user_id, `⚡ | <blockquote><b>${escapeHTML(r.text)}</b></blockquote>\n<i>Starts in ${r.early_offset}m (${formattedTime})</i>`);
                await pool.query('UPDATE reminders SET early_alert_sent = TRUE WHERE id = $1', [r.id]);
            } else if (now >= remindAt && !r.sent) {
                await sendTelegramMessage(r.chat_id || r.user_id, `🔔 | <blockquote><b>${escapeHTML(r.text)}</b></blockquote>\n<i>${formattedTime}</i>`);

                if (r.recurring) {
                    const userTz = tz;
                    const nextDate = calculateNextOccurrence(new Date(), r.recurring, userTz);
                    const newCount = (r.current_occurrence || 0) + 1;

                    if (!r.total_occurrences || newCount < r.total_occurrences) {
                        await pool.query('UPDATE reminders SET remind_at = $1, current_occurrence = $2, early_alert_sent = FALSE WHERE id = $3', [nextDate, newCount, r.id]);
                    } else {
                        await pool.query('UPDATE reminders SET sent = TRUE WHERE id = $1', [r.id]);
                    }
                } else {
                    await pool.query('UPDATE reminders SET sent = TRUE WHERE id = $1', [r.id]);
                }
            }
        }
    } catch (err) {
        console.error('Reminder execution error:', err);
    }
}, 30000);

async function getUserTimezone(userId) {
    if (!process.env.DATABASE_URL) return 'America/Chicago';
    try {
        const res = await pool.query('SELECT timezone FROM user_settings WHERE user_id = $1', [userId]);
        return res.rows.length > 0 ? res.rows[0].timezone : 'America/Chicago';
    } catch (err) {
        return 'America/Chicago';
    }
}

async function setUserTimezone(userId, tz) {
    if (!process.env.DATABASE_URL) return;
    try {
        await pool.query(
            `INSERT INTO user_settings (user_id, timezone) VALUES ($1, $2)
             ON CONFLICT (user_id) DO UPDATE SET timezone = $2`,
            [userId, tz]
        );
    } catch (err) {
        console.error('Error saving user timezone:', err);
    }
}

async function getActiveMenuMsgId(userId) {
    if (!process.env.DATABASE_URL) return null;
    try {
        const res = await pool.query('SELECT active_menu_msg_id FROM user_settings WHERE user_id = $1', [userId]);
        return (res.rows.length > 0 && res.rows[0].active_menu_msg_id) ? res.rows[0].active_menu_msg_id : null;
    } catch (err) {
        return null;
    }
}

async function setActiveMenuMsgId(userId, msgId, triggerMsgId = null) {
    if (!process.env.DATABASE_URL) return;
    try {
        const collapseAt = msgId ? new Date(Date.now() + 30000) : null;
        await pool.query(
            `INSERT INTO user_settings (user_id, active_menu_msg_id, trigger_msg_id, collapse_at, timezone)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (user_id) DO UPDATE SET
             active_menu_msg_id = $2,
             trigger_msg_id = COALESCE($3, user_settings.trigger_msg_id),
             collapse_at = $4,
             timezone = COALESCE(user_settings.timezone, EXCLUDED.timezone)`,
            [userId, msgId, triggerMsgId, collapseAt, 'America/Chicago']
        );
    } catch (err) {
        console.error('Error setting active menu msg id:', err);
    }
}

async function getPendingEdit(userId) {
    if (!process.env.DATABASE_URL) return null;
    try {
        const res = await pool.query('SELECT pending_edit FROM user_settings WHERE user_id = $1', [userId]);
        return res.rows.length > 0 ? res.rows[0].pending_edit : null;
    } catch (err) {
        return null;
    }
}

async function setPendingEdit(userId, pendingStr) {
    if (!process.env.DATABASE_URL) return;
    try {
        await pool.query(
            `INSERT INTO user_settings (user_id, pending_edit)
             VALUES ($1, $2)
             ON CONFLICT (user_id) DO UPDATE SET pending_edit = $2`,
            [userId, pendingStr]
        );
    } catch (err) {
        console.error('Error setting pending edit:', err);
    }
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
    else if (type === 'dow') {
        const selectedDays = parts[1].split(',').map(Number).sort();
        const currentDay = dt.weekday;
        let daysToAdd = -1;
        for (const day of selectedDays) {
            if (day > currentDay) {
                daysToAdd = day - currentDay;
                break;
            }
        }
        if (daysToAdd === -1) {
            daysToAdd = (7 - currentDay) + selectedDays[0];
        }
        dt = dt.plus({ days: daysToAdd });
    }

    return dt.toJSDate();
}

function parseFlexibleDate(text, timeZone) {
    let clean = text.trim().replace(/^reminder\s*/i, '');
    const cleanNoEmoji = clean
        .replace(/^(?:(?:\p{Extended_Pictographic})(?:\uFE0F|\u200D(?:\p{Extended_Pictographic}))*(?:\s|$))+/u, '')
        .replace(/^(?:[\p{Extended_Pictographic}\uFE0F\u200D]+\s*)+/u, '')
        .trim();
    let dateInput = cleanNoEmoji || clean;
    const nowInZone = DateTime.now().setZone(timeZone);

    let wantRepeatMenu = false;
    if (/\brepeat\b$/i.test(clean)) {
        wantRepeatMenu = true;
        clean = clean.replace(/\brepeat\b$/i, '').trim();
        dateInput = clean
            .replace(/^(?:(?:\p{Extended_Pictographic})(?:\uFE0F|\u200D(?:\p{Extended_Pictographic}))*(?:\s|$))+/u, '')
            .replace(/^(?:[\p{Extended_Pictographic}\uFE0F\u200D]+\s*)+/u, '')
            .trim() || clean;
    }

    const compoundRegex = /^((?:\d+d)?\s*(?:\d+h)?\s*(?:\d+m)?\s*(?:\d+s)?)\s+(.+)$/i;
    const match = dateInput.match(compoundRegex);

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
            const leadingEmoji = (clean.match(/^(?:[\p{Extended_Pictographic}\uFE0F\u200D]+\s*)+/u) || [''])[0];
            const reminderText = (match[2] && match[2].trim()) ? `${leadingEmoji}${match[2].trim()}`.trim() : clean;
            return { dt, date: dt.toJSDate(), text: reminderText, reminderText, wantRepeatMenu };
        }
    }

    const referenceDate = new Date(nowInZone.year, nowInZone.month - 1, nowInZone.day, nowInZone.hour, nowInZone.minute, nowInZone.second);
    const parsed = chrono.parse(dateInput, referenceDate, { forwardDate: true });
    if (parsed.length > 0) {
        const parsedResult = parsed[0];
        const parsedComp = parsedResult.start;

        let dt = nowInZone.set({
            hour: parsedComp.get('hour') !== null ? parsedComp.get('hour') : nowInZone.hour,
            minute: parsedComp.get('minute') !== null ? parsedComp.get('minute') : 0,
            second: 0,
            millisecond: 0
        });

        if (parsedComp.get('day') !== null) {
            dt = dt.set({
                year: parsedComp.get('year') || nowInZone.year,
                month: parsedComp.get('month'),
                day: parsedComp.get('day')
            });
        }

        if (dt <= nowInZone) {
            if (parsedComp.get('day') === null && parsedComp.get('month') === null) {
                dt = dt.plus({ days: 1 });
            } else {
                return null;
            }
        }

        let reminderText = clean;
        if (parsedResult.text) {
            const dateText = parsedResult.text.trim();
            const idx = dateInput.toLowerCase().indexOf(dateText.toLowerCase());
            if (idx >= 0) {
                const originalIdx = clean.toLowerCase().indexOf(dateText.toLowerCase());
                if (originalIdx >= 0) {
                    reminderText = `${clean.slice(0, originalIdx)} ${clean.slice(originalIdx + dateText.length)}`.trim();
                } else {
                    reminderText = clean.replace(dateText, '').trim();
                }
            }
        }
        if (!reminderText) reminderText = 'Reminder';

        return { dt, date: dt.toJSDate(), text: reminderText, reminderText, wantRepeatMenu };
    }
    return null;
}

async function getRemindersDashboardData(userId, userTz, passedName = null) {
    try {
        let uName = passedName || 'Your';
        let titleName = uName === 'Your' ? 'Your' : `${uName}'s`;

        const res = await pool.query('SELECT id, text, remind_at, recurring, total_occurrences FROM reminders WHERE user_id = $1 AND sent = FALSE ORDER BY remind_at ASC', [userId]);

        if (res.rows.length === 0) {
            return {
                text: `📋 <b>${titleName} Active Reminders:</b>\n━━━━━━━━━━━━━━━━━━\n\n<i>📭 No active reminders found.</i>`,
                keyboard: { inline_keyboard: [[{ text: '📭 No active reminders', callback_data: 'noop' }]] }
            };
        }

        let buttons = res.rows.map(r => {
            let statusIcon = r.recurring ? (r.total_occurrences ? '🔢 ' : '🔄 ') : '';
            return [
                { text: `${statusIcon}${r.text}`, callback_data: `view:${r.id}` },
                { text: '✏️ Edit', callback_data: `edit:${r.id}` },
                { text: '❌ Del', callback_data: `del:${r.id}` }
            ];
        });

        return { text: `📋 <b>${titleName} Active Reminders:</b>`, keyboard: { inline_keyboard: buttons } };
    } catch (err) {
        console.error('Error fetching reminders for dashboard:', err);
        return { text: '⚠️ Error loading reminders.', keyboard: { inline_keyboard: [[{ text: '⚠️ Error loading reminders', callback_data: 'noop' }]] } };
    }
}

async function sendOrUpdateDashboard(userId, text, markup, triggerMsgId = null) {
    const existingMsgId = await getActiveMenuMsgId(userId);
    let targetMsgId = null;

    if (existingMsgId) {
        await deleteTelegramMessage(userId, existingMsgId);
    }

    const newMsg = await sendTelegramMessage(userId, text, markup);
    if (newMsg) {
        targetMsgId = newMsg.message_id;
        await setActiveMenuMsgId(userId, targetMsgId, triggerMsgId);
    }

    if (targetMsgId) {
        resetMenuTimer(`dm_dashboard_${userId}`, async () => {
            try {
                await deleteTelegramMessage(userId, targetMsgId);
                await setActiveMenuMsgId(userId, null);
            } catch (err) {
                console.error('Failed to auto-collapse DM dashboard:', err);
            }
        });
    }
}

app.post('/webhook', async (req, res) => {
    if (process.env.WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== process.env.WEBHOOK_SECRET) {
        return res.sendStatus(403);
    }
    try {
        const { message, callback_query: callbackQuery, inline_query: inlineQuery, chosen_inline_result: chosenResult } = req.body;

        let userId = null;
        let userFirstName = null;

        if (message && message.from) {
            userId = message.from.id;
            userFirstName = message.from.first_name;
        } else if (callbackQuery && callbackQuery.from) {
            userId = callbackQuery.from.id;
            userFirstName = callbackQuery.from.first_name;
        } else if (inlineQuery && inlineQuery.from) {
            userId = inlineQuery.from.id;
            userFirstName = inlineQuery.from.first_name;
        } else if (chosenResult && chosenResult.from) {
            userId = chosenResult.from.id;
            userFirstName = chosenResult.from.first_name;
        }

        if (!userId) return res.sendStatus(200);

        if (message && message.text) {
            const chatId = message.chat.id;
            const msgId = message.message_id;
            const text = message.text.trim();
            if (text.length > 500) {
                await sendTelegramMessage(chatId, '⚠️ Reminder text is too long. Please keep it under 500 characters.');
                return res.sendStatus(200);
            }
            const pendingEdit = await getPendingEdit(userId);
            if (pendingEdit) {
                const parts = pendingEdit.split(':');
                const field = parts[0];
                const reminderId = parts[1];
                const userTz = await getUserTimezone(userId);

                if (field === 'text') {
                    await pool.query('UPDATE reminders SET text = $1 WHERE id = $2 AND user_id = $3', [text, reminderId, userId]);
                    await sendTelegramMessage(userId, `✅ Reminder text updated to: "<b>${escapeHTML(text)}</b>"`, null, 5000);
                } else if (field === 'time') {
                    const parsed = parseFlexibleDate(text, userTz);
                    if (parsed) {
                        if (typeof chatId !== 'undefined' && typeof msgId !== 'undefined') { await deleteTelegramMessage(chatId, msgId); }
                        await pool.query('UPDATE reminders SET remind_at = $1 WHERE id = $2 AND user_id = $3', [parsed.date, reminderId, userId]);
                        const localDt = DateTime.fromJSDate(parsed.date).setZone('America/Chicago');
                        await sendTelegramMessage(userId, `✅ Reminder time updated to: <i>${localDt.toFormat("EEE, LLL d, yyyy 'at' h:mm a")}</i>`, null, 5000);
                    } else {
                        await sendTelegramMessage(userId, '⚠️ Could not parse new time. Please try again or tap Cancel.', null, 5000);
                        return res.sendStatus(200);
                    }
                } else if (field === 'rec') {
                    const unit = parts[2];
                    const num = parseInt(text.trim(), 10);
                    if (!isNaN(num) && num > 0) {
                        const recurringVal = `${unit}:${num}`;
                        await pool.query('UPDATE reminders SET recurring = $1 WHERE id = $2 AND user_id = $3', [recurringVal, reminderId, userId]);
                        await sendTelegramMessage(userId, `✅ Recurrence set to <b>Every ${num} ${unit}</b>!`, null, 5000);
                    } else {
                        await sendTelegramMessage(userId, '⚠️ Invalid number. Please enter a valid number.', null, 5000);
                        return res.sendStatus(200);
                    }
                }

                await setPendingEdit(userId, null);
                if (typeof chatId !== 'undefined' && typeof msgId !== 'undefined') { await deleteTelegramMessage(chatId, msgId); }
                const existingMenuId = await getActiveMenuMsgId(userId);
                if (existingMenuId) await deleteTelegramMessage(userId, existingMenuId);
                await setActiveMenuMsgId(userId, null);
                const dashData = await getRemindersDashboardData(userId, userTz, userFirstName);
                await sendOrUpdateDashboard(userId, dashData.text, dashData.keyboard);
                return res.sendStatus(200);
            }

            if (text.startsWith('/start') || text.toLowerCase() === 'view') {
                if (typeof chatId !== 'undefined' && typeof msgId !== 'undefined') { await deleteTelegramMessage(chatId, msgId); }
                const existingTz = await getUserTimezone(userId);
                if (existingTz) {
                    const dashData = await getRemindersDashboardData(userId, existingTz);
                    await sendOrUpdateDashboard(userId, dashData.text, dashData.keyboard, msgId);
                } else {
                    await sendTelegramMessage(userId, '👋 <b>Welcome! Please select your primary timezone:</b>', getTimezonePickerKeyboard());
                }
                return res.sendStatus(200);
            }

            if ((text.startsWith('/delete') || text.startsWith('/del')) && userId === OWNER_ID) {
                const replyMsg = message.reply_to_message;
                if (replyMsg?.from?.is_bot) {
                    await deleteTelegramMessage(chatId, replyMsg.message_id);
                    if (typeof chatId !== 'undefined' && typeof msgId !== 'undefined') { await deleteTelegramMessage(chatId, msgId); }
                }
                return res.sendStatus(200);
            }

            const userTz = await getUserTimezone(userId);
            const parsed = parseFlexibleDate(text, userTz);

            if (parsed) {
                if (typeof chatId !== 'undefined' && typeof msgId !== 'undefined') { await deleteTelegramMessage(chatId, msgId); }
                const insertRes = await pool.query('INSERT INTO reminders (user_id, chat_id, text, remind_at) VALUES ($1, $2, $3, $4) RETURNING id', [userId, chatId, parsed.reminderText, parsed.date]);
                if (parsed.wantRepeatMenu) {
                    await sendOrUpdateDashboard(userId, `📝 Editing Reminder: "<b>${escapeHTML(parsed.reminderText)}</b>"\nSelect options below:`, getEditMenuKeyboard(insertRes.rows[0].id, null, null));
                } else {
                    const dashData = await getRemindersDashboardData(userId, userTz, userFirstName);
                    await sendOrUpdateDashboard(userId, dashData.text, dashData.keyboard, msgId);
                }
            }
            return res.sendStatus(200);
        }

        if (callbackQuery) {
            const chatId = callbackQuery.message?.chat.id;
            const messageId = callbackQuery.message?.message_id;
            const data = callbackQuery.data;

            const inlineMsgId = callbackQuery.inline_message_id;
            if (inlineMsgId) {
                resetMenuTimer(`inline_${inlineMsgId}`, async () => {
                    await fetchWithTimeout(`https://api.telegram.org/bot${TOKEN}/editMessageText`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ inline_message_id: inlineMsgId, text: '🫈 <b>Squatch spotted! List collapsed before anyone got proof.</b>', parse_mode: 'HTML' })
                    });
                });
            } else if (messageId && chatId) {
                resetMenuTimer(`dm_dashboard_${userId}`, async () => {
                    await deleteTelegramMessage(chatId, messageId);
                    await setActiveMenuMsgId(userId, null);
                });
            }

            let userTz = (await getUserTimezone(userId)) || 'America/Chicago';

            if (messageId) { await setActiveMenuMsgId(userId, messageId); }

            if (data.startsWith('settz:')) {
                const tz = data.replace('settz:', '');
                await setUserTimezone(userId, tz);
                await answerCallbackQuery(callbackQuery.id, `✅ Timezone saved: ${tz}`, true);
                const dashData = await getRemindersDashboardData(userId, tz, userFirstName);
                await sendOrUpdateDashboard(userId, dashData.text, dashData.keyboard);
            } else if (data === 'noop') {
                await answerCallbackQuery(callbackQuery.id);
            } else if (data === 'menu:list') {
                await answerCallbackQuery(callbackQuery.id);
                await setPendingEdit(userId, null);
                const dashData = await getRemindersDashboardData(userId, userTz, userFirstName);
                if (chatId && messageId) {
                    await editTelegramMessage(chatId, messageId, dashData.text, dashData.keyboard);
                } else {
                    await sendOrUpdateDashboard(userId, dashData.text, dashData.keyboard);
                }
            } else if (data.startsWith('del:')) {
                const reminderId = data.replace('del:', '');
                await answerCallbackQuery(callbackQuery.id, '⚠️ Tap again to confirm deletion!', false);

                const dashData = await getRemindersDashboardData(userId, userTz, userFirstName);
                if (dashData && dashData.keyboard && dashData.keyboard.inline_keyboard) {
                    dashData.keyboard.inline_keyboard = dashData.keyboard.inline_keyboard.map(row => {
                        return row.map(btn => {
                            if (btn.callback_data === `del:${reminderId}`) {
                                return { text: '⚠️ <b>Confirm?</b>', callback_data: `confirm_del:${reminderId}` };
                            }
                            return btn;
                        });
                    });
                }

                if (chatId && messageId) {
                    await editTelegramMessage(chatId, messageId, dashData.text, dashData.keyboard);
                } else if (callbackQuery.inline_message_id) {
                    await fetchWithTimeout(`https://api.telegram.org/bot${TOKEN}/editMessageText`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            inline_message_id: callbackQuery.inline_message_id,
                            text: dashData.text,
                            reply_markup: dashData.keyboard,
                            parse_mode: 'HTML'
                        })
                    });
                }
                return res.sendStatus(200);
            } else if (data.startsWith('confirm_del:')) {
                const reminderId = data.replace('confirm_del:', '');
                await pool.query('DELETE FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
                await answerCallbackQuery(callbackQuery.id, '🗑️ Reminder deleted!', false);

                const dashData = await getRemindersDashboardData(userId, userTz, userFirstName);
                if (chatId && messageId) {
                    await editTelegramMessage(chatId, messageId, dashData.text, dashData.keyboard);
                } else if (callbackQuery.inline_message_id) {
                    const iMsgId = callbackQuery.inline_message_id;

                    if (!iMsgId) {
                        await answerCallbackQuery(callbackQuery.id);
                        const result = await pool.query('SELECT text, recurring, total_occurrences, early_offset FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
                        if (result.rows.length > 0) {
                            const r = result.rows[0];
                            const targetMsgId = callbackQuery.message.message_id;
                            await editTelegramMessage(userId, targetMsgId, `✏️ Editing Reminder: "<b>${escapeHTML(r.text)}</b>"\n━━━━━━━━━━━━━━━━━━\nSelect options below:`, getEditMenuKeyboard(reminderId, r.recurring, r.total_occurrences, r.early_offset));
                        }
                        return res.sendStatus(200);
                    }
                    await fetchWithTimeout(`https://api.telegram.org/bot${TOKEN}/editMessageText`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            inline_message_id: iMsgId,
                            text: dashData.text,
                            reply_markup: dashData.keyboard,
                            parse_mode: 'HTML'
                        })
                    });
                }
                return res.sendStatus(200);
            } else if (data.startsWith('view:')) {
                const reminderId = data.replace('view:', '');
                const result = await pool.query('SELECT text, remind_at, recurring, total_occurrences, current_occurrence, early_offset FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
                if (result.rows.length > 0) {
                    const r = result.rows[0];
                    const dt = DateTime.fromJSDate(new Date(r.remind_at)).setZone('America/Chicago');

                    const formattedTime = dt.toFormat("EEE, LLL d, yyyy 'at' h:mm a")
                        .replace(/:00\s?(AM|PM)/i, '$1')
                        .replace(/\s?(AM|PM)/i, m => m.toLowerCase().trim());

                    let extras = [];
                    if (r.recurring) extras.push(`🔄 | Repeat: ${formatRepeatText(r.recurring)}${r.total_occurrences ? ` (${r.current_occurrence || 0}/${r.total_occurrences})` : ""}`);
                    if (r.early_offset) extras.push(`⏳ | Early Warning: ${r.early_offset}m`);
                    const extrasStr = extras.length > 0 ? `\n\n━━━━━━━━━━━━━━━━━━\n${extras.join('\n')}` : "";

                    await answerCallbackQuery(callbackQuery.id, `━━━━━━━━━━━━━━━━━━\n🔔 | ${escapeHTML(r.text)}\n\n🕒 | ${formattedTime}${extrasStr}`, true);
                }
            } else if (data.startsWith('edit:')) {
                const reminderId = data.replace('edit:', '');
                const iMsgId = callbackQuery.inline_message_id;

                if (!iMsgId) {
                    await answerCallbackQuery(callbackQuery.id);
                    const result = await pool.query('SELECT text, recurring, total_occurrences, early_offset FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
                    if (result.rows.length > 0) {
                        const r = result.rows[0];
                        await editTelegramMessage(userId, callbackQuery.message.message_id, `✏️ Editing Reminder: "<b>${escapeHTML(r.text)}</b>"\n━━━━━━━━━━━━━━━━━━\nSelect options below:`, getEditMenuKeyboard(reminderId, r.recurring, r.total_occurrences, r.early_offset));
                    }
                    return res.sendStatus(200);
                }

                if (iMsgId) {
                    const key = `edit_confirm:${userId}:${reminderId}`;
                    if (pendingInlineEdits.has(key)) {
                        pendingInlineEdits.delete(key);
                        await answerCallbackQuery(callbackQuery.id, '📩 Sent edit options to DM!', false);

                        const result = await pool.query('SELECT text, recurring, total_occurrences, early_offset FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
                        if (result.rows.length > 0) {
                            const r = result.rows[0];
                            const activeMsgId = await getActiveMenuMsgId(userId);
                            if (activeMsgId) {
                                await deleteTelegramMessage(userId, activeMsgId);
                                await setActiveMenuMsgId(userId, null);
                            }
                            await sendOrUpdateDashboard(userId, `✏️ Editing Reminder: "<b>${escapeHTML(r.text)}</b>"\n━━━━━━━━━━━━━━━━━━\nSelect options below:`, getEditMenuKeyboard(reminderId, r.recurring, r.total_occurrences, r.early_offset));
                        }

                        await fetchWithTimeout(`https://api.telegram.org/bot${TOKEN}/editMessageText`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                inline_message_id: iMsgId,
                                text: '📝 <i>Edit menu sent to your DM!</i>',
                                parse_mode: 'HTML'
                            })
                        });
                    } else {
                        pendingInlineEdits.add(key);
                        setTimeout(() => pendingInlineEdits.delete(key), 10000);
                        await answerCallbackQuery(callbackQuery.id, '⚠️ Tap Edit again within 10s to send options to your DM', false);

                        const dashData = await getRemindersDashboardData(userId, userTz, userFirstName);
                        if (dashData && dashData.keyboard && dashData.keyboard.inline_keyboard) {
                            dashData.keyboard.inline_keyboard = dashData.keyboard.inline_keyboard.map(row => {
                                return row.map(btn => {
                                    if (btn.callback_data === `edit:${reminderId}`) {
                                        return { text: '⚠️ <b>Send DM?</b>', callback_data: `edit:${reminderId}` };
                                    }
                                    return btn;
                                });
                            });
                        }

                        await fetchWithTimeout(`https://api.telegram.org/bot${TOKEN}/editMessageText`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                inline_message_id: iMsgId,
                                text: dashData.text,
                                reply_markup: dashData.keyboard,
                                parse_mode: 'HTML'
                            })
                        });
                    }
                    return res.sendStatus(200);
                }
            } else if (data.startsWith('setearly:')) {
                const parts = data.split(':');
                const reminderId = parts[1];
                const mins = parseInt(parts[2], 10);
                const offsetVal = mins === 0 ? null : mins;
                await pool.query('UPDATE reminders SET early_offset = $1, early_alert_sent = FALSE WHERE id = $2 AND user_id = $3', [offsetVal, reminderId, userId]);
                await answerCallbackQuery(callbackQuery.id, '⚡ Early warning updated!', true);
                const result = await pool.query('SELECT recurring, total_occurrences, early_offset FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
                if (result.rows.length > 0) {
                    const r = result.rows[0];
                    await editTelegramMessage(chatId, messageId, `✏️ <b>Editing Reminder</b>\n━━━━━━━━━━━━━━━━━━\nSelect options below:`, getEditMenuKeyboard(reminderId, r.recurring, r.total_occurrences, r.early_offset));
                }
            } else if (data.startsWith('prompt_early:')) {
                const reminderId = data.replace('prompt_early:', '');
                await setPendingEdit(userId, `early:${reminderId}`);
                await editTelegramMessage(chatId, messageId, `⚡ <b>How many minutes early should the warning be?</b>\n<i>Example: 15, 45, 120</i>\n━━━━━━━━━━━━━━━━━━`, { inline_keyboard: [[{ text: '⬅️ <b>Cancel</b>', callback_data: `edit:${reminderId}` }]] });
                await answerCallbackQuery(callbackQuery.id);
            } else if (data.startsWith('prompt_edit_text:')) {
                const reminderId = data.replace('prompt_edit_text:', '');
                await setPendingEdit(userId, `text:${reminderId}`);
                await editTelegramMessage(chatId, messageId, `📝 <b>Please type the new note/text for this reminder:</b>\n━━━━━━━━━━━━━━━━━━`, { inline_keyboard: [[{ text: '⬅️ <b>Cancel</b>', callback_data: `edit:${reminderId}` }]] });
                await answerCallbackQuery(callbackQuery.id);
            } else if (data.startsWith('prompt_edit_time:')) {
                const reminderId = data.replace('prompt_edit_time:', '');
                await setPendingEdit(userId, `time:${reminderId}`);
                await editTelegramMessage(chatId, messageId, `🕒 <b>Please type the new time/date for this reminder:</b>\n<i>Example: tomorrow at 8am, 2h, or Aug 12 5pm</i>\n━━━━━━━━━━━━━━━━━━`, { inline_keyboard: [[{ text: '⬅️ <b>Cancel</b>', callback_data: `edit:${reminderId}` }]] });
                await answerCallbackQuery(callbackQuery.id);
            } else if (data.startsWith('dowmenu:')) {
                const reminderId = data.replace('dowmenu:', '');
                const result = await pool.query('SELECT recurring FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
                if (result.rows.length > 0) {
                    await answerCallbackQuery(callbackQuery.id);
                    await editTelegramMessage(chatId, messageId, `📅 <b>Select specific days to repeat:</b>\n━━━━━━━━━━━━━━━━━━`, getDowMenuKeyboard(reminderId, result.rows[0].recurring));
                }
            } else if (data.startsWith('toggledow:')) {
                const parts = data.split(':');
                const reminderId = parts[1];
                const dayNum = parseInt(parts[2], 10);
                const result = await pool.query('SELECT recurring FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
                if (result.rows.length > 0) {
                    let current = result.rows[0].recurring;
                    let selected = (current && current.startsWith('dow:')) ? current.split(':')[1].split(',').map(Number) : [];
                    if (selected.includes(dayNum)) {
                        selected = selected.filter(n => n !== dayNum);
                    } else {
                        selected.push(dayNum);
                    }
                    selected.sort();
                    let newRec = selected.length > 0 ? `dow:${selected.join(',')}` : null;
                    await pool.query('UPDATE reminders SET recurring = $1 WHERE id = $2 AND user_id = $3', [newRec, reminderId, userId]);
                    await answerCallbackQuery(callbackQuery.id);
                    await editTelegramMessage(chatId, messageId, `📅 <b>Select specific days to repeat:</b>\n━━━━━━━━━━━━━━━━━━`, getDowMenuKeyboard(reminderId, newRec));
                }
            } else if (data.startsWith('unitmenu:')) {
                const reminderId = data.replace('unitmenu:', '');
                await answerCallbackQuery(callbackQuery.id);
                await editTelegramMessage(chatId, messageId, `⚙️ <b>Select Custom Interval Unit:</b>\n━━━━━━━━━━━━━━━━━━`, getUnitMenuKeyboard(reminderId));
            } else if (data.startsWith('nummenu:')) {
                const [, reminderId, unit] = data.split(':');
                await answerCallbackQuery(callbackQuery.id);
                await editTelegramMessage(chatId, messageId, `⚙️ <b>Select Every How Many ${unit.toUpperCase()}:</b>\n━━━━━━━━━━━━━━━━━━`, getNumberMenuKeyboard(reminderId, unit));
            } else if (data.startsWith('prompt_rec:')) {
                const [, reminderId, unit] = data.split(':');
                await setPendingEdit(userId, `rec:${reminderId}:${unit}`);
                await editTelegramMessage(chatId, messageId, `⚙️ <b>Enter custom repeat interval in ${unit.toUpperCase()}:</b>\n<i>Example: 56, 72, 100</i>\n━━━━━━━━━━━━━━━━━━`, { inline_keyboard: [[{ text: '⬅️ Cancel', callback_data: `nummenu:${reminderId}:${unit}` }]] });
                await answerCallbackQuery(callbackQuery.id);
            } else if (data.startsWith('limitmenu:')) {
                const reminderId = data.replace('limitmenu:', '');
                const result = await pool.query('SELECT total_occurrences, early_offset FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
                if (result.rows.length > 0) {
                    await answerCallbackQuery(callbackQuery.id);
                    await editTelegramMessage(chatId, messageId, `🔁 <b>Select How Many Times to Repeat:</b>\n━━━━━━━━━━━━━━━━━━`, getLimitMenuKeyboard(reminderId, result.rows[0].total_occurrences));
                }
            } else if (data.startsWith('setrec:')) {
                const [, reminderId, recType, interval = '1'] = data.split(':');
                const recurringVal = recType === 'none' ? null : `${recType}:${interval}`;

                await pool.query('UPDATE reminders SET recurring = $1 WHERE id = $2 AND user_id = $3', [recurringVal, reminderId, userId]);
                await answerCallbackQuery(callbackQuery.id, '✅ Recurrence updated!', true);

                const result = await pool.query('SELECT total_occurrences, early_offset FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
                await editTelegramMessage(chatId, messageId, `✏️ <b>Editing Reminder</b>\n━━━━━━━━━━━━━━━━━━\nSelect options below:`, getEditMenuKeyboard(reminderId, recurringVal, result.rows[0].total_occurrences, result.rows[0].early_offset));
            } else if (data.startsWith('setlimit:')) {
                const [, reminderId, countStr] = data.split(':');
                const count = parseInt(countStr, 10);
                const limitVal = count === 0 ? null : count;

                await pool.query('UPDATE reminders SET total_occurrences = $1 WHERE id = $2 AND user_id = $3', [limitVal, reminderId, userId]);
                await answerCallbackQuery(callbackQuery.id, '✅ Repeat limit updated!', true);

                const result = await pool.query('SELECT recurring, early_offset FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
                await editTelegramMessage(chatId, messageId, `✏️ <b>Editing Reminder</b>\n━━━━━━━━━━━━━━━━━━\nSelect options below:`, getEditMenuKeyboard(reminderId, result.rows[0].recurring, limitVal, result.rows[0].early_offset));
            }
        }

        if (inlineQuery) {
            const userTz = (await getUserTimezone(userId)) || 'America/Chicago';
            const queryText = inlineQuery.query.trim();
            let results = [];

            if (queryText.toLowerCase() === 'view' || queryText === '') {
                results.push({
                    type: 'article',
                    id: 'show_reminders_dm',
                    title: '👀 View Active Reminders (DM)',
                    description: 'Tap to view and manage your active reminders.',
                    thumbnail_url: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/2709.png',
                    thumb_width: 72,
                    thumb_height: 72,
                    input_message_content: { message_text: '📋 <b>Requesting active reminders list...</b>' },
                    reply_markup: {
                        inline_keyboard: [[{ text: '⏳ <b>Loading...</b>', callback_data: 'noop' }]]
                    }
                });
                results.push({
                    type: 'article',
                    id: 'show_reminders_inline_v6',
                    title: '👀 View Active Reminders (Inline)',
                    description: 'Posts active reminders in chat, collapses in 30s',
                    thumbnail_url: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/23f3.png',
                    input_message_content: { message_text: '📋 <b>Fetching active reminders...</b>' },
                    reply_markup: {
                        inline_keyboard: [[{ text: '⏳ <b>Loading...</b>', callback_data: 'noop' }]]
                    }
                });
            } else {
                const parsed = parseFlexibleDate(queryText, userTz);
                if (parsed) {
                    if (typeof chatId !== 'undefined' && typeof msgId !== 'undefined') { await deleteTelegramMessage(chatId, msgId); }
                    const dt = DateTime.fromJSDate(parsed.date).setZone('America/Chicago');
                    const reminderText = parsed.text || parsed.reminderText || queryText;
                    results.push({
                        type: 'article',
                        id: (() => {
                            const genId = `create_inline_${crypto.createHash('sha256').update(queryText).digest('hex').slice(0, 24)}`;
                            inlineQueryCache.set(genId, queryText);
                            setTimeout(() => inlineQueryCache.delete(genId), 10 * 60 * 1000);
                            return genId;
                        })(),
                        title: `🔔 Set Reminder: "${reminderText}"`,
                        thumbnail_url: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/23f0.png",
                        description: `Scheduled for: ${dt.toFormat("EEEE, MMM d, yyyy 'at' h:mm a")}`,
                        input_message_content: { message_text: `⏳ <b>Creating reminder...</b>` },
                        reply_markup: {
                            inline_keyboard: [[{ text: '⏳ <b>Processing...</b>', callback_data: 'noop' }]]
                        }
                    });
                } else {
                    results.push({
                        type: 'article',
                        id: `invalid_${Buffer.from(queryText).toString('base64url').substring(0, 100)}`,
                        title: '⚠️ Min 1 min ahead',
                        description: 'Time must be >= 1 min.',
                        input_message_content: { message_text: '❌ <b>Reminders must be set for at least 1 minute from now.</b>' }
                    });
                }
            }

            await fetchWithTimeout(`https://api.telegram.org/bot${TOKEN}/answerInlineQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inline_query_id: inlineQuery.id, results, cache_time: 0 })
            });
        }

        if (chosenResult) {
            const selectedResultId = chosenResult.result_id || '';
            const iMsgId = chosenResult.inline_message_id || null;

            if (selectedResultId.startsWith('create_inline_')) {
                let rawQuery = chosenResult.query || '';
                if (!rawQuery) {
                    const cachedQuery = inlineQueryCache.get(selectedResultId);
                    if (cachedQuery) {
                        rawQuery = cachedQuery;
                    }
                }

                const userTz = (await getUserTimezone(userId)) || 'America/Chicago';
                const parsed = parseFlexibleDate(rawQuery, userTz);

                if (!parsed) {
                    if (iMsgId) {
                        await fetchWithTimeout(`https://api.telegram.org/bot${TOKEN}/editMessageText`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                inline_message_id: iMsgId,
                                text: '❌ <b>I could not parse that reminder time. Please try again.</b>',
                                parse_mode: 'HTML'
                            })
                        });
                    }
                } else {
                    const insertRes = await pool.query(
                        'INSERT INTO reminders (user_id, text, remind_at, recurring) VALUES ($1, $2, $3, $4) RETURNING id',
                        [userId, parsed.reminderText, parsed.date, null]
                    );

                    if (parsed.wantRepeatMenu) {
                        await sendOrUpdateDashboard(
                            userId,
                            `📝 Editing Reminder: "<b>${escapeHTML(parsed.reminderText)}</b>"\n━━━━━━━━━━━━━━━━━━\nSelect options below:`,
                            getEditMenuKeyboard(insertRes.rows[0].id, null, null)
                        );
                    }

                    const localDt = DateTime.fromJSDate(parsed.date).setZone('America/Chicago');
                    const formattedTime = localDt.toFormat("EEE, LLL d, yyyy 'at' h:mm a");

                    if (iMsgId) {
                        const editRes = await fetchWithTimeout(`https://api.telegram.org/bot${TOKEN}/editMessageText`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                inline_message_id: iMsgId,
                                text: `✅ <b>Reminder set!</b>\n📝 <i>${escapeHTML(parsed.reminderText)}</i>\n⏰ ${formattedTime}`,
                                parse_mode: 'HTML'
                            })
                        });

                        if (!editRes.ok) {
                            console.error('Failed to update inline confirmation:', await editRes.text());
                        } else {
                            setTimeout(async () => {
                                try {
                                    await fetchWithTimeout(`https://api.telegram.org/bot${TOKEN}/editMessageText`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            inline_message_id: iMsgId,
                                            text: `✅ <b>Reminder Created for ${userFirstName || 'you'}!</b>`,
                                            parse_mode: 'HTML'
                                        })
                                    });
                                } catch (err) {
                                    console.error('Failed to collapse inline creation message:', err);
                                }
                            }, 30000);
                        }
                    }
                }

            } else if (selectedResultId === 'show_reminders_dm') {
                const userTz = (await getUserTimezone(userId)) || 'America/Chicago';
                const dashData = await getRemindersDashboardData(userId, userTz, userFirstName);
                await sendOrUpdateDashboard(userId, dashData.text, dashData.keyboard);

                if (iMsgId) {
                    await fetchWithTimeout(`https://api.telegram.org/bot${TOKEN}/editMessageText`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            inline_message_id: iMsgId,
                            text: '📋 <b>Sending active reminders list to DM...</b>',
                            parse_mode: 'HTML'
                        })
                    });
                    
                    setTimeout(async () => {
                        try {
                            await fetchWithTimeout(`https://api.telegram.org/bot${TOKEN}/editMessageText`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    inline_message_id: iMsgId,
                                    text: '🍟 <b>Ding! Fries are done.</b>',
                                    parse_mode: 'HTML'
                                })
                            });
                        } catch (err) {
                            console.error('Failed to collapse inline DM message:', err);
                        }
                    }, 10000);
                }
            } else if (selectedResultId === 'show_reminders_inline_v6') {
                const userTz = (await getUserTimezone(userId)) || 'America/Chicago';
                const dashData = await getRemindersDashboardData(userId, userTz, userFirstName);

                if (iMsgId) {
                    const editRes = await fetchWithTimeout(`https://api.telegram.org/bot${TOKEN}/editMessageText`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            inline_message_id: iMsgId,
                            text: dashData.text,
                            reply_markup: dashData.keyboard,
                            parse_mode: 'HTML'
                        })
                    });

                    if (!editRes.ok) {
                        console.error('Failed to populate inline active reminders:', await editRes.text());
                    } else {
                        resetMenuTimer(`inline_${iMsgId}`, async () => {
                            try {
                                await fetchWithTimeout(`https://api.telegram.org/bot${TOKEN}/editMessageText`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        inline_message_id: iMsgId,
                                        text: '🫈 <b>Squatch spotted! List collapsed before anyone got proof.</b>',
                                        parse_mode: 'HTML'
                                    })
                                });
                            } catch (err) {
                                console.error('Failed to collapse inline reminders list:', err);
                            }
                        });
                    }
                } else {
                    await sendOrUpdateDashboard(userId, dashData.text, dashData.keyboard);
                }
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error('[WEBHOOK ERROR]:', error);
        res.sendStatus(500);
    }
});
