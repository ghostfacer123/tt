import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '../services/AuthContext';
import { useTheme } from '../contexts/ThemeContext';

import LoginScreen from '../screens/auth/LoginScreen';
import SignupScreen from '../screens/auth/SignupScreen';
import HomeScreen from '../screens/HomeScreen';
import FriendsScreen from '../screens/FriendsScreen';
import StatsScreen from '../screens/StatsScreen';
import NewSplitScreen from '../screens/NewSplitScreen';
import SplitDetailScreen from '../screens/SplitDetailScreen';
import SplitBreakdownScreen from '../screens/SplitBreakdownScreen';
import FriendDetailScreen from '../screens/FriendDetailScreen';
import ReceiptScannerScreen from '../screens/ReceiptScannerScreen';
import OutstandingPaymentsScreen from '../screens/OutstandingPaymentsScreen';
import SplitResultsScreen from '../screens/SplitResultsScreen';
import GroupsListScreen from '../screens/GroupsListScreen';
import CreateGroupScreen from '../screens/CreateGroupScreen';
import GroupChatScreen from '../screens/GroupChatScreen';
import GroupReceiptSplitScreen from '../screens/GroupReceiptSplitScreen';
import CashDebtScreen from '../screens/CashDebtScreen';
import QuickSplitScreen from '../screens/QuickSplitScreen';
import BalancesScreen from '../screens/BalancesScreen';
import FriendBalanceDetailScreen from '../screens/FriendBalanceDetailScreen';
import SettingsScreen from '../screens/SettingsScreen';
import BalanceBreakdownScreen from '../screens/BalanceBreakdownScreen';
import GroupSettingsScreen from '../screens/GroupSettingsScreen';
import type { ReceiptData } from '../services/mindeeOCR';
import type { SplitResultsRouteParams } from '../screens/SplitResultsScreen';

export type AuthStackParamList = {
  Login: undefined;
  Signup: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Scan: undefined;
  Friends: undefined;
  Groups: undefined;
  Stats: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  MainTabs: undefined;
  NewSplit: { receiptData?: ReceiptData } | undefined;
  ReceiptScanner: undefined;
  SplitDetail: { splitId: string };
  SplitBreakdown: { splitId: string };
  FriendDetail: { friendId: string };
  OutstandingPayments: undefined;
  SplitResults: SplitResultsRouteParams;
  GroupsList: undefined;
  CreateGroup: undefined;
  GroupChat: { groupId: string; groupName: string };
  GroupReceiptSplit: { groupId: string; receiptId: string };
  CashDebt: undefined;
  QuickSplit: undefined;
  Balances: undefined;
  FriendBalanceDetail: { friendId: string; friendName: string };
  BalanceBreakdown: undefined;
  GroupSettings: { groupId: string; groupName: string };
  ArchivedReceipts: { groupId: string };
};

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const MainTab = createBottomTabNavigator<MainTabParamList>();
const RootStack = createNativeStackNavigator<RootStackParamList>();

const AuthNavigator = () => (
  <AuthStack.Navigator screenOptions={{ headerShown: false }}>
    <AuthStack.Screen name="Login" component={LoginScreen} />
    <AuthStack.Screen name="Signup" component={SignupScreen} />
  </AuthStack.Navigator>
);

const MainTabNavigator = () => {
  const { t } = useTranslation();
  const { theme } = useTheme();

  return (
    <MainTab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
        },
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap = 'home';
          if (route.name === 'Home') iconName = focused ? 'home' : 'home-outline';
          else if (route.name === 'Scan') iconName = focused ? 'scan' : 'scan-outline';
          else if (route.name === 'Friends') iconName = focused ? 'people' : 'people-outline';
          else if (route.name === 'Groups') iconName = focused ? 'people-circle' : 'people-circle-outline';
          else if (route.name === 'Stats') iconName = focused ? 'bar-chart' : 'bar-chart-outline';
          else if (route.name === 'Settings') iconName = focused ? 'settings' : 'settings-outline';
          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <MainTab.Screen
        name="Home"
        component={HomeScreen}
        options={{ tabBarLabel: t('home.title') }}
      />
      <MainTab.Screen
        name="Scan"
        component={ReceiptScannerScreen}
        options={{ tabBarLabel: t('scan.title') }}
      />
      <MainTab.Screen
        name="Friends"
        component={FriendsScreen}
        options={{ tabBarLabel: t('friends.title') }}
      />
      <MainTab.Screen
        name="Groups"
        component={GroupsListScreen}
        options={{ tabBarLabel: t('groups.my_groups') }}
      />
      <MainTab.Screen
        name="Stats"
        component={StatsScreen}
        options={{ tabBarLabel: t('stats.title') }}
      />
      <MainTab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ tabBarLabel: t('settings.title') }}
      />
    </MainTab.Navigator>
  );
};

const MainNavigator = () => (
  <RootStack.Navigator>
    <RootStack.Screen name="MainTabs" component={MainTabNavigator} options={{ headerShown: false }} />
    <RootStack.Screen
      name="NewSplit"
      component={NewSplitScreen}
      options={{ presentation: 'modal', headerShown: false }}
    />
    <RootStack.Screen
      name="ReceiptScanner"
      component={ReceiptScannerScreen}
      options={{ headerShown: false, presentation: 'fullScreenModal' }}
    />
    <RootStack.Screen
      name="SplitDetail"
      component={SplitDetailScreen}
      options={{ headerShown: false }}
    />
    <RootStack.Screen
      name="SplitBreakdown"
      component={SplitBreakdownScreen}
      options={{ headerShown: false }}
    />
    <RootStack.Screen
      name="FriendDetail"
      component={FriendDetailScreen}
      options={{ headerShown: false }}
    />
    <RootStack.Screen
      name="OutstandingPayments"
      component={OutstandingPaymentsScreen}
      options={{ headerShown: false }}
    />
    <RootStack.Screen
      name="SplitResults"
      component={SplitResultsScreen}
      options={{ headerShown: false }}
    />
    <RootStack.Screen
      name="GroupsList"
      component={GroupsListScreen}
      options={{ headerShown: false }}
    />
    <RootStack.Screen
      name="CreateGroup"
      component={CreateGroupScreen}
      options={{ headerShown: false, presentation: 'modal' }}
    />
    <RootStack.Screen
      name="GroupChat"
      component={GroupChatScreen}
      options={{ headerShown: false }}
    />
    <RootStack.Screen
      name="GroupReceiptSplit"
      component={GroupReceiptSplitScreen}
      options={{ headerShown: false }}
    />
    <RootStack.Screen
      name="CashDebt"
      component={CashDebtScreen}
      options={{ headerShown: false, presentation: 'modal' }}
    />
    <RootStack.Screen
      name="QuickSplit"
      component={QuickSplitScreen}
      options={{ headerShown: false, presentation: 'modal' }}
    />
    <RootStack.Screen
      name="Balances"
      component={BalancesScreen}
      options={{ headerShown: false }}
    />
    <RootStack.Screen
      name="FriendBalanceDetail"
      component={FriendBalanceDetailScreen}
      options={{ headerShown: false }}
    />
    <RootStack.Screen
      name="BalanceBreakdown"
      component={BalanceBreakdownScreen}
      options={{ headerShown: false }}
    />
    <RootStack.Screen
      name="GroupSettings"
      component={GroupSettingsScreen}
      options={{ headerShown: false }}
    />
  </RootStack.Navigator>
);

export const AppNavigator = () => {
  const { session, loading, isGuest } = useAuth();
  const { theme } = useTheme();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.accent }}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {session || isGuest ? <MainNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
};
