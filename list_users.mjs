import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import os from "os";

const configPath = path.join(os.homedir(), ".config", "configstore", "firebase-tools.json");
if (!fs.existsSync(configPath)) {
  console.error("Firebase CLI config not found.");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const accessToken = config.tokens?.access_token;
if (!accessToken) {
  console.error("Access token not found in config.");
  process.exit(1);
}

admin.initializeApp({
  credential: {
    getAccessToken: () => Promise.resolve({
      access_token: accessToken,
      expires_in: 3600
    })
  },
  projectId: "databoy-dev"
});

const auth = admin.auth();

async function updatePassword(uid, password, email) {
  try {
    console.log(`Updating password for ${email} (${uid})...`);
    await auth.updateUser(uid, { password });
    console.log(`Success! Password for ${email} updated.`);
  } catch (e) {
    console.error(`Failed to update ${email}:`, e);
  }
}

async function run() {
  await updatePassword("MmE4qMgTfngdaWbolTCi8wNwsrg2", "AdminPassword123", "admin@databoy.com");
  await updatePassword("dJ1i9zFb7XhNU1SvmN0f6LYixVg1", "StudentPassword123", "ingombemoses@gmail.com");
  await updatePassword("UYiN9NfsiWNLAQLYRmPt6y2v2bx1", "WriterPassword123", "ingombe@gmail.com");
}

run();
