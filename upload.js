const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const credentialsJson = Buffer.from(process.env.GOOGLE_CREDENTIALS, 'base64').toString('utf-8');
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(credentialsJson),
  scopes: ['https://www.googleapis.com/auth/drive'],
});

const drive = google.drive({ version: 'v3', auth });
const FOLDER_ID = '1mxmLCbIEepp6XJyhzZxVzBTYCcKJI6CW';
const YOUR_PERSONAL_EMAIL = 'turbolaceup@gmail.com'; // Replace with your actual Google email

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
        supportsAllDrives: true,
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
      
      // Grant explicit ownership/access permission to your personal Google account
      await drive.permissions.create({
        fileId: response.data.id,
        supportsAllDrives: true,
        requestBody: {
          role: 'writer',
          type: 'user',
          emailAddress: YOUR_PERSONAL_EMAIL,
        },
      });
      
      console.log(`Uploaded ${fileName}. File ID: ${response.data.id}`);
    } catch (error) {
      console.error(`Failed to upload ${fileName}:`, error.message);
    }
  }
}

uploadFiles();