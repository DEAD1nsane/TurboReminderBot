const express = require('express');
const chrono = require('chrono-node');
const { DateTime } = require('luxon');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

app.post('/webhook', async (req, res) => {
    console.log('Received Telegram update:', req.body);
    
    const message = req.body.message;
    if (message && message.text) {
        const chatId = message.chat.id;
        const text = message.text;

        const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: `You said: ${text}`
            })
        });
    }

    res.sendStatus(200);
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
