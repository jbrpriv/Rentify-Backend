const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();

async function checkTokens() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const specificUser = await User.findOne({ email: 'abdullahmux5@gmail.com' })
            .select('email name role fcmToken updatedAt');

        if (specificUser) {
            console.log('\n--- abdullahmux5@gmail.com ---');
            console.log(specificUser);
            console.log('fcmToken type:', typeof specificUser.fcmToken);
            console.log('fcmToken value:', specificUser.fcmToken);
        } else {
            console.log('User not found in this database!');
        }

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await mongoose.disconnect();
    }
}

checkTokens();
