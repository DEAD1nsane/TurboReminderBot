
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 10000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(resource, {
        ...options,
        signal: controller.signal
    });
    clearTimeout(id);
    return response;
}

async function sendTelegramMessage(chatId, text, replyMarkup = null, autoDeleteMs = null) {
    const payload = { chat_id: chatId, text, parse_mode: 'HTML' };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    try {
        const res = await fetchWithTimeout(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.ok && data.result) {
            if (autoDeleteMs) setTimeout(() => deleteTelegramMessage(chatId, data.result.message_id), autoDeleteMs);
            return data.result;
        }
    } catch (err) { console.error('Error sending message:', err); }
    return null;
}

async function editTelegramMessage(chatId, messageId, text, replyMarkup = null) {
    const payload = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' };
    if (replyMarkup !== undefined) payload.reply_markup = replyMarkup;
    try {
        const res = await fetchWithTimeout(`https://api.telegram.org/bot${TOKEN}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        return data.ok;
    } catch (err) { console.error('Error editing message:', err); return false; }
}

async function deleteTelegramMessage(chatId, messageId) {
    try {
        await fetchWithTimeout(`https://api.telegram.org/bot${TOKEN}/deleteMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, message_id: messageId })
        });
    } catch (err) { console.error('Error deleting message:', err); }
}

async function answerCallbackQuery(callbackQueryId, text = '', showAlert = false) {
    try {
        await fetchWithTimeout(`https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: showAlert })
        });
    } catch (err) { console.error('Error answering callback query:', err); }
}

module.exports = { sendTelegramMessage, editTelegramMessage, deleteTelegramMessage, answerCallbackQuery, fetchWithTimeout };
