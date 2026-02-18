const fs = require('fs');
const path = require('path');

// Load .env manually for testing
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) {
            process.env[key.trim()] = value.trim().replace(/^"|"$/g, '');
        }
    });
}

const { validateAndCheckDistance } = require('./addressValidator');

// Mock Company Data (matches index.js placeholder)
const mockProvider = {
    lat: 38.8462,
    lng: -77.3064
    // Fairfax, VA
};
const radius = 50;

async function runTests() {
    console.log("--- STARTING ADDRESS VALIDATION TESTS ---");

    // Test 1: Valid Address in Range (Fairfax, VA)
    console.log("\nTest 1: Valid Address in Fairfax (Should PASS)");
    const result1 = await validateAndCheckDistance("4000 Chain Bridge Rd, Fairfax, VA", mockProvider, radius);
    console.log(result1);

    // Test 2: Valid Address Out of Range (Richmond, VA - approx 100 miles away)
    console.log("\nTest 2: Valid Address in Richmond (Should FAIL - Out of Range)");
    const result2 = await validateAndCheckDistance("1000 E Broad St, Richmond, VA", mockProvider, radius);
    console.log(result2);

    // Test 3: Valid Address Far Away (California)
    console.log("\nTest 3: California Address (Should FAIL - Out of Range)");
    const result3 = await validateAndCheckDistance("1 Infinite Loop, Cupertino, CA", mockProvider, radius);
    console.log(result3);

    // Test 4: Invalid/Nonsense Address
    console.log("\nTest 4: Nonsense Address (Should FAIL - Invalid)");
    const result4 = await validateAndCheckDistance("1234567890 Nonsense St, Nowhere, XX", mockProvider, radius);
    console.log(result4);
}

runTests();
