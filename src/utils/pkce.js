import { Buffer } from 'buffer';
import 'react-native-get-random-values';
import { sha256 } from 'js-sha256';
import { randomBytes } from 'react-native-randombytes';

function base64UrlEncode(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function generatePKCE() {
  return new Promise((resolve, reject) => {
    // Generate 48 bytes instead of 32 to ensure length is valid after encoding
    randomBytes(48, (err, bytes) => {
      if (err) reject(err);
      else {
        const codeVerifier = base64UrlEncode(Buffer.from(bytes));

        // 🔒 Still using codeVerifier as input to SHA-256 hash
        const hash = sha256.arrayBuffer(codeVerifier);
        const codeChallenge = base64UrlEncode(Buffer.from(hash));

        resolve({ codeVerifier, codeChallenge });
      }
    });
  });
}

