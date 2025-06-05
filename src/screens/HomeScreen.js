import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Button, ScrollView, Alert, AppState } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { revokeToken, refreshTokens, introspectToken } from '../services/OktaIdxService';

export default function HomeScreen({ route, navigation }) {
  const { logout } = useAuth();
  const [userInfo, setUserInfo] = useState(route.params?.userInfo || {});
  const appState = useRef(AppState.currentState);

  // Check access token on app foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async nextAppState => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        // App is back to foreground — check access token
        if (userInfo?.access_token) {
          try {
            const isActive = await introspectToken(userInfo.access_token);
            if (!isActive && userInfo.refresh_token) {
              const newTokens = await refreshTokens(userInfo.refresh_token);
              if (newTokens) {
                setUserInfo(prev => ({
                  ...prev,
                  ...newTokens,
                }));
              } else {
                logout();
                navigation.reset({
                  index: 0,
                  routes: [{ name: 'Login' }],
                });
              }
            }
          } catch (err) {
            console.error('Error checking token on resume:', err);
          }
        }
      }
      appState.current = nextAppState;
    });

    return () => subscription.remove();
  }, [userInfo]);

  const handleLogout = async () => {
    try {
      if (userInfo?.access_token) {
        await revokeToken(userInfo.access_token);
      }
    } catch (err) {
      console.error('Error revoking token:', err);
      Alert.alert('Warning', 'Logout token revoke failed, continuing anyway.');
    }

    await logout();
    navigation.reset({
      index: 0,
      routes: [{ name: 'Login' }],
    });
  };

  const handleRefreshTokens = async () => {
    try {
      if (!userInfo?.refresh_token) {
        Alert.alert('Error', 'No refresh token found.');
        return;
      }

      const newTokens = await refreshTokens(userInfo.refresh_token);
      if (newTokens) {
        setUserInfo(prev => ({
          ...prev,
          ...newTokens,
        }));
        Alert.alert('Success', 'Tokens refreshed!');
      }
    } catch (err) {
      console.error('Token refresh error:', err);
      Alert.alert('Error', 'Failed to refresh tokens.');
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20 }}>
      <Text style={{ fontWeight: 'bold', fontSize: 18, marginBottom: 10 }}>ID Token:</Text>
      <Text selectable>{userInfo?.id_token || 'Not available'}</Text>

      <Text style={{ fontWeight: 'bold', fontSize: 18, marginTop: 20, marginBottom: 10 }}>Access Token:</Text>
      <Text selectable>{userInfo?.access_token || 'Not available'}</Text>

      <View style={{ marginTop: 30 }}>
        <Button title="Refresh Tokens" onPress={handleRefreshTokens} />
      </View>

      <View style={{ marginTop: 20 }}>
        <Button title="Logout" onPress={handleLogout} />
      </View>
    </ScrollView>
  );
}