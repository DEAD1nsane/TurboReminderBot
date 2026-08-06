const express = require('express');
const chrono = require('chrono-node');
const { DateTime } = require('luxon');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

app.post('/webhook', async (req, res) => {
    console.log('Received Telegram update:', req.body);
    
    const inlineQuery = req.body.inline_query;
    if (inlineQuery) {
        const queryId = inlineQuery.id;
        const queryText = inlineQuery.query;

        let resultText = "Type a time like 'in 2 hours'";
        const parsedDate = chrono.parseDate(queryText, new Date());

        if (parsedDate) {
            const dt = DateTime.fromJSDate(parsedDate);
            resultText = `Parsed Time: ${dt.toISO()}`;
        }

        const url = `https://api.telegram.org/bot${TOKEN}/answerInlineQuery`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                inline_query_id: queryId,
                results: [{
                    type: 'article',
                    id: '1',
                    title: 'Parse Reminder',
                    input_message_content: {
                        message_text: resultText
                    }
                }]
            })
        });
    }

    res.sendStatus(200);
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
