const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();

/**
 * check-tokens.js
 * Dumps all users that currently have an FCM token saved in the database.
 * Run this on the EC2 backend: node check-tokens.js
 */

async function checkTokens() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const usersWithTokens = await User.find({ fcmToken: { $exists: true, $ne: '' } })
            .select('email name role fcmToken updatedAt');

        if (usersWithTokens.length === 0) {
            console.log('\n❌ No users in the database currently have an FCM token.');
            console.log('If you just logged in, the token might have saved to a different database (e.g., local vs Atlas) if EC2 and Vercel are pointing to different MONGO_URI strings.');
        } else {
            console.log(`\n✅ Found ${usersWithTokens.length} user(s) with FCM tokens:\n`);
            usersWithTokens.forEach(u => {
                console.log(`Email: ${u.email}`);
                console.log(`Role:  ${u.role}`);
                console.log(`Token: ${u.fcmToken.slice(0, 30)}...`);
                console.log('----------------------------------------');
            });
        }

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await mongoose.disconnect();
    }
}

checkTokens();
