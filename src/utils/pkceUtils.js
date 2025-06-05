import 'react-native-get-random-values';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';
import { fromByteArray } from 'base64-js';

function base64URLEncode(buffer) {
  const base64 = fromByteArray(buffer);
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function generatePKCE() {
  const codeVerifier = generateRandomString(64);
  const challengeBytes = sha256(utf8ToBytes(codeVerifier));
  const codeChallenge = base64URLEncode(challengeBytes);
  return { codeVerifier, codeChallenge };
}

export function generateRandomString(length) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let result = '';
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);

  for (let i = 0; i < length; i++) {
    result += charset[randomValues[i] % charset.length];
  }
  return result;
}
