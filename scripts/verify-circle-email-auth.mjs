import dotenv from 'dotenv';
import { initiateUserControlledWalletsClient } from '@circle-fin/user-controlled-wallets';

dotenv.config();

console.log('\n======================================================');
console.log(' ARCIS PROTOCOL - CIRCLE EMAIL AUTH DIAGNOSTIC TOOL');
console.log('======================================================\n');

const apiKey = (process.env.CIRCLE_API_KEY || '').trim();
const appId = (process.env.VITE_CIRCLE_APP_ID || '').trim();
const clientKey = (process.env.VITE_CLIENT_KEY || '').trim();

console.log('1. Checking Environment Variables:');
console.log('   - CIRCLE_API_KEY:    ', apiKey ? `Configured (${apiKey.slice(0, 15)}... len:${apiKey.length})` : 'MISSING (Empty)');
console.log('   - VITE_CIRCLE_APP_ID:', appId ? `Configured (${appId})` : 'MISSING (Empty)');
console.log('   - VITE_CLIENT_KEY:   ', clientKey ? `Configured (${clientKey.slice(0, 17)}... len:${clientKey.length})` : 'MISSING (Empty)');

if (!apiKey) {
  console.log('\n❌ [FAIL] CIRCLE_API_KEY is not set in .env.');
  console.log('   Please get an API key from https://console.circle.com -> Project Settings -> API Keys\n');
  process.exit(1);
}

console.log('\n2. Testing Circle API Connectivity & Credentials:');
try {
  const client = initiateUserControlledWalletsClient({ apiKey });
  
  // Test basic auth with ping/config or test device token
  console.log('   Testing createDeviceTokenForEmailLogin API call...');
  const res = await client.createDeviceTokenForEmailLogin({
    deviceId: 'diagnostic-check-' + Date.now(),
    email: 'diagnostic-test@example.com'
  });

  console.log('   ✅ [SUCCESS] Circle API accepted credentials and generated email tokens!');
  console.log('   - Device Token:        ', res.data?.deviceToken ? 'Generated' : 'None');
  console.log('   - Device Encryption Key:', res.data?.deviceEncryptionKey ? 'Generated' : 'None');
  console.log('   - OTP Token:           ', res.data?.otpToken ? 'Generated' : 'None');
  console.log('\n🎉 Circle Email OTP backend service is 100% LIVE and operational!\n');
} catch (err) {
  const status = err?.status || err?.response?.status;
  const msg = err?.message || err?.response?.data?.message || String(err);
  console.log(`\n❌ [API ERROR] Status: ${status || 'Unknown'} - ${msg}`);

  if (status === 401 || msg.includes('401') || msg.toLowerCase().includes('invalid credentials')) {
    console.log('\n👉 EKSİK / DÜZELTME ADIMI:');
    console.log('   CIRCLE_API_KEY anahtarınız Circle tarafından kabul edilmedi (Invalid credentials).');
    console.log('   1. https://console.circle.com adresine gidin.');
    console.log('   2. Project Settings -> API Keys sekmesine girin.');
    console.log('   3. Yeni bir API Key oluşturun (TEST_API_KEY:...) ve .env dosyasındaki CIRCLE_API_KEY alanına yapıştırın.');
  } else if (msg.toLowerCase().includes('smtp') || msg.includes('155138') || msg.includes('email sending failed')) {
    console.log('\n👉 EKSİK / DÜZELTME ADIMI:');
    console.log('   Circle Console üzerinde SMTP yapılandırması eksik.');
    console.log('   1. https://console.circle.com -> Wallets -> User-Controlled -> Configurator adresine gidin.');
    console.log('   2. Authentication Methods -> Email OTP sekmesine tıklayın.');
    console.log('   3. SMTP sağlayıcı bilgilerinizi (örn. Mailtrap.io / SendGrid) girip kaydedin.');
  } else {
    console.log('\n👉 Detaylı Hata:', err?.response?.data || err);
  }
  console.log('\n');
}
