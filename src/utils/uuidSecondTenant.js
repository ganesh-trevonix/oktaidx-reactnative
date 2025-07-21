import { Linking, Alert } from 'react-native';
import { v4 as uuidv4 } from 'uuid';
import Config from 'react-native-config';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generatePKCE } from './pkce'; // Adjust the path if needed

export async function loginWithSecondTenant() {

  try {
   const clientId = Config.OKTA_CLIENT_ID;
    const redirectUri = Config.OKTA_REDIRECT_URI;
    const idp = Config.OKTA_SECOND_TENANT_IDP_ID;
    const oktaDomain = Config.OKTA_DOMAIN;

    const { codeVerifier, codeChallenge } = await generatePKCE();

    const state = uuidv4();
    const nonce = uuidv4();

    // Save state and PKCE verifier for redirect handling
    await AsyncStorage.multiSet([
      ['oauth_state', state],
      ['pkce_verifier', codeVerifier],
    ]);

    const authUrl = `${oktaDomain}/oauth2/default/v1/authorize` +
      `?client_id=${clientId}` +
      '&response_type=code' +
      '&scope=openid%20profile%20email%20offline_access' +
      `&redirect_uri=${redirectUri}` +
      `&state=${state}` +
      `&nonce=${nonce}` +
      `&code_challenge=${codeChallenge}` +
      '&code_challenge_method=S256' +
      `&idp=${idp}`;

    console.log('Opening authUrl:', authUrl);
    Linking.openURL(authUrl);
  } catch (e) {
    console.error('Login failed:', e);
    Alert.alert('Login Error', e.message);
  }
}
