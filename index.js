const { spawn } = require("child_process");
const fs = require("fs");
const { google } = require("googleapis");
const path = require("path");
const os = require("os");
const cron = require("node-cron");
require('dotenv').config()

// ====== CONFIG ======
const BACKUP_FOLDER_ID = "1UMh4q5aYGjy_X_9YqhcbtAEdS0m5tmg8"; // Drive folder ID
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const KEYFILEPATH = path.join(__dirname, "credentials.json");

// MySQL credentials (better: use env vars)
const dbUser =process.env.DB_USER;
const dbPass = process.env.DB_PASS;
const dbName = process.env.DB_NAME;

// ====== GOOGLE DRIVE SETUP ======
const auth = new google.auth.GoogleAuth({ keyFile: KEYFILEPATH, scopes: SCOPES });
const drive = google.drive({ version: "v3", auth });

// Upload to Drive
async function uploadToDrive(filePath) {
  const fileMetadata = {
    name: path.basename(filePath),
    parents: [BACKUP_FOLDER_ID],
  };

  const media = {
    mimeType: "application/sql",
    body: fs.createReadStream(filePath),
  };

  try {
    const res = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: "id",
    });
    console.log("✅ File uploaded to Drive:", res.data.id);
  } catch (err) {
    console.error("❌ Error uploading to Drive:", err);
  }
}

// Keep only the newest N backups in Drive (default: 1). Deletes older backups.
async function keepOnlyNewestDriveBackups(keep = 1) {
  try {
    const listRes = await drive.files.list({
      q: `'${BACKUP_FOLDER_ID}' in parents and trashed=false`,
      fields: "files(id,name,createdTime)",
      pageSize: 1000,
    });

    const files = (listRes.data.files || [])
      .filter((f) => f.name?.startsWith("db_backup_") && f.name?.endsWith(".sql") && f.createdTime)
      .sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime)); // newest first

    if (files.length <= keep) {
      console.log(`🧼 Nothing to delete. Backups in Drive: ${files.length} (keep=${keep}).`);
      return;
    }

    const toDelete = files.slice(keep);
    console.log(`🗑️ Deleting ${toDelete.length} older backup(s), keeping newest ${keep}...`);

    for (const f of toDelete) {
      try {
        await drive.files.delete({ fileId: f.id });
        console.log("✅ Deleted:", f.name, "|", f.id);
      } catch (delErr) {
        console.error("⚠️ Failed to delete:", f.name, delErr.message || delErr);
      }
    }
  } catch (err) {
    console.error("❌ Error while keeping only newest backups:", err);
  }
}



// Delete Drive backups older than N days (default: 30 days)
async function deleteOldDriveBackups(daysToKeep = 30) {
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);

  try {
    // List files in the folder (only not-trashed)
    const listRes = await drive.files.list({
      q: `'${BACKUP_FOLDER_ID}' in parents and trashed=false`,
      fields: "files(id,name,createdTime)",
      pageSize: 1000,
    });

    const files = listRes.data.files || [];
    const candidates = files.filter((f) => {
      // Optional filter: only delete your backup naming pattern
      const isBackup = f.name && f.name.startsWith("db_backup_") && f.name.endsWith(".sql");
      const created = f.createdTime ? new Date(f.createdTime) : null;
      return isBackup && created && created < cutoff;
    });

    if (!candidates.length) {
      console.log("🧼 No old backups to delete (older than", daysToKeep, "days).");
      return;
    }

    console.log(`🗑️ Deleting ${candidates.length} old backup(s) from Drive...`);

    for (const f of candidates) {
      try {
        await drive.files.delete({ fileId: f.id });
        console.log("✅ Deleted:", f.name, "|", f.id);
      } catch (delErr) {
        console.error("⚠️ Failed to delete:", f.name, delErr.message || delErr);
      }
    }
  } catch (err) {
    console.error("❌ Error while cleaning old Drive backups:", err);
  }
}

// Create MySQL backup using spawn (more reliable than exec)
function createMysqlBackup(filePath) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(filePath);

    const dump = spawn("mysqldump", ["-u", dbUser, `-p${dbPass}`, dbName], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    dump.stdout.pipe(out);

    let errText = "";
    dump.stderr.on("data", (d) => (errText += d.toString()));

    dump.on("close", (code) => {
      out.close();
      if (code === 0) return resolve();
      reject(new Error(`mysqldump failed (code ${code}): ${errText}`));
    });
  });
}

// Create + cleanup old + upload + delete local temp
async function createAndUploadBackup() {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-"); // unique + filename-safe
  const fileName = `db_backup_${ts}.sql`;
  const filePath = path.join(os.tmpdir(), fileName);

  try {
    console.log("📦 Creating backup...");
    await createMysqlBackup(filePath);
    console.log("✅ Backup created at:", filePath);

    await uploadToDrive(filePath);

    // keep only latest 5 backups in Drive
    await keepOnlyNewestDriveBackups(5);

  } catch (err) {
    console.error("❌ Backup process failed:", err.message || err);
  } finally {
    fs.unlink(filePath, (unlinkErr) => {
      if (unlinkErr) console.log("ℹ️ Temp file cleanup:", unlinkErr.message || unlinkErr);
      else console.log("🧹 Temporary backup file deleted.");
    });
  }
}


// 🕒 Every 2 hours (minute 0) - server time
cron.schedule("0 */2 * * *", () => {
  console.log("🚀 Running backup (every 2 hours) + keep only latest Drive backup...");
  createAndUploadBackup();
});

console.log("🗓️ Cron job scheduled: every 2 hours at minute 0 (server time).");

