import CryptoJS from 'crypto-js';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-key-change-in-production';

// ==========================================
// ENCRIPTAR API KEY
// ==========================================
export const encryptApiKey = (apiKey: string): string => {
  return CryptoJS.AES.encrypt(apiKey, ENCRYPTION_KEY).toString();
};

// ==========================================
// DESENCRIPTAR API KEY
// ==========================================
export const decryptApiKey = (encryptedKey: string): string => {
  const bytes = CryptoJS.AES.decrypt(encryptedKey, ENCRYPTION_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
};

// ==========================================
// OBTENER ÚLTIMOS 4 CARACTERES (PARA MOSTRAR EN UI)
// ==========================================
export const getLastFourChars = (encryptedKey: string): string => {
  const decrypted = decryptApiKey(encryptedKey);
  return decrypted.slice(-4);
};
