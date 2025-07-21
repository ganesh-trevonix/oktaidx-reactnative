/* eslint-disable react-native/no-inline-styles */
import React, { useState, useEffect, useRef } from 'react';
import { View, TextInput, Button, Text, FlatList, TouchableOpacity, Alert, Linking, Image, StyleSheet } from 'react-native';
import Config from 'react-native-config';
import { saveTokens, getTokens, clearTokens, saveTokensWithBiometrics } from './utils/secureStorage';
import { refreshAccessToken } from './utils/refreshToken';
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loginWithSecondTenant } from './utils/uuidSecondTenant';
import queryString from 'query-string';


const BACKEND_URL = Config.BACKEND_URL;

export default function App() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [stateToken, setStateToken] = useState(null);
  const [mfaFactors, setMfaFactors] = useState([]);
  const [selectedFactor, setSelectedFactor] = useState(null);
  const [passCode, setPassCode] = useState('');
  const [tokens, setTokens] = useState(null);
  const [pkce, setPkce] = useState(null);

  const [biometryType, setBiometryType] = useState(null);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [enrollmentFactors, setEnrollmentFactors] = useState([]);

  const pollInterval = useRef(null);

  const pkceObjRef = useRef(null);

  console.log('app Config', Config);

  const BIOMETRIC_ENABLED_KEY = 'biometricEnabledFlag';

  async function saveBiometricEnabledFlag(enabled) {
    try {
      await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, enabled ? 'true' : 'false');
    } catch (e) {
      console.log('Error saving biometric enabled flag:', e);
    }
  }

  const renderMfaVerificationForm = () => {
    console.log('Hi', mfaFactors.length);
    if (mfaFactors.length > 0) {
      console.log('Inside render', mfaFactors.length);
      return (
        <View style={{ padding: 20 }}>
          <Text>Select MFA Factor:</Text>
          <FlatList
            data={mfaFactors}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => setSelectedFactor(item)}
                style={{
                  padding: 10,
                  backgroundColor:
                    selectedFactor?.id === item.id ? 'lightblue' : 'white',
                  marginVertical: 4,
                }}>
                <Text>
                  {item.factorType} - {item.provider}
                </Text>
              </TouchableOpacity>
            )}
          />
          <TextInput
            placeholder="Enter MFA Code"
            value={passCode}
            onChangeText={setPassCode}
            keyboardType="numeric"
            style={{ borderWidth: 1, marginVertical: 10, padding: 8 }}
          />
          <Button title="Verify MFA" onPress={verifyMfa} />
        </View>
      );
    }
  };

  async function handleEnroll(factor) {
    try {
      const res = await fetch(`${BACKEND_URL}/mfa/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          factorType: factor.factorType,
          provider: factor.provider,
          stateToken,
        }),
      });

      const data = await res.json();

      if (data.status === 'MFA_ENROLL_ACTIVATE') {
        setSelectedFactor({
          id: data.factorId,
          factorType: data.factorType,
          provider: data.provider,
          activation: data.activation,
        });

        Alert.alert('Scan QR or enter the secret to setup MFA.');

        pollInterval.current = setInterval(async () => {
          try {
            const res = await fetch(`${BACKEND_URL}/login`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username, password }),
            });
            const data = await res.json();
            console.log(data);

            if (data.status === 'MFA_REQUIRED') {
              console.log('Hi');
              setStateToken(data.stateToken);
              setMfaFactors(data.factors);
              setPkce(data.pkce || pkceObjRef.current);
              clearInterval(pollInterval.current);
              setSelectedFactor(null);
              console.log('render call', data.factors, mfaFactors.length);

            } else if (data.status === 'MFA_ENROLL') {
              setStateToken(data.stateToken);
              setEnrollmentFactors(data.factors);
            } else if (data.status === 'SUCCESS') {
              setTokens(data.tokens);
              clearInterval(pollInterval.current);
            } else {
              console.log('Polling result:', data);
            }
          } catch (e) {
            console.error('Polling error:', e.message);
          }
        }, 3000);
      } else if (data.status === 'SUCCESS') {
        Alert.alert('Enrollment successful.');
      } else {
        Alert.alert('Enrollment failed', JSON.stringify(data));
      }
    } catch (e) {
      Alert.alert('Enroll error: ' + e.message);
    }
  }

  useEffect(() => {
    return () => {
      if (pollInterval.current) { clearInterval(pollInterval.current); }
    };
  }, []);

  async function getBiometricEnabledFlag() {
    try {
      const value = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
      return value === 'true';
    } catch (e) {
      console.log('Error reading biometric enabled flag:', e);
      return false;
    }
  }

  async function updateBiometricState() {
    const credentials = await Keychain.getGenericPassword();
    const flag = await getBiometricEnabledFlag();
    setBiometricEnabled(!!credentials && flag);
  }

  async function enableBiometricForTokens(tokens) {
    if (!tokens) { return; }

    await Keychain.setGenericPassword('tokens', JSON.stringify(tokens), {
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });

    await saveBiometricEnabledFlag(true);
    setTimeout(updateBiometricState, 100);
  }


  useEffect(() => {
    (async () => {
      const biometry = await Keychain.getSupportedBiometryType();
      console.log('biometry', biometry);

      setBiometryType(biometry);

      const bioFlag = await getBiometricEnabledFlag(); // reads from AsyncStorage
      setBiometricEnabled(bioFlag);
    })();

    // --- Handle OAuth redirect from IdP flow
    const handleRedirect = async (event) => {
      const url = event.url;
      console.log('Deep link received:', event.url);
      if (!url.includes('code=')) { return; }

      try {
        const { query } = queryString.parseUrl(url);

        const code = query.code;
        const returnedState = query.state;

        const storedState = await AsyncStorage.getItem('oauth_state');
        const codeVerifier = await AsyncStorage.getItem('pkce_verifier');

        await AsyncStorage.multiRemove(['oauth_state', 'pkce_verifier']);

        if (returnedState !== storedState) {
          Alert.alert('Security Warning', 'State mismatch. Possible CSRF attack.');
          return;
        }
        console.log('codeVerifier', codeVerifier);
        const res = await fetch(`${BACKEND_URL}/token/exchange-code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, codeVerifier }),
        });

        const data = await res.json();

        if (data.tokens) {
          setTokens(data.tokens);
          await saveTokens(data.tokens);

          const biometryNow = await Keychain.getSupportedBiometryType();

          if (biometryNow) {
            Alert.alert(
              'Enable Biometric Login?',
              'Would you like to use biometrics for future logins?',
              [
                { text: 'No', style: 'cancel' },
                {
                  text: 'Yes',
                  onPress: async () => {
                    await enableBiometricForTokens(data.tokens);
                  },
                },
              ]
            );
          }
        } else {
          Alert.alert('Token Exchange Failed', 'No tokens received');
        }
      } catch (err) {
        console.error('Redirect handling failed', err);
        Alert.alert('Login Failed', err.message || 'Unknown error');
      }
    };

    const subscription = Linking.addEventListener('url', handleRedirect);
    Linking.getInitialURL().then(url => {
      if (url) { handleRedirect({ url }); }
    });

    return () => {
      subscription.remove();
    };

  }, []);

  async function attemptBiometricLogin() {
    try {
      // First check if any credentials are stored
      const hasCredentials = await Keychain.getGenericPassword();
      if (!hasCredentials) {
        Alert.alert('No saved credentials', 'Please log in manually first.');
        return;
      }

      // Now prompt with biometrics
      const credentials = await Keychain.getGenericPassword({
        authenticationPrompt: {
          title: 'Unlock your session',
          cancel: 'Cancel',
        },
      });

      if (credentials) {
        console.log('credentials', credentials);

        const storedTokens = JSON.parse(credentials.password);
        console.log('Tokens from biometric:', storedTokens, credentials);

        if (storedTokens?.access_token || storedTokens?.refresh_token) {
          if (storedTokens?.refresh_token) {
            const refreshed = await refreshAccessToken(storedTokens.refresh_token);
            console.log('Refreshed tokens:', refreshed);

            if (refreshed?.access_token) {
              await saveTokens(refreshed);
              await saveTokensWithBiometrics(refreshed);
              setTokens(refreshed);
              await saveBiometricEnabledFlag(true);
              setTimeout(updateBiometricState, 100);
            } else {
              Alert.alert('Session expired', 'Please log in again manually.');
            }
          } else {
            setTokens(storedTokens);
            await saveBiometricEnabledFlag(true);
            setTimeout(updateBiometricState, 100);
          }
        } else {
          Alert.alert('No valid session', 'Please log in manually first.');
        }
      } else {
        console.log('Authentication cancelled');
      }
    } catch (e) {
      console.log('Biometric login failed:', e.message);
      await clearTokens();
      setBiometricEnabled(false);
    }
  }


  async function promptBiometric() {
    try {
      const biometryType = await Keychain.getSupportedBiometryType();
      if (!biometryType) {
        Alert.alert('Biometrics not available');
        return;
      }
      const credentials = await Keychain.getGenericPassword({
        authenticationPrompt: {
          title: 'Authenticate to proceed',
          cancel: 'Cancel',
        },
      });
      if (!credentials) {
        Alert.alert('Authentication cancelled');
        return;
      }
      const storedTokens = JSON.parse(credentials.password);
      setTokens(storedTokens);
    } catch (error) {
      Alert.alert('Authentication error', error.message);
    }
  }

  async function login() {
    try {
      const res = await fetch(`${BACKEND_URL}/login`, {

        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      console.log('login1', res);
      const data = await res.json();
      console.log("data.status", data.status)
      if (data.status === 'MFA_REQUIRED') {
        setStateToken(data.stateToken);
        setMfaFactors(data.factors);
        setPkce(data.pkce);
      } else if (data.status === 'MFA_ENROLL') {
        setStateToken(data.stateToken);
        setEnrollmentFactors(data.factors);
      } else if (data.status === 'SUCCESS') {
        setTokens(data.tokens);
        await saveTokens(data.tokens); // No biometric here

        if (biometryType) {
          Alert.alert(
            'Enable Biometric Login?',
            'Would you like to use biometrics for future logins?',
            [
              { text: 'No', style: 'cancel' },
              {
                text: 'Yes',
                onPress: async () => {
                  await enableBiometricForTokens(data.tokens);
                },
              },
            ]
          );
        }
      } else {
        alert('Login failed');
      }
    } catch (e) {
      alert('Login error: ' + e.message);
    }
  }

  async function verifyMfa() {
    if (!selectedFactor) { return alert('Select MFA factor'); }

    try {
      if (selectedFactor.factorType === 'push') {
        const initRes = await fetch(`${BACKEND_URL}/mfa/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stateToken,
            factorId: selectedFactor.id,
            passCode: '',
            codeVerifier: pkce.codeVerifier,
            codeChallenge: pkce.codeChallenge,
          }),
        });

        const initData = await initRes.json();

        if (initData.status === 'MFA_CHALLENGE' && initData.factorResult === 'WAITING') {
          const pollUrl = initData._links.next.href;

          const poll = async (attempt = 0) => {
            if (attempt > 10) {
              alert('Push MFA timed out');
              return;
            }

            try {
              const pollRes = await fetch(pollUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stateToken }),
              });
              const pollData = await pollRes.json();

              if (pollData.status === 'MFA_CHALLENGE') {
                setTimeout(() => poll(attempt + 1), 3000);
              } else if (pollData.status === 'SUCCESS') {
                let finalTokens = null;

                if (pollData.tokens) {
                  finalTokens = pollData.tokens;
                  await saveTokens(finalTokens);
                  setTokens(finalTokens);
                } else if (pollData.sessionToken) {
                  const exchangeRes = await fetch(`${BACKEND_URL}/exchange-token`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      sessionToken: pollData.sessionToken,
                      codeVerifier: pkce.codeVerifier,
                      codeChallenge: pkce.codeChallenge,
                    }),
                  });
                  const exchangeData = await exchangeRes.json();

                  if (exchangeData.tokens) {
                    finalTokens = exchangeData.tokens;
                    await saveTokens(finalTokens);
                    setTokens(finalTokens);
                  } else {
                    alert('Failed to exchange session token for tokens');
                    return;
                  }
                }

                if (biometryType && finalTokens) {
                  Alert.alert(
                    'Enable Biometric Login?',
                    'Would you like to use biometrics for future logins?',
                    [
                      { text: 'No', style: 'cancel' },
                      {
                        text: 'Yes',
                        onPress: async () => {
                          await enableBiometricForTokens(finalTokens);
                        },
                      },
                    ]
                  );
                }
              } else {
                alert('MFA failed or rejected: ' + JSON.stringify(pollData));
              }
            } catch (pollErr) {
              alert('Polling error: ' + pollErr.message);
            }
          };

          poll();
        } else if (initData.status === 'SUCCESS') {
          const finalTokens = initData.tokens;
          setTokens(finalTokens);
          await saveTokens(finalTokens);

          if (biometryType && finalTokens) {
            Alert.alert(
              'Enable Biometric Login?',
              'Would you like to use biometrics for future logins?',
              [
                { text: 'No', style: 'cancel' },
                {
                  text: 'Yes',
                  onPress: async () => {
                    await enableBiometricForTokens(finalTokens);
                  },
                },
              ]
            );
          }
        } else {
          alert('MFA failed: ' + JSON.stringify(initData));
        }
      } else {
        // TOTP or other MFA factor
        const res = await fetch(`${BACKEND_URL}/mfa/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stateToken,
            factorId: selectedFactor.id,
            passCode,
            codeVerifier: pkce.codeVerifier,
            codeChallenge: pkce.codeChallenge,
          }),
        });

        const data = await res.json();
        if (data.status === 'SUCCESS') {
          setTokens(data.tokens);
          await saveTokens(data.tokens);

          if (biometryType) {
            Alert.alert(
              'Enable Biometric Login?',
              'Would you like to use biometrics for future logins?',
              [
                { text: 'No', style: 'cancel' },
                {
                  text: 'Yes',
                  onPress: async () => {
                    await enableBiometricForTokens(data.tokens);
                  },
                },
              ]
            );
          }
        } else {
          alert('MFA failed: ' + JSON.stringify(data));
        }
      }
    } catch (e) {
      alert('MFA error: ' + e.message);
    }
  }


  async function logout() {
    await clearTokens();
    await saveBiometricEnabledFlag(false);
    setTokens(null);
    setUsername('');
    setPassword('');
    setMfaFactors([]);
    setSelectedFactor(null);
    setPkce(null);
    setStateToken(null);
    setBiometricEnabled(false);
  }

  async function handleEnroll(factor) {
    try {
      const res = await fetch(`${BACKEND_URL}/mfa/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          factorType: factor.factorType,
          provider: factor.provider,
          stateToken,
        }),
      });

      const data = await res.json();

      if (data.status === 'MFA_ENROLL_ACTIVATE') {
        setSelectedFactor({
          id: data.factorId,
          factorType: data.factorType,
          provider: data.provider,
          activation: data.activation,
        });

        Alert.alert('Scan QR or enter the secret to setup MFA.');

        pollInterval.current = setInterval(async () => {
          try {
            const res = await fetch(`${BACKEND_URL}/login`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username, password }),
            });
            const data = await res.json();
            console.log(data);

            if (data.status === 'MFA_REQUIRED') {
              console.log('Hi');
              setStateToken(data.stateToken);
              setMfaFactors(data.factors);
              setPkce(data.pkce || pkceObjRef.current);
              clearInterval(pollInterval.current);
              setSelectedFactor(null);
              console.log('render call', data.factors, mfaFactors.length);

            } else if (data.status === 'MFA_ENROLL') {
              setStateToken(data.stateToken);
              setEnrollmentFactors(data.factors);
            } else if (data.status === 'SUCCESS') {
              setTokens(data.tokens);
              clearInterval(pollInterval.current);
            } else {
              console.log('Polling result:', data);
            }
          } catch (e) {
            console.error('Polling error:', e.message);
          }
        }, 3000);
      } else if (data.status === 'SUCCESS') {
        Alert.alert('Enrollment successful.');
      } else {
        Alert.alert('Enrollment failed', JSON.stringify(data));
      }
    } catch (e) {
      Alert.alert('Enroll error: ' + e.message);
    }
  }

  useEffect(() => {
    return () => {
      if (pollInterval.current) { clearInterval(pollInterval.current); }
    };
  }, []);

  if (tokens) {
    return (
      <View style={{ padding: 20 }}>

        <Text style={{ fontWeight: 'bold' }}>Access Token:</Text>
        <TouchableOpacity
          style={{
            backgroundColor: '#f4f4f4',
            borderRadius: 8,
            padding: 10,
            marginTop: 4,
            marginBottom: 16,
            borderWidth: 1,
            borderColor: '#ddd',
          }}
        >
          <Text selectable numberOfLines={3} style={{ fontSize: 12 }}>
            {tokens.access_token}
          </Text>
        </TouchableOpacity>

        <Text style={{ fontWeight: 'bold' }}>ID Token:</Text>
        <TouchableOpacity
          style={{
            backgroundColor: '#f4f4f4',
            borderRadius: 8,
            padding: 10,
            marginTop: 4,
            marginBottom: 16,
            borderWidth: 1,
            borderColor: '#ddd',
          }}
        >
          <Text selectable numberOfLines={3} style={{ fontSize: 12 }}>
            {tokens.id_token}
          </Text>
        </TouchableOpacity>
        <View style={{ marginTop: 20 }}>
          <Button title="Logout" onPress={logout} />
        </View>

        {biometryType && !biometricEnabled && (
          <View style={{ marginTop: 20 }}>
            <Button
              title={`Enable ${biometryType} Login`}
              onPress={async () => {
                try {
                  await saveTokensWithBiometrics(tokens);
                  await saveBiometricEnabledFlag(true);
                  setTimeout(updateBiometricState, 100);
                  Alert.alert('Biometric login enabled!');
                } catch (e) {
                  Alert.alert('Error enabling biometric login', e.message);
                }
              }}
            />
          </View>
        )}
      </View>
    );
  }

  if (selectedFactor?.activation) {
    return (
      <View style={{ padding: 20 }}>
        <Text style={{ fontWeight: 'bold' }}>TOTP Setup:</Text>
        {selectedFactor.activation.qrCode && (
          <View style={{ alignItems: 'center', marginVertical: 10 }}>
            <Text>Scan the QR code in your authenticator app:</Text>
            <Image
              source={{ uri: selectedFactor.activation.qrCode }}
              style={{ width: 200, height: 200, marginTop: 10 }}
              resizeMode="contain"
            />
          </View>
        )}
      </View>
    );
  }

  if (mfaFactors.length > 0) {
    return (
      <View style={{ padding: 20 }}>
        <Text>Select MFA Factor:</Text>
        <FlatList
          data={mfaFactors}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => setSelectedFactor(item)}
              style={{
                padding: 10,
                backgroundColor: selectedFactor?.id === item.id ? 'lightblue' : 'white',
                marginVertical: 4,
              }}
            >
              <Text>{item.factorType} - {item.provider}</Text>
            </TouchableOpacity>
          )}
        />
        <TextInput
          placeholder="Enter MFA Code"
          value={passCode}
          onChangeText={setPassCode}
          keyboardType="numeric"
          style={{ borderWidth: 1, marginVertical: 10, padding: 8 }}
        />
        <Button title="Verify MFA" onPress={verifyMfa} />
      </View>
    );
  }

  if (enrollmentFactors.length > 0) {
    return (
      <View style={{ padding: 20 }}>
        <Text>Select MFA Factor to Enroll:</Text>
        <FlatList
          data={enrollmentFactors}
          keyExtractor={(item, index) => index.toString()}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => handleEnroll(item)}
              style={{
                padding: 10,
                backgroundColor: 'white',
                marginVertical: 4,
                borderWidth: 1,
                borderColor: '#ccc',
                borderRadius: 8,
              }}
            >
              <Text>{item.factorType} - {item.provider}</Text>
            </TouchableOpacity>
          )}
        />
      </View>
    );
  }



  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#f0f2f5',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <View
        style={{
          backgroundColor: '#fff',
          padding: 20,
          borderRadius: 12,
          width: '90%',
          maxWidth: 400,
          elevation: 4,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.1,
          shadowRadius: 8,
        }}
      >
        {/* Heading with emoji */}
       <View style={{ alignItems: 'center', marginBottom: 40 }}>
  <Image
    source={{
      uri: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT22tg1gwVFUqeMB4v5MZb9CkQ7USouzBx-8w&s',
    }}
    style={{
      width: 200,
      height: 50,
      resizeMode: 'contain',
      marginBottom: 20,
    }}
  />

  <View
    style={{
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <Text style={{ fontSize: 24, marginRight: 10 }}>🔐</Text>
    <Text
      style={{
        fontSize: 24,
        fontWeight: 'bold',
        color: '#333',
      }}
    >
      Login
    </Text>
  </View>
</View>

        {/* Username input */}
        <TextInput
          placeholder="👤 Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          style={{
            borderWidth: 1,
            borderColor: '#ccc',
            marginBottom: 10,
            padding: 10,
            borderRadius: 8,
          }}
        />
        {/* Password input */}
        <TextInput
          placeholder="🔒 Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          style={{
            borderWidth: 1,
            borderColor: '#ccc',
            marginBottom: 10,
            padding: 10,
            borderRadius: 8,
          }}
        />
        {/* Login button */}
        <Button title="Login" onPress={login} />
        {/* Divider */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginVertical: 20,
          }}
        >
          <View
            style={{ flex: 1, height: 1, backgroundColor: '#ccc' }}
          />
          <Text style={{ marginHorizontal: 10, color: '#666' }}>or</Text>
          <View
            style={{ flex: 1, height: 1, backgroundColor: '#ccc' }}

          />
        </View>
        {/* Biometrics */}
        <View style={{ marginBottom: 10 }}>
          <Button title="🔑 Login with Biometrics" onPress={attemptBiometricLogin} />
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginVertical: 20,
          }}
        >
          <View
            style={{ flex: 1, height: 1, backgroundColor: '#ccc' }}
          />
          <Text style={{ marginHorizontal: 10, color: '#666' }}>or</Text>
          <View
            style={{ flex: 1, height: 1, backgroundColor: '#ccc' }}
          />
        </View>
        <View>
          <Button title="🔄 Login with Other Account" onPress={loginWithSecondTenant} />
        </View>
      </View>
    </View>
  );
}
