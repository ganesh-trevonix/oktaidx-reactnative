// src/screens/LoginScreen.js
import React, { useEffect, useState, useCallback } from 'react';
import { View, TextInput, Button, ActivityIndicator, Linking, Alert } from 'react-native';
import { useAuth } from '../context/AuthContext';
import config from '../config/config';
import { generateRandomString, generatePKCE } from '../utils/pkceUtils';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';

export default function LoginScreen({ navigation }) {
  const { authState, login, setAuthTokens } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const handleUrl = async (url) => {
      if (!url) return;

      const getQueryParams = (url) => {
        const params = {};
        const queryString = url.split('?')[1];
        if (!queryString) return params;

        queryString.split('&').forEach(part => {
          const [key, value] = part.split('=');
          params[decodeURIComponent(key)] = decodeURIComponent(value || '');
        });

        return params;
      };

      try {
        const params = getQueryParams(url);
        const code = params.code;
        const state = params.state;

        if (!code) {
          console.warn('No auth code found in URL');
          return;
        }

        const tokens = await exchangeCodeForTokens(code);
        navigation.reset({
          index: 0,
          routes: [{ name: 'Home', params: { userInfo: tokens } }],
        });
      } catch (err) {
        console.error('Error handling redirect:', err);
        Alert.alert('Token Exchange Failed', err.message);
      }
    };

    const sub = Linking.addEventListener('url', (event) => {
      handleUrl(event.url);
    });

    Linking.getInitialURL().then((initialUrl) => {
      if (initialUrl) {
        handleUrl(initialUrl);
      }
    });

    return () => sub.remove();
  }, []);

  useFocusEffect(
    useCallback(() => {
      setIsProcessing(false);
    }, [])
  );

  const handleLogin = async () => {
    setIsProcessing(true);
    try {
      const result = await login(username, password);

      if (result?.nextStep) {
        const remediations = result.nextStep.remediation?.value || [];

        if (remediations.some(r => r.name === 'select-authenticator-authenticate')) {
          navigation.navigate('MFAAuthenticatorSelect', { nextStep: result.nextStep });
        } else if (remediations.some(r => r.name === 'select-authenticator-enroll')) {
          navigation.navigate('MFAEnroll', { nextStep: result.nextStep });
        } else {
          Alert.alert('Login failed', 'Unhandled authentication step');
        }
      } else if (result?.success) {
        navigation.reset({
          index: 0,
          routes: [{ name: 'Home', params: { userInfo: result.tokens } }],
        });
      } else if (result?.error) {
        Alert.alert('Login failed', result.error.message || JSON.stringify(result.error));
      } else {
        Alert.alert('Login failed', 'Invalid credentials or no next step');
      }
    } catch (err) {
      console.error('Login error:', err);
      Alert.alert('Login failed', err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSocialLogin = async () => {
    const domain = config.authServerIssuer;
    const clientId = config.clientId;
    const redirectUri = config.redirectUri;
    const scopes = config.scopes;
    const idpId = config.idpId;
    const state = generateRandomString(16);
    const nonce = generateRandomString(16);

    const pkce = await generatePKCE();
    await AsyncStorage.setItem('pkce_code_verifier', pkce.codeVerifier);

    const authorizeUrl = `${domain}/v1/authorize?` +
      `client_id=${clientId}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(scopes.join(' '))}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${state}` +
      `&nonce=${nonce}` +
      `&code_challenge_method=S256` +
      `&code_challenge=${pkce.codeChallenge}` +
      `&idp=${idpId}` +
      `&prompt=login`;

    Linking.openURL(authorizeUrl);
  };

  const exchangeCodeForTokens = async (code) => {
    const codeVerifier = await AsyncStorage.getItem('pkce_code_verifier');

    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', config.redirectUri);
    params.append('client_id', config.clientId);
    params.append('code_verifier', codeVerifier);

    const response = await fetch(`${config.authServerIssuer}/v1/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Token exchange failed:', errorText);
      throw new Error(`Token exchange failed: ${errorText}`);
    }

    await AsyncStorage.removeItem('pkce_code_verifier');
    const tokens = await response.json();
    return tokens;
  };

  return (
    <View style={{ padding: 20 }}>
      <TextInput
        style={{ borderWidth: 1, marginBottom: 10, padding: 8 }}
        placeholder="Username"
        autoCapitalize="none"
        onChangeText={setUsername}
      />
      <TextInput
        style={{ borderWidth: 1, marginBottom: 20, padding: 8 }}
        placeholder="Password"
        secureTextEntry
        onChangeText={setPassword}
      />
      {authState.isLoading || isProcessing ? (
        <ActivityIndicator />
      ) : (
        <Button title="Login" onPress={handleLogin} />
      )}
      <View style={{ marginTop: 20 }}>
        <Button title="Social Login" onPress={handleSocialLogin} disabled={isProcessing} />
      </View>
    </View>
  );
}