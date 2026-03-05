const mongoose = require('mongoose');
const User = require('./models/User');
const { sendPush } = require('./utils/firebaseService');
require('dotenv').config();

/**
 * test-push.js — Manual push notification tester
 *
 * Usage:
 *   node test-push.js <email>                           # Send push to existing token
 *   node test-push.js <email> --set-token <fcmToken>   # Save token to DB then send push
 *
 * Example:
 *   node test-push.js abdullahmux5@gmail.com --set-token "fsZiYTmbb1RJLA4kO9..."
 */

async function testManualPush() {
    const email = process.argv[2];
    const setFlag = process.argv.indexOf('--set-token');
    const newToken = setFlag !== -1 ? process.argv[setFlag + 1] : null;

    if (!email) {
        console.error('Usage: node test-push.js <email> [--set-token <token>]');
        process.exit(1);
    }

    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const user = await User.findOne({ email });
        if (!user) {
            console.error(`User ${email} not found`);
            process.exit(1);
        }

        // Directly save the token if --set-token was provided
        if (newToken) {
            await User.findByIdAndUpdate(user._id, { fcmToken: newToken });
            console.log(`✅ Token saved for ${email}`);
            user.fcmToken = newToken;
        }

        if (!user.fcmToken) {
            console.error(`User ${email} has no fcmToken.`);
            console.log('Tip: run with --set-token <token> to set one directly.');
            console.log('Get your token from the browser console on your Vercel URL.');
            process.exit(1);
        }

        console.log(`Sending test push to ${email}...`);
        console.log(`Token: ${user.fcmToken.slice(0, 30)}...`);

        const success = await sendPush(user.fcmToken, 'newMessage', 'System (Test)');

        if (success === true) {
            console.log('✅ Push sent! Check your browser/device for the notification.');
        } else if (success === 'token_expired') {
            console.log('❌ Token expired/invalid. Log in on the frontend again to refresh it.');
        } else {
            console.log('❌ Failed — check FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL in your .env.');
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await mongoose.disconnect();
    }
}

testManualPush();
