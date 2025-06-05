import config from '../config/config';
import { encode as btoa } from 'base-64';
import { generatePKCE, generateRandomString } from '../utils/pkceUtils';

let state = '';

// Step 1: Interact with Okta to start the IDX flow
export async function interact(codeChallenge) {
  const { clientId, scopes, redirectUri, authServerIssuer } = config;
  state = generateRandomString(16);

  const body = new URLSearchParams();
  body.append('client_id', clientId);
  body.append('scope', scopes.join(' '));
  body.append('redirect_uri', redirectUri);
  body.append('code_challenge_method', 'S256');
  body.append('code_challenge', codeChallenge);
  body.append('state', state);

  const response = await fetch(`${authServerIssuer}/v1/interact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const text = await response.text();
  const data = JSON.parse(text);
  return data.interaction_handle;
}

// Step 2: Introspect the interactionHandle to get next IDX step
export async function introspect(interactionHandle) {
  const res = await fetch(`${config.idxIssuer}/idp/idx/introspect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/ion+json; okta-version=1.0.0' },
    body: JSON.stringify({ interactionHandle }),
  });
  return res.json();
}

// Step 3: Identify user — username only, no password
export async function identify(username, stateHandle) {
  const body = {
    identifier: username,
    stateHandle,
  };

  const res = await fetch(`${config.idxIssuer}/idp/idx/identify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/ion+json; okta-version=1.0.0' },
    body: JSON.stringify(body),
  });

  return res.json();
}

export async function handleAuthenticatorSelection(stateHandle, authenticatorId, methodType = null) {
  const body = {
    stateHandle,
    authenticator: {
      id: authenticatorId,
      ...(methodType && { methodType }),
      ...(methodType === 'push' && { autoChallenge: true })
    }
  };

  const res = await fetch(`${config.idxIssuer}/idp/idx/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/ion+json; okta-version=1.0.0' },
    body: JSON.stringify(body),
  });

  return await res.json();
}

// Step 5: Exchange interactionCode for tokens
export async function exchangeCodeForTokens(interactionCode, codeVerifier) {
  const params = new URLSearchParams();
  params.append('grant_type', 'interaction_code');
  params.append('interaction_code', interactionCode);
  params.append('client_id', config.clientId);
  params.append('redirect_uri', config.redirectUri);
  params.append('code_verifier', codeVerifier);

  const response = await fetch(`${config.authServerIssuer}/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  return response.json();
}

export async function handleChallenge(stateHandle, credentials, methodName, authenticatorId = null) {
  const urlBase = `${config.idxIssuer}/idp/idx`;

  if (methodName === 'password' || methodName === 'totp') {
    const response = await fetch(`${urlBase}/challenge/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/ion+json; okta-version=1.0.0' },
      body: JSON.stringify({ stateHandle, credentials }),
    });
    return await response.json();
  }

  if (methodName === 'push') {
    let pollingResponse;
    let done = false;
    while (!done) {
      const pollResponse = await fetch(`${urlBase}/authenticators/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/ion+json; okta-version=1.0.0' },
        body: JSON.stringify({ stateHandle, "autoChallenge": false }),
      });
      pollingResponse = await pollResponse.json();
      console.log(pollingResponse);

      if (pollingResponse.status === 'SUCCESS' || pollingResponse.successWithInteractionCode) {
        done = true;
      } else if (pollingResponse.messages || pollingResponse.error) {
        done = true;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
    return pollingResponse;
  }
  throw new Error(`Unsupported methodName: ${methodName}`);
}

export async function handleEnroll(stateHandle, authenticatorId, channel) {
  const body = {
    stateHandle,
    authenticator: {
      id: authenticatorId,
      channel
    }
  };

  const res = await fetch(`${config.idxIssuer}/idp/idx/credential/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/ion+json; okta-version=1.0.0' },
    body: JSON.stringify(body),
  });

  return await res.json();
}

export async function handleEnrollPoll(stateHandle) {
  const body = {
    stateHandle
  };

  const res = await fetch(`${config.idxIssuer}/idp/idx/challenge/poll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/ion+json; okta-version=1.0.0' },
    body: JSON.stringify(body),
  });

  return await res.json();
}

export async function cancelIdx(stateHandle) {
  const res = await fetch(`${config.idxIssuer}/idp/idx/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/ion+json; okta-version=1.0.0' },
    body: JSON.stringify({ stateHandle }),
  });
  return res.json();
}

export async function revokeToken(token, tokenTypeHint = 'access_token') {
  try {
    const response = await fetch(`${config.authServerIssuer}/v1/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `token=${encodeURIComponent(token)}&token_type_hint=${tokenTypeHint}&client_id=${config.clientId}`
    });

    if (response.ok) {
      console.log(`Successfully revoked ${tokenTypeHint}`);
    } else {
      const text = await response.text();
      console.warn(`Revoke failed: ${response.status} - ${text}`);
    }
  } catch (error) {
    console.error('Token revoke error:', error);
  }
};

export async function refreshTokens(refreshToken) {
  try {
    const response = await fetch(`${config.authServerIssuer}/v1/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `grant_type=refresh_token` +
            `&refresh_token=${encodeURIComponent(refreshToken)}` +
            `&client_id=${encodeURIComponent(config.clientId)}` +
            `&redirect_uri=${encodeURIComponent(config.redirectUri)}`
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
    }

    const tokens = await response.json();
    return tokens;
  } catch (error) {
    console.error('Error refreshing tokens:', error);
    throw error;
  }
}

export async function introspectToken(token) {
  const body = new URLSearchParams({
    token_type_hint: 'access_token',
    token: token,
    client_id: config.clientId,
  });

  const response = await fetch(`${config.authServerIssuer}/v1/introspect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error('Failed to introspect token');
  }

  const data = await response.json();
  return data.active;
}
