const axios = require('axios');

/**
 * Calculates the distance between two points (lat/lng) in miles using the Haversine formula.
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} Distance in miles
 */
function getDistanceFromLatLonInMiles(lat1, lon1, lat2, lon2) {
    const R = 3958.8; // Radius of the earth in miles
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

/**
 * Validates an address using Google Address Validation API and checks if it's within the service radius.
 * @param {string} address - The address string to validate.
 * @param {object} providerLocation - { lat: number, lng: number } of the service provider.
 * @param {number} maxRadiusMiles - Maximum allowed distance in miles.
 * @returns {Promise<object>} - { valid: boolean, reason: string, formattedAddress: string, distanceMiles: number }
 */
async function validateAndCheckDistance(address, providerLocation, maxRadiusMiles) {
    const apiKey = process.env.GOOGLE_ADDRESS_VALIDATION_API;

    if (!address || !apiKey) {
        console.error("Missing address or Google API Key");
        return { valid: false, reason: "CONFIG_ERROR" };
    }

    try {
        const response = await axios.post(
            `https://addressvalidation.googleapis.com/v1:validateAddress?key=${apiKey}`,
            {
                address: {
                    regionCode: "US",
                    addressLines: [address]
                }
            }
        );

        const result = response.data.result;

        // 1. Check if potential address
        if (!result || !result.verdict) {
            return { valid: false, reason: "API_ERROR" };
        }

        // Basic check: Is it considered a complete or usable address?
        const isComplete = result.verdict.addressComplete;
        const hasUnconfirmedComponents = result.verdict.hasUnconfirmedComponents;

        if (!isComplete && hasUnconfirmedComponents) {
            return { valid: false, reason: "INCOMPLETE_ADDRESS", formattedAddress: result.address?.formattedAddress };
        }

        // 2. Get Geolocation
        const location = result.geocode?.location;
        if (!location) {
            return { valid: false, reason: "NO_LOCATION_FOUND", formattedAddress: result.address?.formattedAddress };
        }

        // 3. Radius Check
        const distance = getDistanceFromLatLonInMiles(
            location.latitude,
            location.longitude,
            providerLocation.lat,
            providerLocation.lng
        );

        const formattedAddress = result.address?.formattedAddress || address;

        console.log(`Address: ${formattedAddress} | Distance: ${distance.toFixed(2)} miles (Limit: ${maxRadiusMiles})`);

        if (distance <= maxRadiusMiles) {
            return {
                valid: true,
                formattedAddress: formattedAddress,
                distanceMiles: distance.toFixed(1)
            };
        } else {
            return {
                valid: false,
                reason: "OUT_OF_SERVICE_AREA",
                formattedAddress: formattedAddress,
                distanceMiles: distance.toFixed(1)
            };
        }

    } catch (error) {
        console.error("Address Validation Error:", error.response ? error.response.data : error.message);
        // Fallback: If API fails, we might want to allow it manually or fail safe. 
        // For now, let's treat API error as a non-validated address (rescue flow).
        return { valid: false, reason: "API_EXCEPTION" };
    }
}

module.exports = { validateAndCheckDistance };
