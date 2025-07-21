import * as Keychain from 'react-native-keychain';

export async function saveTokens({ accessToken, refreshToken, idToken }) {
  await Keychain.setGenericPassword(
    'tokens',
    JSON.stringify({ accessToken, refreshToken, idToken }),
    {
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY,
      accessible: Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
      authenticationPrompt: {
        title: 'Authenticate to save tokens',
      },
    }
  );
}

export async function saveTokensWithBiometrics(tokens) {
  await Keychain.setGenericPassword(
    'tokens',
    JSON.stringify(tokens),
    {
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY,
      accessible: Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
      authenticationPrompt: {
        title: 'Authenticate to enable biometrics',
      },
    }
  );
}

export async function getTokens() {
  try {
    const credentials = await Keychain.getGenericPassword({
      authenticationPrompt: {
        title: 'Authenticate to access tokens',
      },
    });
    if (!credentials) return null;
    return JSON.parse(credentials.password);
  } catch (error) {
    console.log('Biometric auth failed or cancelled', error);
    return null;
  }
}

export async function clearTokens() {
  await Keychain.resetGenericPassword();
}
