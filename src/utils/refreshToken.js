import Config from 'react-native-config';
import { getTokens, saveTokens } from './secureStorage';

const BACKEND_URL = Config.BACKEND_URL;

export async function refreshAccessToken() {
  console.log('Starting refreshAccessToken');

  const stored = await getTokens();
  console.log('Stored tokens:', stored);
  console.log('Type of stored:', typeof stored);
  console.log('refresh_token exists:', stored.refresh_token); 

  if (!stored?.refresh_token) {
    console.log('No refresh token found');
    return null;
  }

  try {
    const res = await fetch(`${BACKEND_URL}/token/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: stored.refresh_token }),
    });

    console.log('Sent refresh request to:', `${BACKEND_URL}/token/refresh`);
    console.log('Response status:', res.status);

    if (!res.ok) {
      const errorText = await res.text();
      console.log('Refresh failed with response:', errorText);
      throw new Error('Token refresh failed');
    }

    const data = await res.json();
    console.log('Refresh successful:', data);

    await saveTokens(data);
    return data;
  } catch (err) {
    console.error('Refresh token error:', err.message);
    return null;
  }
}
