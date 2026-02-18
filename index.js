const express = require('express');
const twilio = require('twilio');
const bodyParser = require('body-parser');
const { OpenAI } = require('openai');

const app = express();
app.use(bodyParser.urlencoded({ extended: false })); // Twilio sends form-urlencoded
app.use(bodyParser.json());

const client = new twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH);

// Initialize Supabase & OpenAI
// Initialize Redis & OpenAI
const { Redis } = require('@upstash/redis');
const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Hardcoded Values & Directory
const YOUR_844_NUMBER = '+18443336529'; // Your Toll-Free (844) Number

const { validateAndCheckDistance } = require('./addressValidator');

// Map Vapi Assistant IDs to Owner Data (Phone + Location)
const COMPANY_DIRECTORY = {
    "bb86db5d-7dcc-444f-bebd-0019265f857f": {
        ownerPhone: "+17037760484",
        // TODO: UPDATE THESE COORDINATES WITH THE REAL BUSINESS ADDRESS
        // Currently set to a central point in Fairfax, VA as a placeholder
        serviceLocation: { lat: 38.8462, lng: -77.3064 },
        radiusMiles: 50
    },
    // Add more assistants here
};

// Helper to clean "null" strings from AI
const sanitize = (value) => {
    if (!value) return null;
    if (typeof value === 'string') {
        const cleaned = value.trim();
        if (["null", "n/a", "none", "unknown", "undefined"].includes(cleaned.toLowerCase())) {
            return null;
        }
        return cleaned;
    }
    return value;
};

