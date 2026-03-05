const mongoose = require('mongoose');
const User = require('./models/User');
const { sendPush } = require('./utils/firebaseService');
require('dotenv').config();

/**
 * test-push.js — Send a test push notification to a user by email.
 *
 * Usage:
 *   node test-push.js <email>
 *
 * Prerequisites:
 *   1. Log in on the frontend and allow notifications when prompted.
 *   2. The FCM token will be saved automatically — then run this script.
 */

async function testManualPush() {
    const email = process.argv[2];
    if (!email) {
        console.error('Usage: node test-push.js <email>');
        process.exit(1);
    }

    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        // fcmToken has 'select: false' in the schema, so we must explicitly request it
        const user = await User.findOne({ email }).select('+fcmToken');
        if (!user) {
            console.error(`❌ User not found: ${email}`);
            process.exit(1);
        }

        if (!user.fcmToken) {
            console.error(`❌ No FCM token for ${email}.`);
            console.error('   → Log in on the frontend and allow notifications, then try again.');
            process.exit(1);
        }

        console.log(`Sending push to ${email}...`);

        const result = await sendPush(user.fcmToken, 'newMessage', 'System (Test)');

        if (result === true) {
            console.log('✅ Push sent! Minimize your browser to see the OS notification.');
        } else if (result === 'token_expired') {
            console.error('❌ Token expired — log in on the frontend again to refresh it.');
        } else {
            console.error('❌ Push failed — check FIREBASE_* credentials in .env.');
        }
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await mongoose.disconnect();
    }
}

testManualPush();
