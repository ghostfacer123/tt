import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  StatusBar,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import BalanceDisplay from '../components/BalanceDisplay';
import SplitCard from '../components/SplitCard';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useAuth } from '../services/AuthContext';
import { supabase } from '../services/supabase';
import type { Split, SplitParticipant } from '../types';
import { formatCurrency } from '../utils/currencyFormatter';
import { useTheme } from '../contexts/ThemeContext';
import type { Theme } from '../utils/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'MainTabs'>;

interface SplitWithParticipant extends Split {
  my_participant?: SplitParticipant;
}

export default function HomeScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const { theme, isDark, toggleTheme } = useTheme();

  const [splits, setSplits] = useState<SplitWithParticipant[]>([]);
  const [totalOwed, setTotalOwed] = useState(0);
  const [totalOwe, setTotalOwe] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSplits = useCallback(async () => {
    if (!user) return;

    try {
      // ✅ FETCH UNSETTLED SPLITS
      const { data: participantData } = await supabase
        .from('split_participants')
        .select('*, splits!inner(*)')
        .eq('user_id', user.id)
        .eq('splits.settled', false)
        .order('created_at', { ascending: false })
        .limit(20);

      // ✅ FETCH CASH DEBTS
      const { data: cashDebts } = await supabase
        .from('simple_debts')
        .select('*')
        .or(`from_user.eq.${user.id},to_user.eq.${user.id}`)
        .eq('status', 'pending');

      console.log('💰 [Home] Cash debts:', cashDebts);
      console.log('📊 [Home] Participant data:', participantData);

      let owed = 0;
      let owe = 0;

      // ✅ CALCULATE SPLIT BALANCES - NEED TO FETCH OTHER PARTICIPANTS
      const splitList: SplitWithParticipant[] = [];

      if (participantData && participantData.length > 0) {
        // Get all split IDs
        const splitIds = participantData.map((p) => p.split_id);

        // Fetch ALL participants for those splits
        const { data: allParticipants } = await supabase
          .from('split_participants')
          .select('*')
          .in('split_id', splitIds);

        console.log('👥 [Home] All participants:', allParticipants);

        // Group by split
        const splitMap = new Map();
        for (const p of participantData) {
          if (p.splits) {
            splitMap.set(p.split_id, {
              split: p.splits as Split,
              myParticipant: p as SplitParticipant,
              allParticipants: allParticipants?.filter((ap) => ap.split_id === p.split_id) || [],
            });
          }
        }

        // Calculate balances
        for (const [splitId, data] of splitMap) {
          const { split, myParticipant, allParticipants: participants } = data;
          const isPayer = split.paid_by === user.id;

          if (isPayer) {
            // ✅ YOU PAID - Calculate how much OTHERS owe you
            const othersUnpaid = participants
              .filter((p: any) => p.user_id !== user.id)
              .reduce((sum: number, p: any) => {
                const unpaid = parseFloat(p.total_amount) - parseFloat(p.amount_paid);
                return sum + unpaid;
              }, 0);

            owed += othersUnpaid;

            // ✅ ONLY SHOW IN HISTORY IF OTHERS STILL OWE YOU
            if (othersUnpaid > 0) {
              splitList.push({ ...split, my_participant: myParticipant });
            }
          } else {
            // ✅ SOMEONE ELSE PAID - Calculate how much YOU owe
            const yourUnpaid =
              parseFloat(myParticipant.total_amount) - parseFloat(myParticipant.amount_paid);
            owe += yourUnpaid;

            // ✅ ONLY SHOW IN HISTORY IF YOU STILL OWE
            if (yourUnpaid > 0) {
              splitList.push({ ...split, my_participant: myParticipant });
            }
          }
        }
      }

      // ✅ CALCULATE CASH DEBT BALANCES
      if (cashDebts) {
        for (const debt of cashDebts) {
          if (debt.from_user === user.id) {
            owe += parseFloat(debt.amount);
          } else {
            owed += parseFloat(debt.amount);
          }
        }
      }

      // ✅ CALCULATE GROUP RECEIPT BALANCES
      try {
        // Get groups user is in
        const { data: membershipData } = await supabase
          .from('group_members')
          .select('group_id')
          .eq('user_id', user.id);

        const groupIds = (membershipData ?? []).map((m: any) => m.group_id);

        if (groupIds.length > 0) {
          // Get pending group receipts with item claims
          const { data: groupReceipts } = await supabase
            .from('group_receipts')
            .select(
              `
            id,
            paid_by,
            total_amount,
            group_receipt_items (
              price,
              quantity,
              item_claims (user_id)
            )
          `
            )
            .in('group_id', groupIds)
            .eq('status', 'pending');

          // Get settled group settlements to avoid double counting
          const { data: paidSettlements } = await supabase
            .from('group_settlements')
            .select('receipt_id, payer_id, payee_id, amount')
            .eq('status', 'paid')
            .or(`payer_id.eq.${user.id},payee_id.eq.${user.id}`);

          const settledMap = new Map<string, Set<string>>();
          for (const s of paidSettlements ?? []) {
            if (!settledMap.has(s.receipt_id)) {
              settledMap.set(s.receipt_id, new Set());
            }
            settledMap.get(s.receipt_id)!.add(s.payer_id);
          }

          for (const receipt of groupReceipts ?? []) {
            if (receipt.paid_by === user.id) {
              // User paid the bill — others owe them
              for (const item of receipt.group_receipt_items ?? []) {
                const itemTotal = item.price * (item.quantity ?? 1);
                const claimers: string[] = (item.item_claims ?? []).map((c: any) => c.user_id);
                const claimerCount = Math.max(claimers.length, 1);
                for (const claimer of claimers) {
                  if (claimer !== user.id) {
                    const settled = settledMap.get(receipt.id)?.has(claimer) ?? false;
                    if (!settled) {
                      owed += itemTotal / claimerCount;
                    }
                  }
                }
              }
            } else {
              // Someone else paid — check if user claimed items and hasn't settled
              const userSettled = settledMap.get(receipt.id)?.has(user.id) ?? false;
              if (!userSettled) {
                for (const item of receipt.group_receipt_items ?? []) {
                  const itemTotal = item.price * (item.quantity ?? 1);
                  const claimers: string[] = (item.item_claims ?? []).map((c: any) => c.user_id);
                  const userClaimed = claimers.includes(user.id);
                  if (userClaimed) {
                    const claimerCount = Math.max(claimers.length, 1);
                    owe += itemTotal / claimerCount;
                  }
                }
              }
            }
          }
        }
      } catch (groupErr) {
        console.warn('⚠️ [Home] Could not calculate group receipt balances:', groupErr);
      }

      console.log('📊 [Home] Total owed to you:', owed);
      console.log('📊 [Home] Total you owe:', owe);
      console.log('📊 [Home] Splits to show:', splitList);

      setSplits(splitList);
      setTotalOwed(owed);
      setTotalOwe(owe);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    fetchSplits();

    const subscription = supabase
      .channel('splits_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'splits' }, () => {
        fetchSplits();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'item_claims' }, () => {
        fetchSplits();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_settlements' }, () => {
        fetchSplits();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(subscription);
    };
  }, [fetchSplits]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchSplits();
  };

  const currency = (profile?.currency as 'EGP' | 'USD' | 'EUR' | 'SAR' | 'AED') ?? 'EGP';
  const language = profile?.language ?? 'en';
  const dynStyles = makeStyles(theme);

  return (
    <SafeAreaView style={dynStyles.container}>
      <StatusBar barStyle="light-content" backgroundColor={theme.colors.headerBackground} />
      <View style={dynStyles.header}>
        <View>
          <Text style={dynStyles.headerTitle}>{t('app_name')}</Text>
          <Text style={dynStyles.headerTagline}>{t('home.tagline')}</Text>
        </View>
        <View style={dynStyles.headerButtons}>
          <Switch
            value={isDark}
            onValueChange={toggleTheme}
            trackColor={{ false: 'rgba(255,255,255,0.3)', true: theme.colors.accent }}
            thumbColor="#FFFFFF"
            style={{ marginRight: 4 }}
          />
          <TouchableOpacity
            style={dynStyles.headerIconButton}
            onPress={() => {
              navigation.navigate('ReceiptScanner');
            }}
          >
            <Ionicons name="camera" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              navigation.navigate('NewSplit');
            }}
            style={dynStyles.newSplitBtn}
          >
            <Ionicons name="add" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={splits}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
          />
        }
        ListHeaderComponent={
          <View>
            <BalanceDisplay
              totalOwed={totalOwed}
              totalOwe={totalOwe}
              currency={currency}
              language={language}
            />
            {/* Quick actions */}
            <View style={dynStyles.quickActions}>
              <TouchableOpacity
                style={[dynStyles.quickAction, { backgroundColor: theme.colors.card }]}
                onPress={() => navigation.navigate('ReceiptScanner')}
              >
                <Ionicons name="scan" size={24} color={theme.colors.primary} />
                <Text style={[dynStyles.quickActionText, { color: theme.colors.text }]}>
                  {t('scan.title')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[dynStyles.quickAction, { backgroundColor: theme.colors.card }]}
                onPress={() => navigation.navigate('CashDebt')}
              >
                <Ionicons name="cash-outline" size={24} color={theme.colors.primary} />
                <Text style={[dynStyles.quickActionText, { color: theme.colors.text }]}>
                  {t('debt.cash_debt')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[dynStyles.quickAction, { backgroundColor: theme.colors.card }]}
                onPress={() => navigation.navigate('QuickSplit')}
              >
                <Ionicons name="receipt-outline" size={24} color={theme.colors.primary} />
                <Text style={[dynStyles.quickActionText, { color: theme.colors.text }]}>
                  {t('debt.quick_split')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[dynStyles.quickAction, { backgroundColor: theme.colors.card }]}
                onPress={() => navigation.navigate('GroupsList')}
              >
                <Ionicons name="people-outline" size={24} color={theme.colors.primary} />
                <Text style={[dynStyles.quickActionText, { color: theme.colors.text }]}>
                  {t('groups.my_groups')}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={dynStyles.sectionHeader}>
              <Text style={dynStyles.sectionTitle}>{t('home.recent_splits')}</Text>
              <TouchableOpacity
                style={dynStyles.newSplitButton}
                onPress={() => {
                  navigation.navigate('NewSplit');
                }}
              >
                <Ionicons name="add-circle" size={20} color={theme.colors.primary} />
                <Text style={dynStyles.newSplitText}>{t('home.new_split')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <SplitCard
            split={item}
            currentUserId={user?.id ?? ''}
            currency={currency}
            language={language}
            onPress={() => {
              navigation.navigate('SplitDetail', { splitId: item.id });
            }}
          />
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={dynStyles.emptyContainer}>
              <Ionicons name="receipt-outline" size={64} color={theme.colors.border} />
              <Text style={dynStyles.emptyTitle}>{t('home.no_splits')}</Text>
              <Text style={dynStyles.emptyDesc}>{t('home.no_splits_desc')}</Text>
              <TouchableOpacity
                style={dynStyles.emptyButton}
                onPress={() => {
                  navigation.navigate('NewSplit');
                }}
              >
                <Text style={dynStyles.emptyButtonText}>{t('home.new_split')}</Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
        contentContainerStyle={dynStyles.listContent}
      />
    </SafeAreaView>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    header: {
      backgroundColor: theme.colors.headerBackground,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
    },
    headerTitle: {
      fontSize: 24,
      fontWeight: '800',
      color: '#FFFFFF',
      letterSpacing: 1,
    },
    headerTagline: {
      fontSize: 13,
      fontWeight: '500',
      color: 'rgba(255,255,255,0.75)',
      marginTop: 2,
    },
    headerButtons: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    headerIconButton: {
      backgroundColor: 'rgba(255,255,255,0.2)',
      borderRadius: theme.borderRadius.round,
      width: 36,
      height: 36,
      justifyContent: 'center',
      alignItems: 'center',
    },
    newSplitBtn: {
      backgroundColor: theme.colors.primary,
      borderRadius: theme.borderRadius.round,
      width: 36,
      height: 36,
      justifyContent: 'center',
      alignItems: 'center',
    },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.colors.text,
    },
    newSplitButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    newSplitText: {
      color: theme.colors.primary,
      fontWeight: '600',
      fontSize: 14,
    },
    quickActions: {
      flexDirection: 'row',
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.sm,
      gap: theme.spacing.sm,
    },
    quickAction: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.borderRadius.md,
      paddingVertical: 12,
      gap: 6,
    },
    quickActionText: {
      fontSize: 11,
      fontWeight: '600',
      textAlign: 'center',
    },
    listContent: {
      paddingBottom: theme.spacing.xl,
    },
    emptyContainer: {
      alignItems: 'center',
      paddingVertical: theme.spacing.xxl,
      paddingHorizontal: theme.spacing.lg,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.colors.text,
      marginTop: theme.spacing.md,
    },
    emptyDesc: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      marginTop: theme.spacing.sm,
    },
    emptyButton: {
      backgroundColor: theme.colors.primary,
      borderRadius: theme.borderRadius.md,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.sm,
      marginTop: theme.spacing.lg,
    },
    emptyButtonText: {
      color: '#FFFFFF',
      fontWeight: '700',
      fontSize: 16,
    },
  });
