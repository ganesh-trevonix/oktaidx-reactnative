import React, { useState, useRef } from 'react';
import { View, Button, Text, Image } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { handleEnroll, handleEnrollPoll } from '../services/OktaIdxService';

export default function MFAEnrollScreen({ navigation }) {
  const { authState, exchangeCode, setAuthState } = useAuth();
  const [qrCodeUrl, setQrCodeUrl] = useState(null);
  const [polling, setPolling] = useState(false);
  const pollingIntervalRef = useRef(null);
  const pollingTimeoutRef = useRef(null);

  const finishAuthentication = async (result) => {
      if (result.successWithInteractionCode) {
        try {
          const interactionCode = result?.successWithInteractionCode?.value?.find(
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

  const authenticatorId = authState.idx?.remediation?.value
    .find(step => step.name === "select-authenticator-enroll")
    ?.value.find(field => field.name === "authenticator")
    ?.options.find(option => option.label === "Okta Verify")
    ?.value?.form?.value.find(field => field.name === "id")?.value;

  const stopPolling = () => {
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    if (pollingTimeoutRef.current) clearTimeout(pollingTimeoutRef.current);
    setPolling(false);
  };

  const startPolling = (stateHandle) => {
    setPolling(true);

    // Stop after 5 minutes
    pollingTimeoutRef.current = setTimeout(() => {
      console.log('Polling timed out after 5 minutes');
      stopPolling();
    }, 5 * 60 * 1000);

    // Start polling every 3 seconds
    pollingIntervalRef.current = setInterval(async () => {
      try {
        const pollResult = await handleEnrollPoll(stateHandle);
        console.log('Polling result:', pollResult);

        if (pollResult?.successWithInteractionCode) {
          stopPolling();
          finishAuthentication(pollResult);
        }
      } catch (err) {
        console.error('Polling error:', err);
        stopPolling();
      }
    }, 3000);
  };

  const handleMFAEnroll = async () => {
    const response = await handleEnroll(authState.idx?.stateHandle, authenticatorId, "qrcode");

    const qrUrl = response?.currentAuthenticator?.value?.contextualData?.qrcode?.href;
    if (qrUrl) {
      setQrCodeUrl(qrUrl);
      startPolling(response.stateHandle);
    } else {
      console.warn("QR Code URL not found in response", response);
    }
  };

  return (
    <View style={{ padding: 20 }}>
      {!qrCodeUrl ? (
        <>
          <Text style={{ marginBottom: 20 }}>Select MFA to enroll:</Text>
          <Button title="Okta Verify QR Code" onPress={handleMFAEnroll} />
        </>
      ) : (
        <>
          <Text style={{ marginBottom: 20, fontSize: 18, fontWeight: 'bold' }}>Scan the QR Code</Text>
          <Image source={{ uri: qrCodeUrl }} style={{ width: 200, height: 200, alignSelf: 'center' }} />
          {polling && <Text style={{ marginTop: 20 }}>Waiting for enrollment to complete...</Text>}
        </>
      )}
    </View>
  );
}