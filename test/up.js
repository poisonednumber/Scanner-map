const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

const API_KEY = '12345'; // Replace with your actual API key
const UPLOAD_URL = 'http://localhost:3306/api/call-upload';

// Function to upload a single file
async function uploadFile(filePath) {
  const form = new FormData();
  const stats = fs.statSync(filePath);
  const fileSizeInBytes = stats.size;
  const fileStream = fs.createReadStream(filePath);

  form.append('file', fileStream, { knownLength: fileSizeInBytes });
  form.append('key', API_KEY);
  form.append('talkgroup', '1234'); // Replace with an appropriate talkgroup ID
  form.append('dateTime', Math.floor(Date.now() / 1000).toString());
  form.append('systemLabel', 'Test System');
  form.append('talkgroupLabel', 'Test Talkgroup');
  form.append('source', 'Manual Upload');

  try {
    const response = await axios.post(UPLOAD_URL, form, {
      headers: {
        ...form.getHeaders(),
        'Content-Length': form.getLengthSync()
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    console.log(`Uploaded ${path.basename(filePath)}: ${response.data}`);
  } catch (error) {
    console.error(`Error uploading ${path.basename(filePath)}:`, error.message);
  }
}

// Function to process all MP3 files in the current directory
async function processDirectory() {
  const files = fs.readdirSync(__dirname);
  const mp3Files = files.filter(file => path.extname(file).toLowerCase() === '.mp3');

  for (const file of mp3Files) {
    await uploadFile(path.join(__dirname, file));
  }
}

// Run the script
processDirectory().then(() => console.log('All files processed'));