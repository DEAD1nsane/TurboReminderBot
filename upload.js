const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const oauth2Client = new google.auth.OAuth2(
  process.env.GDRIVE_CLIENT_ID,
  process.env.GDRIVE_CLIENT_SECRET,
  'https://developers.google.com/oauthplayground'
);

oauth2Client.setCredentials({
  refresh_token: process.env.GDRIVE_REFRESH_TOKEN,
});

const drive = google.drive({ version: 'v3', auth: oauth2Client });
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
          name: `${fileName}.txt`,
          parents: [FOLDER_ID],
        },
        media: {
          mimeType: 'text/plain',
          body: fs.createReadStream(filePath),
        },
        fields: 'id',
      });
      
      console.log(`Uploaded ${fileName}.txt. File ID: ${response.data.id}`);
    } catch (error) {
      console.error(`Failed to upload ${fileName}.txt:`, error.message);
    }
  }
}

uploadFiles();