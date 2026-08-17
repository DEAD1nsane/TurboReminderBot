const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/drive.file'],
});

const drive = google.drive({ version: 'v3', auth });
const FOLDER_ID = '1mxmLCbIEepp6XJyhzZxVzBTYCcKJI6CW';

const filesToUpload = ['index.js', 'keyboards.js', 'telegram.js'];

async function uploadFiles() {
  for (const fileName of filesToUpload) {
    const filePath = path.join(__dirname, fileName);
    
    if (!fs.existsSync(filePath)) {
      console.log(`Skipping ${fileName}: File not found.`);
      continue;
    }
    
    try {
      const response = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [FOLDER_ID],
        },
        media: {
          mimeType: 'application/javascript',
          body: fs.createReadStream(filePath),
        },
        fields: 'id',
      });
      
      console.log(`Uploaded ${fileName}. File ID: ${response.data.id}`);
    } catch (error) {
      console.error(`Failed to upload ${fileName}:`, error.message);
    }
  }
}

uploadFiles();