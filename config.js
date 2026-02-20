const twilio = require('twilio');
const { Redis } = require('@upstash/redis');
const { OpenAI } = require('openai');

const client = new twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH);

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Hardcoded Values & Directory
const YOUR_844_NUMBER = '+18443336529'; // Your Toll-Free (844) Number

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

module.exports = {
    client,
    redis,
    openai,
    YOUR_844_NUMBER,
    COMPANY_DIRECTORY
};
