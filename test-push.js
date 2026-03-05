const mongoose = require('mongoose');
const User = require('./models/User');
const { sendPush } = require('./utils/firebaseService');
require('dotenv').config();

/**
 * test-push.js
 * Use this to manually test if push notifications reach a specific user.
 * 
 * Usage: 
 * 1. Log into the frontend and allow notifications.
 * 2. Find your email and run:
 *    node test-push.js your-email@example.com
 */

async function testManualPush() {
    const email = process.argv[2];
    if (!email) {
        console.error('Usage: node test-push.js <user-email>');
        process.exit(1);
    }

    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const user = await User.findOne({ email });
        if (!user) {
            console.error(`User ${email} not found`);
            process.exit(1);
        }

        if (!user.fcmToken) {
            console.error(`User ${email} has no fcmToken. Did you log in and allow notifications on the frontend?`);
            console.log('Current user data:', { id: user._id, email: user.email, hasToken: !!user.fcmToken });
            process.exit(1);
        }

        console.log(`Sending test push to ${email}...`);
        console.log(`Token: ${user.fcmToken.slice(0, 20)}...`);

        // Using the 'newMessage' template as a test
        const success = await sendPush(user.fcmToken, 'newMessage', 'System Admin (Test)');

        if (success === true) {
            console.log('✅ Push sent successfully!');
        } else if (success === 'token_expired') {
            console.log('❌ Failed: Token is expired or invalid.');
        } else {
            console.log('❌ Failed: Check backend logs for errors.');
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await mongoose.disconnect();
    }
}

testManualPush();
