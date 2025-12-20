const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

const API_KEY = 'c4c5f9e2-1698-4ebe-98f0-33656e313cb3'; // Replace with your actual API key
const UPLOAD_URL = 'http://localhost:3306/api/call-upload';

// Function to upload a single file
async function uploadFile(filePath) {
  const form = new FormData();
  const stats = fs.statSync(filePath);
  const fileSizeInBytes = stats.size;
  const fileStream = fs.createReadStream(filePath);
  const fileExtension = path.extname(filePath).toLowerCase();

  form.append('file', fileStream, { knownLength: fileSizeInBytes });
  form.append('key', API_KEY);
  form.append('talkgroup', '4005'); // Replace with an appropriate talkgroup ID
  form.append('dateTime', Math.floor(Date.now() / 1000).toString());
  form.append('systemLabel', 'Test System');
  form.append('talkgroupLabel', 'Test Talkgroup');
  
  // Add source information - use different identifier for M4A files if needed
  if (fileExtension === '.m4a') {
    form.append('source', 'TR-1234'); // You can customize the source ID for M4A files
  } else {
    form.append('source', 'Manual Upload');
  }

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
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

// Function to process all audio files in the current directory
async function processDirectory() {
  const files = fs.readdirSync(__dirname);
  // Filter for both MP3 and M4A files
  const audioFiles = files.filter(file => {
    const ext = path.extname(file).toLowerCase();
    return ext === '.mp3' || ext === '.m4a';
  });

  if (audioFiles.length === 0) {
    console.log('No MP3 or M4A files found in the current directory.');
    return;
  }

  console.log(`Found ${audioFiles.length} audio files to process.`);
  
  for (const file of audioFiles) {
    console.log(`Processing: ${file}`);
    await uploadFile(path.join(__dirname, file));
  }
}

// Run the script
processDirectory()
  .then(() => console.log('All files processed'))
  .catch(err => console.error('Error processing files:', err));