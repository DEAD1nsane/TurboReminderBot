const express = require('express');
const chrono = require('chrono-node');
const { DateTime } = require('luxon');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

app.post('/webhook', async (req, res) => {
    const inlineQuery = req.body.inline_query;
    if (inlineQuery) {
        const queryId = inlineQuery.id;
        const queryText = inlineQuery.query.trim();

        let resultText = "Type a time like '5m' or 'in 2 hours'";
        if (queryText) {
            const parsedDate = chrono.parseDate(queryText, new Date());
            if (parsedDate) {
                const dt = DateTime.fromJSDate(parsedDate);
                resultText = `Parsed Time: ${dt.toFormat('ff')}`;
            } else {
                resultText = `Could not parse time from: "${queryText}"`;
            }
        }

        const url = `https://api.telegram.org/bot${TOKEN}/answerInlineQuery`;
        try {
            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    inline_query_id: queryId,
                    results: [{
                        type: 'article',
                        id: String(Date.now()),
                        title: 'Reminder Preview',
                        description: resultText,
                        input_message_content: {
                            message_text: resultText
                        }
                    }],
                    cache_time: 0
                })
            });
        } catch (err) {
            console.error('Error answering inline query:', err);
        }
    }

    res.sendStatus(200);
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
