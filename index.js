const express = require('express');
const bodyParser = require('body-parser');
require('./config'); // Ensure config loads environment checks if needed

const { handleVapiWebhook } = require('./vapiHandler');
const { handleSmsReply } = require('./smsHandler');

const app = express();
app.use(bodyParser.urlencoded({ extended: false })); // Twilio sends form-urlencoded
app.use(bodyParser.json());

app.post('/vapi-webhook', handleVapiWebhook);
app.post('/twilio-sms-reply', handleSmsReply);

app.listen(process.env.PORT || 3000, () => console.log('Lead Engine Online.'));