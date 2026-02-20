const { client, redis, openai, YOUR_844_NUMBER } = require('./config');

const handleSmsReply = async (req, res) => {
    const customerMsg = req.body.Body;
    const customerPhone = req.body.From;

    console.log(`Received SMS from ${customerPhone}: ${customerMsg}`);

    // 1. Lookup Owner in Redis
    const redisData = await redis.get(customerPhone);

    if (!redisData) {
        console.log("No pending rescue found for this number.");
        return res.sendStatus(200);
    }

    let ownerPhone;
    let dialedNumber;

    // Fix for "A 'To' phone number is required"
    // Upstash Redis automatically parses JSON if the value is a JSON string.
    if (typeof redisData === 'object' && redisData !== null) {
        ownerPhone = redisData.ownerPhone;
        dialedNumber = redisData.dialedNumber;
    } else {
        try {
            const parsed = JSON.parse(redisData);
            ownerPhone = parsed.ownerPhone;
            dialedNumber = parsed.dialedNumber;
        } catch (e) {
            // Fallback if it was just a plain string (legacy)
            ownerPhone = redisData;
        }
    }

    // 2. Ask OpenAI to extract address
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "Extract the property address from the user's text. If no address is found, return 'NONE'. If found, return ONLY the address." },
                { role: "user", content: customerMsg }
            ]
        });

        const extractedAddress = completion.choices[0].message.content.trim();

        if (extractedAddress !== "NONE") {
            // 3. SUCCESS: Address Found

            // Notify Owner
            await client.messages.create({
                body: `✅ SMS LEAD RECOVERY: Customer (${customerPhone}) provided address: ${extractedAddress}. Message: "${customerMsg}"`,
                from: YOUR_844_NUMBER,
                to: ownerPhone
            });

            // Confirm to Customer
            await client.messages.create({
                body: "Got it! I've passed that address to the owner. He'll reach out shortly.",
                from: YOUR_844_NUMBER,
                to: customerPhone
            });

            // Cleanup: Remove from Redis
            await redis.del(customerPhone);

            console.log(`Recovered lead sent to ${ownerPhone}. Record deleted.`);

        } else {
            // 4. FAIL: No Address Found
            await client.messages.create({
                body: "I didn't quite catch the address. Could you please text the street address so we can get that quote started?",
                from: YOUR_844_NUMBER,
                to: customerPhone
            });
            console.log("AI could not find address. Asked again.");
        }

    } catch (e) {
        console.error("Error in SMS Reply Handler:", e);
    }

    res.sendStatus(200);
};

module.exports = { handleSmsReply };
