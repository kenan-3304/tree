const express = require('express');
const twilio = require('twilio');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const client = new twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
const OWNER_PHONE = process.env.OWNER_PHONE; // The Tree Service Guy's Phone
const TWILIO_NUM = process.env.TWILIO_NUM;   // Your Twilio Number

app.post('/vapi-webhook', async (req, res) => {
    const payload = req.body.message;

    // Vapi sends "end-of-call-report" when the call finishes
    if (payload.type === 'end-of-call-report') {
        const data = payload.analysis.structuredData;
        const customerNum = payload.customer.number;

        // 1. SUCCESS BRANCH: We got the address
        if (data && data.address && data.address.length > 5) {
            const leadSummary = `✅ NEW LEAD: ${data.name || 'Unknown'} needs ${data.service_type || 'service'} at ${data.address}. Urgency: ${data.urgency || 'Normal'}.`;

            await client.messages.create({ body: leadSummary, from: TWILIO_NUM, to: OWNER_PHONE });
            console.log("Success text sent to owner.");
        }
        // 2. RESCUE BRANCH: No address (hangup/garbled)
        else {
            const rescueMsg = "Hey, this is [Company Name]. Looks like we got disconnected—what was the address for that tree work and what do you need done?";

            await client.messages.create({ body: rescueMsg, from: TWILIO_NUM, to: customerNum });
            console.log("Rescue text sent to customer.");
        }
    }
    res.sendStatus(200);
});

app.listen(process.env.PORT || 3000, () => console.log('Lead Engine Online.'));