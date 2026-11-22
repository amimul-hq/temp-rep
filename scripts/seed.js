import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

import { localJsonStore, defaultWebsiteData } from '../netlify/functions/db.js';

async function seedLocalData() {
  console.log('====================================================');
  console.log('🚀 SEEDING & VERIFYING LOCAL JSON STORAGE');
  console.log('====================================================');

  const data = await localJsonStore.getWebsiteData();
  console.log(`📁 File location: ${localJsonStore.filePath}`);

  // 1. Verify / ensure categories & products
  console.log(` - Categories: ${data.categories?.length || 0}`);
  console.log(` - Products: ${data.products?.length || 0}`);
  console.log(` - Orders: ${data.orders?.length || 0}`);

  // 2. Ensure Admin account exists in local store
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD before seeding.');
  }

  let admins = data.admins || [];
  let existingAdmin = admins.find(a => a.username === username);

  if (!existingAdmin) {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const newAdmin = {
      _id: `admin_${Date.now()}`,
      username,
      password: hashedPassword,
      name: 'Store Administrator',
      role: 'superadmin',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    admins.push(newAdmin);
    data.admins = admins;
    localJsonStore.saveToDisk();
    console.log('✅ Admin account created in local JSON.');
  } else {
    console.log('ℹ️  Admin account already verified in local JSON.');
  }

  console.log('\n🎉 Local JSON verification & seeding complete!');
}

seedLocalData().catch(console.error);
