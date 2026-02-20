const { validateAndCheckDistance } = require('./addressValidator');
const { client, redis, YOUR_844_NUMBER, COMPANY_DIRECTORY } = require('./config');

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

const handleVapiWebhook = async (req, res) => {
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
        if (extractedPhone && /\\d{7,}/.test(extractedPhone)) {
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
};

module.exports = { handleVapiWebhook };
