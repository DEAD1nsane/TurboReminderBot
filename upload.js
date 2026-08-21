require('dotenv').config(); // 👈 Added this to load process.env variables
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

// Helper to translate '~' into the actual Termux home path
const expandHome = (filepath) =>
  filepath.startsWith('~') ? filepath.replace('~', process.env.HOME) : filepath;

// 1. Specify exact local paths, Drive names, and MIME types here
const filesToUpload = [
  { localPath: path.join(__dirname, 'index.js'), driveName: 'index.js.txt', mimeType: 'text/plain' },
  { localPath: path.join(__dirname, 'keyboards.js'), driveName: 'keyboards.js.txt', mimeType: 'text/plain' },
  { localPath: path.join(__dirname, 'telegram.js'), driveName: 'telegram.js.txt', mimeType: 'text/plain' },
  { localPath: expandHome('~/storage/shared/Backups/Termux/.termux.properties.txt'), driveName: '.termux.properties.txt', mimeType: 'text/plain' },
  { localPath: expandHome('~/storage/shared/Backups/Termux/.zshrc.txt'), driveName: '.zshrc.txt', mimeType: 'text/plain' },
  { localPath: expandHome('~/storage/shared/Backups/Termux/init.lua.txt'), driveName: 'init.lua.txt', mimeType: 'text/plain' },
  { localPath: expandHome('~/storage/shared/Backups/Termux/darkblood.zsh-theme.txt'), driveName: 'darkblood.zsh-theme.txt', mimeType: 'text/plain' }
];

async function uploadFiles() {
  for (const file of filesToUpload) {
    if (!fs.existsSync(file.localPath)) {
      console.log(`Skipping ${file.driveName}: File not found at ${file.localPath}`);
      continue;
    }
    
    try {
      const listResponse = await drive.files.list({
        q: `name = '${file.driveName}' and '${FOLDER_ID}' in parents and trashed = false`,
        fields: 'files(id, name)',
        spaces: 'drive',
      });
      
      const existingFiles = listResponse.data.files || [];
      
      if (existingFiles.length > 0) {
        const fileId = existingFiles[0].id;
        const response = await drive.files.update({
          fileId: fileId,
          media: {
            mimeType: file.mimeType, // 2. Uses the correct MIME type
            body: fs.createReadStream(file.localPath),
          },
          fields: 'id',
        });
        
        console.log(`Updated existing ${file.driveName}. File ID: ${response.data.id}`);
      } else {
        const response = await drive.files.create({
          requestBody: {
            name: file.driveName, // 3. Uses the correct Drive name
            parents: [FOLDER_ID],
          },
          media: {
            mimeType: file.mimeType,
            body: fs.createReadStream(file.localPath),
          },
          fields: 'id',
        });
        
        console.log(`Uploaded new ${file.driveName}. File ID: ${response.data.id}`);
      }
    } catch (error) {
      console.error(`Failed to upload ${file.driveName}:`, error.message);
    }
  }
}

uploadFiles();