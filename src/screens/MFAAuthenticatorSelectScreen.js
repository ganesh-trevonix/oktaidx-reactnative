import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Button,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import {
  exchangeCodeForTokens,
  handleChallenge,
  handleAuthenticatorSelection
} from '../services/OktaIdxService';
import { useAuth } from '../context/AuthContext';

export default function MFAAuthenticatorSelectScreen({ route, navigation }) {
  const { exchangeCode, setAuthState } = useAuth();
  const { nextStep } = route.params;

  const [selectedMethod, setSelectedMethod] = useState(null);
  const [code, setCode] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setSelectedMethod(null);
    setCode('');
    setError('');
  }, []);

  const selectAuthRemediation = nextStep.remediation?.value?.find(
    (r) => r.name === 'select-authenticator-authenticate'
  );
  const authenticatorOptions =
    selectAuthRemediation?.value?.find((f) => f.name === 'authenticator')?.options || [];
  const remediationStateHandle = nextStep.stateHandle;

  const oktaVerifyOption = authenticatorOptions.find((opt) => opt.label === 'Okta Verify');
  const oktaVerifyRemediationId =
    oktaVerifyOption?.value?.form?.value?.find((f) => f.name === 'id')?.value;

  if (!oktaVerifyRemediationId) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>No Okta Verify authenticator found.</Text>
      </View>
    );
  }

  const availableMethods = oktaVerifyOption?.value?.form?.value?.find(
    (f) => f.name === 'methodType'
  )?.options || [];

  const isStateHandleExpired = (expiresAt) => {
    return new Date(expiresAt) < new Date();
  };

  const handleMethodSelection = (methodType) => {
    if (isStateHandleExpired(nextStep.expiresAt)) {
      setError('Session expired. Please restart the authentication process.');
      return;
    }
    setSelectedMethod(methodType);
    setError('');
  };

  const finishAuthentication = async (result) => {
    if (result.successWithInteractionCode) {
      try {
        const interactionCode = result.successWithInteractionCode.value.find(
          (field) => field.name === 'interaction_code'
        )?.value;
        setAuthState(s => ({
                  ...s,
                  idx: result,
                  isLoading: false,
                }));
        const tokenRes = await exchangeCode(interactionCode);
        if (tokenRes?.access_token) {
          navigation.reset({
            index: 0,
            routes: [{ name: 'Home', params: { userInfo: tokenRes } }],
          });
        } else {
          setError('Token exchange failed: No access token received.');
        }
      } catch (err) {
        setError(`Token exchange error: ${err.message || 'Unknown error'}`);
      }
    } else if (result.nextStep?.remediation?.value?.some((r) => r.name === 'challenge-authenticator')) {
      console.log('Still in authentication challenge, waiting for completion.');
    } else if (result.nextStep?.remediation?.value?.some((r) => r.name === 'select-authenticator-authenticate')) {
      setError('TOTP verification failed. Please try again.');
    } else if (result.error) {
      setError(`Authentication failed: ${result.error.message || 'Unknown error'}`);
    } else {
      setError('Unexpected state. Authentication not complete.');
    }
  };

  const handlePushSubmit = async () => {
    setWaiting(true);
    setError('');

    try {
      const selectPayload = {
        stateHandle: remediationStateHandle,
        authenticator: {
          id: oktaVerifyRemediationId,
          methodType: 'push'
        },
      };

      console.log('Submitting select-authenticator payload:', selectPayload);
      let result = await handleAuthenticatorSelection(remediationStateHandle, oktaVerifyRemediationId, 'push');
      console.log('Select authenticator result:', result);
      result = await handleChallenge(result?.stateHandle, null, 'push')
      console.log('handleChallenge result:', result);

      if (result.successWithInteractionCode) {
          setWaiting(false);
          await finishAuthentication(result);
          return;
      }

    } catch (err) {
      setWaiting(false);
      console.error('Push error:', JSON.stringify(err, null, 2));
      setError(`Failed to initiate push: ${err.message || 'Unknown error'}`);
    }
  };

  const handleTotpSubmit = async () => {
    if (!code.trim()) {
      setError('Enter the TOTP code.');
      return;
    }

    if (isStateHandleExpired(nextStep.expiresAt)) {
      setError('Session expired. Please restart the authentication process.');
      return;
    }

    setWaiting(true);
    setError('');

    try {
      // Step 1: Select the Okta Verify authenticator
      const selectPayload = {
        stateHandle: remediationStateHandle,
        authenticator: {
          methodType: 'totp',
          id: oktaVerifyRemediationId,
        },
      };

      console.log('Submitting select-authenticator payload:', JSON.stringify(selectPayload, null, 2));
      const selectResult = await handleAuthenticatorSelection(remediationStateHandle, oktaVerifyRemediationId, 'totp')
      console.log('Select authenticator result:', JSON.stringify(selectResult, null, 2));
      const credentials = { totp: code.trim() };

      const result = await handleChallenge(selectResult?.stateHandle, credentials, 'totp',oktaVerifyRemediationId)
      console.log('TOTP challenge result:', JSON.stringify(result));

      setWaiting(false);
      await finishAuthentication(result);
    } catch (err) {
      setWaiting(false);
      console.error('TOTP error:', JSON.stringify(err, null, 2));
      setError(`TOTP verification failed: ${err.message || 'Unknown error'}`);
    }
  };

  if (waiting) {
    return (
      <View style={styles.center}>
        <Text>Waiting for confirmation...</Text>
        <ActivityIndicator style={{ marginTop: 10 }} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Select a verification method:</Text>

      {availableMethods.map((method) => (
        <TouchableOpacity
          key={method.value}
          style={[styles.option, selectedMethod === method.value && styles.selectedOption]}
          onPress={() => handleMethodSelection(method.value)}
        >
          <Text>{method.label}</Text>
        </TouchableOpacity>
      ))}

      {selectedMethod === 'push' && (
        <Button title="Send Push Notification" onPress={handlePushSubmit} />
      )}

      {selectedMethod === 'totp' && (
        <>
          <TextInput
            placeholder="Enter TOTP code"
            value={code}
            onChangeText={setCode}
            keyboardType="numeric"
            style={styles.input}
          />
          <Button title="Verify TOTP Code" onPress={handleTotpSubmit} />
        </>
      )}

      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    marginBottom: 20,
    fontWeight: 'bold',
    fontSize: 18,
  },
  option: {
    padding: 12,
    backgroundColor: '#eee',
    marginBottom: 10,
    borderRadius: 5,
  },
  selectedOption: {
    backgroundColor: '#cce5ff',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 10,
    marginVertical: 12,
    borderRadius: 5,
  },
  error: {
    marginTop: 12,
    color: 'red',
  },
});