const twilio = require('twilio');
const mockClient = {
  messages: {
    create: function(opts) {
      if (!opts.to || typeof opts.to !== 'string') {
        throw new Error("A 'To' phone number is required.");
      }
      return Promise.resolve();
    }
  }
};
const redisData = { ownerPhone: "+17037760484", dialedNumber: "+18443336529" };

let ownerPhone;
try {
    const parsed = JSON.parse(redisData);
    ownerPhone = parsed.ownerPhone;
} catch (e) {
    ownerPhone = redisData;
}
console.log("ownerPhone is:", ownerPhone, typeof ownerPhone);

try {
    mockClient.messages.create({ to: ownerPhone });
} catch (e) {
    console.error(e.message);
}
