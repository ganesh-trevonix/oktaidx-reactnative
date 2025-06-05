import React, { createContext, useState, useContext } from 'react';
import {
  interact,
  introspect,
  identify,
  exchangeCodeForTokens,
  handleChallenge,
  handleAuthenticatorSelection,
  cancelIdx,
  revokeToken
} from '../services/OktaIdxService';
import * as Keychain from 'react-native-keychain';
import { generatePKCE } from '../utils/pkceUtils';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AuthContext = createContext(null);
let codeVerifier = null;

export const AuthProvider = ({ children }) => {
  const [authState, setAuthState] = useState({
    isAuthenticated: false,
    tokens: null,
    isLoading: false,
    idx: null,
  });

  const exchangeCode = async (interactionCode) => {
      return await exchangeCodeForTokens(interactionCode, codeVerifier);
    };

    const setAuthTokens = async (tokens) => {
      await Keychain.setGenericPassword('auth', JSON.stringify(tokens));

      setAuthState({
        isAuthenticated: true,
        tokens,
        idx: null,
        isLoading: false,
      });
    };

  // Step 1-4: Start login with username only
  const login = async (username, password) => {
    setAuthState(s => ({ ...s, isLoading: true }));
    try {
      const pkce = await generatePKCE();
      codeVerifier = pkce.codeVerifier;

      const interactionHandle = await interact(pkce.codeChallenge);
      const idxResponse = await introspect(interactionHandle);
      console.log('idxResponse: ', idxResponse);

      if (!idxResponse.stateHandle) {
        throw new Error('IDX introspect did not return a stateHandle.');
      }

        if (idxResponse?.user?.value?.identifier) {
        if (idxResponse.successWithInteractionCode && idxResponse?.user?.value?.identifier === username) {
                const tokens = await exchangeCodeForTokens(idxResponse.successWithInteractionCode.value[1].value, codeVerifier);
                await Keychain.setGenericPassword('auth', JSON.stringify(tokens));

                setAuthState({
                  isAuthenticated: true,
                  tokens,
                  idx: idxResponse,
                  isLoading: false,
                });

                return { success: true, tokens };
              } else {
                try {
                        await cancelIdx(idxResponse.stateHandle);
                        const result = await login(username, password);
                        return result;
                      } catch (e) {
                        console.warn('Failed to cancel IDX transaction:', e);
                      }
              }
             }

      // Step 1: IDENTIFY
      const identifyResponse = await identify(username, idxResponse.stateHandle);
      console.log('identifyResponse: ', identifyResponse);

      // Step 2: SELECT PASSWORD AUTHENTICATOR
      const selectAuth = identifyResponse?.remediation?.value.find(
        r => r.name === 'select-authenticator-authenticate'
      );
      if (!selectAuth) {
        throw new Error('No select-authenticator-authenticate step found.');
      }

      const passwordOption = selectAuth.value.find(v => v.name === 'authenticator')?.options?.find(
        opt => opt.label === 'Password'
      );
      const credentials = { passcode: password };
      if (!passwordOption) {
        if(identifyResponse?.remediation?.value.find(
          r => r.name === 'challenge-authenticator'
        )) {
          const challengeResponse = await handleChallenge(identifyResponse.stateHandle, credentials, 'password');
          if (challengeResponse.remediation) {
                  setAuthState(s => ({
                    ...s,
                    idx: challengeResponse,
                    isLoading: false,
                  }));
                  return { success: true, nextStep: challengeResponse };
                }
        }
        throw new Error('Password authenticator not available.');
      }

      const passwordAuthId = passwordOption.value.form.value.find(v => v.name === 'id')?.value;
      const selectPasswordRes = await handleAuthenticatorSelection(identifyResponse.stateHandle, passwordAuthId)
      console.log('selectPasswordRes', selectPasswordRes);

      // Step 3: CHALLENGE PASSWORD VIA challenge-authenticator
      const challengeResponse = await handleChallenge(selectPasswordRes.stateHandle, credentials, 'password');
      console.log('Password challenge response:', challengeResponse);

      // Handle error messages from the challenge step
      if (challengeResponse.messages?.value?.length) {
        const msg = challengeResponse.messages.value.map(m => m.message).join('; ');
        throw new Error(`Password challenge error: ${msg}`);
      }

      // Step 4: Check if login is completed
      if (challengeResponse.successWithInteractionCode) {
        const tokens = await exchangeCodeForTokens(challengeResponse.successWithInteractionCode, codeVerifier);
        await Keychain.setGenericPassword('auth', JSON.stringify(tokens));

        setAuthState({
          isAuthenticated: true,
          tokens,
          idx: challengeResponse,
          isLoading: false,
        });

        return { success: true, tokens };
      }
      // Continue if further remediation (like MFA) is required
      if (challengeResponse.remediation) {
        setAuthState(s => ({
          ...s,
          idx: challengeResponse,
          isLoading: false,
        }));
        return { success: true, nextStep: challengeResponse };
      }

      throw new Error('Password challenge did not return interactionCode, remediation, or error messages.');
    } catch (err) {
      console.error('Login error (full flow):', err);
      setAuthState(s => ({ ...s, isLoading: false }));
      return { success: false, error: err };
    }
  };

  const logout = async () => {
    if (authState.idx?.stateHandle) {
      try {
        await cancelIdx(authState.idx.stateHandle);
      } catch (e) {
        console.warn('Failed to cancel IDX transaction:', e);
      }
    }
    codeVerifier = null;
    await Keychain.resetGenericPassword();
    await AsyncStorage.clear();

    setAuthState({
      isAuthenticated: false,
      tokens: null,
      isLoading: false,
      idx: null,
    });
  };

  return (
    <AuthContext.Provider value={{ authState, login, logout, exchangeCode, setAuthState, setAuthTokens }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
