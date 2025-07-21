require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const { generatePKCE } = require('./pkce');

const app = express();
app.use(bodyParser.json());

const OKTA_DOMAIN = process.env.OKTA_DOMAIN;
const CLIENT_ID = process.env.CLIENT_ID;
const REDIRECT_URI = process.env.REDIRECT_URI;

async function exchangeSessionTokenForTokens(sessionToken, codeVerifier, codeChallenge, state) {
  console.log("Inside");
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: 'openid profile email offline_access',
    redirect_uri: REDIRECT_URI,
    sessionToken,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state
  });
  console.log("Params", params);

  try {
    // Try to get authorization code via redirect (expect 302)
    const response = await axios.get(`${OKTA_DOMAIN}/oauth2/default/v1/authorize?${params.toString()}`, {
      maxRedirects: 0,
      validateStatus: status => status === 302,
    });
    const location = response.headers.location;
    const url = new URL(location);
    const code = url.searchParams.get('code');
    if (!code) throw new Error('Authorization code missing');

    const tokenResponse = await axios.post(`${OKTA_DOMAIN}/oauth2/default/v1/token`, new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: codeVerifier,
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    console.log('token response: ', tokenResponse.data);

    return tokenResponse.data;
  } catch (error) {
    console.log("2", error);
    if (error.response && error.response.status === 302) {
      console.log("3");

    } else {
      //      console.log(error);
      throw error;
    }
  }
}

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  // Generate PKCE for this session
  const { codeVerifier, codeChallenge } = generatePKCE();
  try {
    const response = await axios.post(`${OKTA_DOMAIN}/api/v1/authn`, {
      username,
      password,
      options: { multiOptionalFactorEnroll: true, warnBeforePasswordExpired: true }
    });
console.log("response.data.status",response.data.status)
    if (response.data.status === 'MFA_REQUIRED') {
      res.json({
        status: 'MFA_REQUIRED',
        stateToken: response.data.stateToken,
        factors: response.data._embedded.factors,
        pkce: { codeVerifier, codeChallenge },
      });
    } else if (response.data.status === 'SUCCESS') {
      const tokens = await exchangeSessionTokenForTokens(response.data.sessionToken, codeVerifier, codeChallenge);
      res.json({ status: 'SUCCESS', tokens });
    } else if (response.data.status === 'MFA_ENROLL') {
                res.json({
                  status: 'MFA_ENROLL',
                  stateToken: response.data.stateToken,
                  factors: response.data._embedded.factors
                  });
    } else {
      res.status(401).json({ error: 'Authentication failed' });
    }
  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

app.post('/mfa/verify', async (req, res) => {
  const { stateToken, factorId, passCode, codeVerifier, codeChallenge } = req.body;
  console.log(stateToken, factorId, passCode, codeVerifier, codeChallenge);

  try {
    const verifyResponse = await axios.post(`${OKTA_DOMAIN}/api/v1/authn/factors/${factorId}/verify`, {
      stateToken,
      passCode,
    });
    console.log(verifyResponse.data);

    if (verifyResponse.data.status === 'SUCCESS') {
      console.log("iNSIDE");
      const state = Math.random().toString(36).substring(2, 15);
      console.log(state);
      const tokens = await exchangeSessionTokenForTokens(verifyResponse.data.sessionToken, codeVerifier, codeChallenge, state);
      console.log(tokens);
      res.json({ status: 'SUCCESS', tokens });
    } else if (verifyResponse.data.status === 'MFA_CHALLENGE') {
      res.json(verifyResponse.data);
    } else {
      res.status(401).json({ error: 'MFA verification failed' });
    }
  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

app.post('/mfa/enroll', async (req, res) => {
  const { factorType, provider, stateToken } = req.body;
  console.log(factorType, provider, stateToken);

  try {
    const enrollResponse = await axios.post(
      `${OKTA_DOMAIN}/api/v1/authn/factors`,
      {
        factorType,
        provider,
        stateToken,
      },
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );

    const usefulData = {
      factorResult: enrollResponse.data._embedded.factor?._embedded?.activation.factorResult,
      factorType: enrollResponse.data._embedded.factor?.factorType,
      stateToken: enrollResponse.data.stateToken,
      status: enrollResponse.data.status,
      factorId: enrollResponse.data._embedded.factor?.id,
      activation: enrollResponse.data._embedded?.factor?._embedded?.activation ? {
        timeStep: enrollResponse.data._embedded.factor?._embedded?.activation.timeStep,
        sharedSecret: enrollResponse.data._embedded.factor?._embedded?.activation.sharedSecret,
        factorType: enrollResponse.data._embedded.factor?.factorType,
        encoding: enrollResponse.data._embedded.factor?._embedded?.activation.encoding,
        qrCode: enrollResponse.data._embedded.factor?._embedded?.activation._links?.qrcode?.href,
      } : null,
    };

    res.json(usefulData);
  } catch (error) {
    console.error('Enroll MFA error:', error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

app.post('/token/refresh', async (req, res) => {
  const { refreshToken } = req.body;

  try {
    const tokenResponse = await axios.post(`${OKTA_DOMAIN}/oauth2/default/v1/token`, new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    console.log('refresh token response: ', tokenResponse.data);

    res.json(tokenResponse.data);
  } catch (error) {
    console.error('Refresh token error:', error.response?.data || error.message);
    res.status(401).json({ error: 'Failed to refresh token' });
  }
});

app.post('/exchange-token', async (req, res) => {
  const { sessionToken, codeVerifier, codeChallenge } = req.body;

  try {
    const state = Math.random().toString(36).substring(2, 15);
    const tokens = await exchangeSessionTokenForTokens(sessionToken, codeVerifier, codeChallenge, state);
    res.json({ tokens });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/token/exchange-code', async (req, res) => {
  const { code, codeVerifier } = req.body;

  try {
    const tokenResponse = await axios.post(`${OKTA_DOMAIN}/oauth2/default/v1/token`, new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: codeVerifier, // ✅ Include PKCE verifier
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    res.json({ tokens: tokenResponse.data });
  } catch (error) {
    console.error('Exchange code error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to exchange authorization code' });
  }
});

app.get('/pkce', (req, res) => {
  try {
    const { codeVerifier, codeChallenge } = generatePKCE();
    res.json({ codeVerifier, codeChallenge });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate PKCE' });
  }
});

app.post("/userinfo", (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ error: "ID token is required" });
  }

  try {
    const idDecoded = jwt.decode(idToken);

    if (!idDecoded) {
      return res.status(400).json({ error: "Invalid ID token" });
    }

    // Extract user info from the token payload
    const { sub, email, name, exp, iat } = idDecoded;

    res.json({
      user_id: sub,
      email,
      name,
      expires_at: Date(exp),
      issue_at: Date(iat),
      raw: idDecoded,
    });
  } catch (error) {
    console.error("Failed to decode ID token:", error.message);
    res.status(500).json({ error: "Failed to decode token" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});