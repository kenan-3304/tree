const { handleVapiWebhook } = require('./vapiHandler');
// mock req, res
const req = {
    body: {
        message: {
            type: 'end-of-call-report',
            artifact: {
                structuredOutputs: {
                    some_key: {
                        name: "emergency_dossier",
                        result: {
                            address: "123 Main St",
                            name: "John Doe",
                            urgency: "High",
                            service_type: "Tree Removal"
                        }
                    }
                }
            },
            call: {
                customer: { number: "+15551234567" },
                phone_number: "+18443336529",
                assistantId: "bb86db5d-7dcc-444f-bebd-0019265f857f"
            }
        }
    }
};

let statusSpy = 0;
const res = {
    sendStatus: (code) => {
        statusSpy = code;
        console.log("Response Sent:", code);
    }
};

async function run() {
    try {
        await handleVapiWebhook(req, res);
        console.log("Mock completed");
    } catch (e) {
        console.error(e);
    }
}
run();
