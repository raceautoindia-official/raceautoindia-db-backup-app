// test-drive-upload-delete.js
const fs = require("fs");
const path = require("path");
const os = require("os");
const { google } = require("googleapis");

// ====== CONFIG ======
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const KEYFILEPATH = path.join(__dirname, "credentials.json");

// Put your Google Drive folder ID here (same you used)
const DRIVE_FOLDER_ID = "1UMh4q5aYGjy_X_9YqhcbtAEdS0m5tmg8";

// ====== GOOGLE DRIVE SETUP ======
const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILEPATH,
  scopes: SCOPES,
});
const drive = google.drive({ version: "v3", auth });

// Create a simple local test file
function createLocalTestFile() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `test_upload_${ts}.txt`;
  const filePath = path.join(os.tmpdir(), fileName);

  const content = `Test upload file\nCreated at: ${new Date().toString()}\n`;
  fs.writeFileSync(filePath, content, "utf8");

  console.log("✅ Local test file created:", filePath);
  return { filePath, fileName };
}

// Upload the file to Drive folder and return uploaded fileId
async function uploadToDrive(filePath, fileName) {
  const fileMetadata = {
    name: fileName,
    parents: [DRIVE_FOLDER_ID],
  };

  const media = {
    mimeType: "text/plain",
    body: fs.createReadStream(filePath),
  };

  const res = await drive.files.create({
    resource: fileMetadata,
    media,
    fields: "id,name,createdTime",
  });

  console.log("✅ Uploaded to Drive:", res.data);
  return res.data.id;
}

// Delete the uploaded file from Drive
async function deleteFromDrive(fileId) {
  await drive.files.delete({ fileId });
  console.log("🗑️ Deleted from Drive fileId:", fileId);
}

// Main test run
(async function runTest() {
  try {
    const { filePath, fileName } = createLocalTestFile();

    const fileId = await uploadToDrive(filePath, fileName);

    // Delete local temp file after upload (optional, but nice)
    try {
      fs.unlinkSync(filePath);
      console.log("🧹 Local temp file deleted:", filePath);
    } catch (e) {
      console.log("⚠️ Could not delete local file:", e.message);
    }

    console.log("⏳ Waiting 1 minute, then deleting from Drive...");

    setTimeout(async () => {
      try {
        await deleteFromDrive(fileId);
        console.log("✅ Test complete: upload + delete verified.");
      } catch (err) {
        console.error("❌ Failed to delete from Drive:", err?.message || err);
      }
    }, 60 * 1000);

  } catch (err) {
    console.error("❌ Test failed:", err?.message || err);
  }
})();