app.post('/vapi-webhook', async (req, res) => {
    const payload = req.body.message;

    // Vapi sends "end-of-call-report" when the call finishes
    if (payload && payload.type === 'end-of-call-report') {
        // 1. TRY ARTIFACT (Python Logic Priority)
        const artifact = payload.artifact || {};
        const structuredOutputs = artifact.structuredOutputs || {};
        let structuredData = {};

        // Iterate values (Python: structured_outputs.values())
        for (const key in structuredOutputs) {
            const output = structuredOutputs[key];
            if (output && ((output.name && output.name === "emergency_dossier") || "result" in output)) {
                structuredData = output.result || {};
                break;
            }
        }

        // 2. FALLBACK TO ANALYSIS (Legacy/Standard)
        if (Object.keys(structuredData).length === 0) {
            const analysis = payload.analysis || {};
            structuredData = analysis.structuredData || {};

            // Handle nested UUID (Legacy Fix: "uuid": { "result": ... })
            if (!structuredData.address) {
                // Check if any key has a .result property
                for (const key in structuredData) {
                    if (structuredData[key] && structuredData[key].result) {
                        structuredData = structuredData[key].result;
                        break;
                    }
                }
            }
        }

        const callData = payload.call || {};
        const customer = callData.customer || {};

        // 1. EXTRACT DATA & SANITIZE
        const address = sanitize(structuredData.address);
        const name = sanitize(structuredData.name) || 'Unknown';
        const urgency = sanitize(structuredData.urgency) || 'Normal';
        const serviceType = sanitize(structuredData.service_type) || 'service';

        // Smart Phone Number Logic
        const extractedPhone = sanitize(structuredData.callback_number);
        const callerId = sanitize(customer.number);
        const dialedNumber = callData.phone_number || ''; // The Vapi number called

        let phoneNumber = callerId;
        // If extractedPhone looks like a real number (7+ digits), prefer it
        if (extractedPhone && /\d{7,}/.test(extractedPhone)) {
            phoneNumber = extractedPhone;
        }

        // 2. LOGIC BRANCHES

        // GHOST CALL CHECK: If no address AND no valid phone, skip
        if (!address && !phoneNumber) {
            console.log("Skipping Ghost Call: No Address and No Phone Number.");
            return res.sendStatus(200);
        }

        // SCENARIO A: SUCCESS - We have an address
        if (address && address.length > 5) {
            const leadSummary = `✅ NEW LEAD: ${name} needs ${serviceType} at ${address}. Urgency: ${urgency}. Phone: ${phoneNumber}. Called: ${dialedNumber}`;

            // Determine Recipient based on Assistant ID
            const assistantId = callData.assistantId;
            const companyData = COMPANY_DIRECTORY[assistantId];

            if (companyData) {
                // Perform Address Validation & Radius Check
                const validationResult = await validateAndCheckDistance(
                    address,
                    companyData.serviceLocation,
                    companyData.radiusMiles
                );

                if (validationResult.valid) {
                    // SCENARIO A: SUCCESS - Valid & In Range
                    const mapsLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(validationResult.formattedAddress)}`;
                    const leadSummary = `✅ NEW LEAD: ${name} needs ${serviceType} at ${validationResult.formattedAddress}. Urgency: ${urgency}. Phone: ${phoneNumber}. Distance: ${validationResult.distanceMiles}mi.\n\n📍 Map: ${mapsLink}`;

                    try {
                        // Send details to the business owner
                        await client.messages.create({
                            body: leadSummary,
                            from: YOUR_844_NUMBER,
                            to: companyData.ownerPhone
                        });
                        console.log(`Success text sent to owner (${companyData.ownerPhone}).`);
                    } catch (e) {
                        console.error("Error sending success text:", e);
                    }
                } else {
                    // SCENARIO C: OUT OF RANGE OR INVALID - Treat as rescue/clarification needed
                    console.log(`Address validation failed: ${validationResult.reason} (Input: ${address})`);

                    // Fallback to Rescue Flow (but maybe with specific message?)
                    // For now, let's treat it like a missing address so we can confirm details via text
                    // We can reuse the rescue logic below, or duplicate it. 
                    // Let's modify the flow to falling through to rescue if validation fails?
                    // actually, better to handle it explicitly here to avoid clutter.

                    const issueMsg = validationResult.reason === "OUT_OF_SERVICE_AREA"
                        ? `Hey! It looks like that address might be a bit far (${validationResult.distanceMiles} miles). Just to confirm, are you located at ${validationResult.formattedAddress}?`
                        : "Hey! We couldn't quite verify that address. Could you text us your street address again so we can get you a quote?";

                    try {
                        await client.messages.create({
                            body: issueMsg,
                            from: YOUR_844_NUMBER,
                            to: phoneNumber
                        });
                        console.log(`Validation issue text sent to customer (${phoneNumber}).`);

                        // SAVE TO REDIS (24h Expiry)
                        const redisValue = JSON.stringify({
                            ownerPhone: companyData.ownerPhone,
                            dialedNumber
                        });
                        await redis.set(phoneNumber, redisValue, { ex: 86400 });

                    } catch (e) {
                        console.error("Error sending validation issue text:", e);
                    }
                }

            } else {
                console.log(`No owner found for Assistant ID: ${assistantId}`);
            }
        }

        // SCENARIO B: RESCUE - Address is missing
        else {
            const rescueMsg = "Hey! We missed the address on that call. Where is the tree located so we can get you a quote?";

            // Determine Recipient based on Assistant ID
            const assistantId = callData.assistantId;
            const companyData = COMPANY_DIRECTORY[assistantId];
            const ownerPhone = companyData ? companyData.ownerPhone : null;

            try {
                // Send rescue text to the customer
                await client.messages.create({
                    body: rescueMsg,
                    from: YOUR_844_NUMBER,
                    to: phoneNumber
                });
                console.log(`Rescue text sent to customer (${phoneNumber}).`);

                // SAVE TO REDIS (24h Expiry)
                if (ownerPhone) {
                    // Store as JSON to include dialed number for tracking
                    const redisValue = JSON.stringify({ ownerPhone, dialedNumber });
                    await redis.set(phoneNumber, redisValue, { ex: 86400 });
                    console.log(`Saved pending rescue to Redis for ${phoneNumber} (Owner: ${ownerPhone}, Dialed: ${dialedNumber}).`);
                }

            } catch (e) {
                console.error("Error sending rescue text:", e);
            }
        }
    }

    res.sendStatus(200);
});

app.listen(process.env.PORT || 3000, () => console.log('Lead Engine Online.'));

// NEW: Handle SMS Replies
app.post('/twilio-sms-reply', async (req, res) => {
    const customerMsg = req.body.Body;
    const customerPhone = req.body.From;

    console.log(`Received SMS from ${customerPhone}: ${customerMsg}`);

    // 1. Lookup Owner in Redis
    const redisData = await redis.get(customerPhone);

    if (!redisData) {
        console.log("No pending rescue found for this number.");
        return res.sendStatus(200);
    }

    // Parse JSON data (backwards compatibility check for plain string not strictly necessary if we just deployed, but good practice if mixed data existed, assuming fresh start though)
    let ownerPhone;
    let dialedNumber;

    try {
        const parsed = JSON.parse(redisData);
        ownerPhone = parsed.ownerPhone;
        dialedNumber = parsed.dialedNumber;
    } catch (e) {
        // Fallback if it was just a plain string (legacy)
        ownerPhone = redisData;
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
});