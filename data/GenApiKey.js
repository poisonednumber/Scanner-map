// GenApiKey.js
const bcrypt = require('bcrypt');

const apiKey = '12345'; // Replace with your actual API key

bcrypt.hash(apiKey, 10, (err, hash) => {
    if (err) {
        console.error('Error hashing API key:', err);
    } else {
        console.log('Hashed API key:', hash);
    }
});
