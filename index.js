const express = require('express');
const chrono = require('chrono-node');
const { DateTime } = require('luxon');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

app.post('/webhook', (req, res) => {
    console.log('Received Telegram update:', req.body);
    res.sendStatus(200);
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
