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
    const driveName = `${fileName}.txt`;
    
    if (!fs.existsSync(filePath)) {
      console.log(`Skipping ${fileName}: File not found.`);
      continue;
    }
    
    try {
      // 1. Search if the file already exists in the target folder
      const listResponse = await drive.files.list({
        q: `name = '${driveName}' and '${FOLDER_ID}' in parents and trashed = false`,
        fields: 'files(id, name)',
        spaces: 'drive',
      });
      
      const existingFiles = listResponse.data.files || [];
      
      if (existingFiles.length > 0) {
        // 2. If it exists, update the content of the existing file
        const fileId = existingFiles[0].id;
        const response = await drive.files.update({
          fileId: fileId,
          media: {
            mimeType: 'text/plain',
            body: fs.createReadStream(filePath),
          },
          fields: 'id',
        });
        
        console.log(`Updated existing ${driveName}. File ID: ${response.data.id}`);
      } else {
        // 3. If it does not exist, create a new file
        const response = await drive.files.create({
          requestBody: {
            name: driveName,
            parents: [FOLDER_ID],
          },
          media: {
            mimeType: 'text/plain',
            body: fs.createReadStream(filePath),
          },
          fields: 'id',
        });
        
        console.log(`Uploaded new ${driveName}. File ID: ${response.data.id}`);
      }
    } catch (error) {
      console.error(`Failed to upload ${driveName}:`, error.message);
    }
  }
}

uploadFiles();